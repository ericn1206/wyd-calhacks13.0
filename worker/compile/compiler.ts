import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DbConnection } from '../../src/main/db/module_bindings/index.ts'
import { dueSessions, orderClips, staleVideos, videoName } from './plan.ts'
import type { PlanClip } from './plan.ts'
import type { CompileState } from './page.ts'
import { renderCompilation } from './render.ts'
import { createVideoServer, VIDEO_PATH } from './serve.ts'

export interface CompilerOptions {
  uri: string
  database: string
  /** Identity of an authorized worker. Default: saved in `tokenFile`, else a new identity (then run authorize_worker). */
  token?: string
  tokenFile: string
  outDir: string
  port: number
  /** Base URL clients use to reach this server, e.g. http://192.168.1.20:8787 */
  publicUrl: string
  quietMs: number
  retryMs: number
  pollMs: number
  ffmpegBin: string
  log: (message: string) => void
}

export interface RunningCompiler {
  identity: string
  port: number
  stop(): Promise<void>
}

// The SDK needs a global WebSocket; Node 20 has none.
async function ensureWebSocket(): Promise<void> {
  if (typeof (globalThis as { WebSocket?: unknown }).WebSocket !== 'undefined') return
  const { WebSocket } = await import('undici')
  ;(globalThis as { WebSocket?: unknown }).WebSocket = WebSocket
}

const VIEWS = ['worker_ended_sessions', 'worker_session_clips', 'worker_session_clip_chunks', 'worker_session_compilations']

/**
 * Subscribes (as a worker identity) to ended sessions that still need a compilation, joins each session's clips into
 * one video with ffmpeg, hosts it over HTTP, and records the URL in `session_compilation`. Clips stay in SpacetimeDB.
 */
export async function startCompiler(o: CompilerOptions): Promise<RunningCompiler> {
  await ensureWebSocket()
  mkdirSync(o.outDir, { recursive: true })
  const savedToken = o.token ?? (existsSync(o.tokenFile) ? readFileSync(o.tokenFile, 'utf8').trim() : undefined)

  const lastActivity = new Map<bigint, number>()
  const failedAt = new Map<bigint, number>()
  const rendering = new Set<bigint>()
  let applied = false
  let stopped = false
  let timer: NodeJS.Timeout | null = null

  let connection: DbConnection | undefined
  const statusOf = (id: bigint): CompileState => {
    if (rendering.has(id)) return { state: 'rendering' }
    const row = connection && [...connection.db.workerSessionCompilations.iter()].find(r => r.sessionId === id)
    if (!row) return { state: 'waiting' }
    if (row.status.tag === 'Ready') return { state: 'ready', clipCount: row.clipCount }
    if (row.status.tag === 'Failed') return { state: 'failed', error: row.error ?? 'unknown error' }
    return { state: 'rendering' }
  }
  const server = createVideoServer(o.outDir, statusOf)
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(o.port, '0.0.0.0', resolve) })
  const port = (server.address() as { port: number }).port

  const identity = await new Promise<string>((resolve, reject) => {
    const bump = (sessionId: bigint) => { if (applied) lastActivity.set(sessionId, Date.now()) }
    connection = DbConnection.builder()
      .withUri(o.uri)
      .withDatabaseName(o.database)
      .withToken(savedToken)
      .onConnect((c, id, token) => {
        if (!o.token) { try { mkdirSync(dirname(o.tokenFile), { recursive: true }); writeFileSync(o.tokenFile, token) } catch { /* in memory only */ } }
        c.db.workerSessionClips.onInsert((_ctx, clip) => bump(clip.sessionId))
        c.db.workerEndedSessions.onInsert((_ctx, s) => bump(s.id))
        c.subscriptionBuilder()
          .onApplied(() => { applied = true; resolve(id.toHexString()) })
          .onError(() => reject(new Error('subscription failed (is this identity an authorized worker?)')))
          .subscribe(VIEWS.map(v => `SELECT * FROM ${v}`))
      })
      .onConnectError((_c, err) => reject(err))
      .onDisconnect((_c, err) => { if (!stopped) o.log(`disconnected${err ? `: ${err.message}` : ''}`) })
      .build()
  }).catch(async err => {
    await new Promise<void>(r => server.close(() => r()))
    throw err
  })
  const conn = connection as DbConnection
  o.log(`connected as worker ${identity}; serving ${o.outDir} on :${port}; session page: ${o.publicUrl.replace(/\/$/, '')}/session/<id>`)

  // Tell clients where the session pages live so the summary screen can link to them before the video exists.
  await conn.reducers.setClipPageBaseUrl({ url: o.publicUrl }).catch(err => o.log(`could not publish the page url (not an authorized worker?): ${err instanceof Error ? err.message : err}`))

  async function setState(sessionId: bigint, status: 'Rendering' | 'Ready' | 'Failed', clipCount: number, url?: string, error?: string): Promise<void> {
    await conn.reducers.setSessionCompilation({ sessionId, status: { tag: status }, clipCount, url, error })
  }

  async function render(sessionId: bigint): Promise<void> {
    rendering.add(sessionId)
    try {
      const clips = orderClips([...conn.db.workerSessionClips.iter()].filter(c => c.sessionId === sessionId))
      o.log(`session ${sessionId}: rendering ${clips.length} clip(s)`)
      await setState(sessionId, 'Rendering', 0)
      const chunks = new Map<bigint, { seq: number; data: Uint8Array }[]>()
      for (const ch of conn.db.workerSessionClipChunks.iter()) {
        const list = chunks.get(ch.clipId) ?? []
        list.push({ seq: ch.seq, data: ch.data })
        chunks.set(ch.clipId, list)
      }
      const files = clips.map(c => {
        const parts = (chunks.get(c.id) ?? []).sort((a, b) => a.seq - b.seq).map(p => p.data)
        const file = Buffer.concat(parts)
        if (file.length !== c.sizeBytes) throw new Error(`clip ${c.id}: ${file.length}/${c.sizeBytes} bytes held`)
        return file
      })
      const name = videoName(sessionId, clips.length)
      const started = Date.now()
      await renderCompilation(files, join(o.outDir, name), o.ffmpegBin)
      for (const old of staleVideos(readdirSync(o.outDir), sessionId, name)) rmSync(join(o.outDir, old), { force: true })
      await setState(sessionId, 'Ready', clips.length, `${o.publicUrl.replace(/\/$/, '')}${VIDEO_PATH}${name}`)
      failedAt.delete(sessionId)
      o.log(`session ${sessionId}: ready ${name} (${Date.now() - started} ms)`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      o.log(`session ${sessionId}: failed: ${message}`)
      failedAt.set(sessionId, Date.now())
      await setState(sessionId, 'Failed', 0, undefined, message).catch(e => o.log(`could not report failure: ${e instanceof Error ? e.message : e}`))
    } finally {
      rendering.delete(sessionId)
    }
  }

  let busy = false
  async function tick(): Promise<void> {
    if (busy || stopped) return
    busy = true
    try {
      const clips: PlanClip[] = [...conn.db.workerSessionClips.iter()].map(c => ({ id: c.id, sessionId: c.sessionId, momentAtMs: c.momentAtMs, chunkCount: c.chunkCount }))
      const held = new Map<bigint, number>()
      for (const ch of conn.db.workerSessionClipChunks.iter()) held.set(ch.clipId, (held.get(ch.clipId) ?? 0) + 1)
      const due = dueSessions({
        sessionIds: [...conn.db.workerEndedSessions.iter()].map(s => s.id),
        clips,
        chunksHeld: held,
        lastActivityMs: lastActivity,
        failedAtMs: failedAt,
        rendering,
        now: Date.now(),
        quietMs: o.quietMs,
        retryMs: o.retryMs
      })
      for (const id of due) { if (!stopped) await render(id) }
    } finally {
      busy = false
    }
  }
  timer = setInterval(() => { tick().catch(e => o.log(`tick failed: ${e instanceof Error ? e.message : e}`)) }, o.pollMs)

  return {
    identity,
    port,
    async stop() {
      stopped = true
      if (timer) clearInterval(timer)
      while (busy) await new Promise(r => setTimeout(r, 50))
      conn.disconnect()
      await new Promise<void>(r => server.close(() => r()))
    }
  }
}
