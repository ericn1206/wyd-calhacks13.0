import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DbConnection } from '../../src/main/db/module_bindings/index.ts'
import type { CompileState } from './page.ts'
import { dueSessions, orderClips, staleVideos, videoName } from './plan.ts'
import type { PlanClip } from './plan.ts'
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
  /** First wait before reconnecting after the connection drops; doubles up to 30 s. Default 2000. */
  reconnectMs?: number
  /** Give up on a database call that has not answered after this long (a dropped connection never answers). Default 20000. */
  callTimeoutMs?: number
  /** Extra wait after the quiet period before an ended session with no clips is reported as `empty`. Default 20000. */
  emptyGraceMs?: number
  log: (message: string) => void
}

export interface RunningCompiler {
  identity: string
  port: number
  /** Drop the database connection as if the network failed (the compiler then reconnects by itself). For tests. */
  dropConnection(): void
  stop(): Promise<void>
}

// The SDK needs a global WebSocket; Node 20 has none.
async function ensureWebSocket(): Promise<void> {
  if (typeof (globalThis as { WebSocket?: unknown }).WebSocket !== 'undefined') return
  const { WebSocket } = await import('undici')
  ;(globalThis as { WebSocket?: unknown }).WebSocket = WebSocket
}

/** A reducer call on a connection that drops mid-call never settles; give up on it instead of blocking the worker. */
function withTimeout<T>(call: Promise<T>, label: string, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms) })
  return Promise.race([call, timeout]).finally(() => clearTimeout(timer))
}

const VIEWS = ['worker_ended_sessions', 'worker_session_clips', 'worker_session_clip_chunks', 'worker_session_compilations']
/** After a session ends, wait this much longer than the quiet period before saying "no clips were saved". */
const EMPTY_GRACE_MS = 20_000

/**
 * Subscribes (as a worker identity) to ended sessions that still need a compilation, joins each session's clips into
 * one video with ffmpeg, hosts it over HTTP, and records the URL in `session_compilation`. Clips stay in SpacetimeDB.
 * Reconnects by itself when the connection drops.
 */
export async function startCompiler(o: CompilerOptions): Promise<RunningCompiler> {
  await ensureWebSocket()
  mkdirSync(o.outDir, { recursive: true })
  const savedToken = o.token ?? (existsSync(o.tokenFile) ? readFileSync(o.tokenFile, 'utf8').trim() : undefined)
  const pageBase = o.publicUrl.replace(/\/$/, '')
  const callTimeout = o.callTimeoutMs ?? 20_000

  const lastActivity = new Map<bigint, number>()
  const failedAt = new Map<bigint, number>()
  const rendering = new Set<bigint>()
  let applied = false
  let stopped = false
  let timer: NodeJS.Timeout | null = null
  /** The live connection; undefined while (re)connecting. */
  let conn: DbConnection | undefined

  const statusOf = (id: bigint): CompileState => {
    const c = conn
    if (!c) return { state: 'offline' }
    if (rendering.has(id)) return { state: 'rendering' }
    const row = [...c.db.workerSessionCompilations.iter()].find(r => r.sessionId === id)
    if (row) {
      if (row.status.tag === 'Ready') return { state: 'ready', clipCount: row.clipCount }
      if (row.status.tag === 'Failed') return { state: 'failed', error: row.error ?? 'unknown error' }
      return { state: 'rendering' }
    }
    const ended = [...c.db.workerEndedSessions.iter()].some(s => s.id === id)
    if (!ended) return { state: 'waiting' }
    if ([...c.db.workerSessionClips.iter()].some(clip => clip.sessionId === id)) return { state: 'rendering' }
    // Ended with no clip (yet): late clips can still arrive for a while, so only then say there are none.
    return Date.now() - (lastActivity.get(id) ?? 0) >= o.quietMs + (o.emptyGraceMs ?? EMPTY_GRACE_MS) ? { state: 'empty' } : { state: 'waiting' }
  }

  const server = createVideoServer(o.outDir, statusOf)
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(o.port, '0.0.0.0', resolve) })
  const port = (server.address() as { port: number }).port

  /** Open a connection and resolve with the identity once the subscriptions are applied. */
  function connect(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let built: DbConnection | undefined
      const bump = (sessionId: bigint) => { if (applied) lastActivity.set(sessionId, Date.now()) }
      built = DbConnection.builder()
        .withUri(o.uri)
        .withDatabaseName(o.database)
        .withToken(savedToken)
        .onConnect((c, id, token) => {
          if (!o.token) { try { mkdirSync(dirname(o.tokenFile), { recursive: true }); writeFileSync(o.tokenFile, token) } catch { /* in memory only */ } }
          c.db.workerSessionClips.onInsert((_ctx, clip) => bump(clip.sessionId))
          c.db.workerEndedSessions.onInsert((_ctx, s) => bump(s.id))
          c.subscriptionBuilder()
            .onApplied(() => { applied = true; conn = built; resolve(id.toHexString()) })
            .onError(() => reject(new Error('subscription failed (is this identity an authorized worker?)')))
            .subscribe(VIEWS.map(v => `SELECT * FROM ${v}`))
        })
        .onConnectError((_c, err) => reject(err))
        .onDisconnect((_c, err) => {
          if (conn === built) { conn = undefined; applied = false }
          if (stopped) return
          o.log(`disconnected${err ? `: ${err.message}` : ''}; reconnecting`)
          void reconnectLoop()
        })
        .build()
    })
  }

  let reconnecting = false
  async function reconnectLoop(): Promise<void> {
    if (reconnecting) return
    reconnecting = true
    for (let attempt = 0; !stopped; attempt++) {
      await new Promise(r => setTimeout(r, Math.min(30_000, (o.reconnectMs ?? 2000) * 2 ** attempt)))
      if (stopped) break
      try {
        await connect()
        await publishPageUrl()
        o.log('reconnected')
        break
      } catch (err) {
        o.log(`reconnect failed: ${err instanceof Error ? err.message : err}`)
      }
    }
    reconnecting = false
  }

  /** Tell clients where the session pages live so the summary screen can link to them before the video exists. */
  async function publishPageUrl(): Promise<void> {
    const c = conn
    if (!c) return
    await withTimeout(c.reducers.setClipPageBaseUrl({ url: o.publicUrl }), 'publish page url', callTimeout).catch(err => o.log(`could not publish the page url (not an authorized worker?): ${err instanceof Error ? err.message : err}`))
  }

  const identity = await connect().catch(async err => {
    await new Promise<void>(r => server.close(() => r()))
    throw err
  })
  o.log(`connected as worker ${identity}; serving ${o.outDir} on :${port}; session page: ${pageBase}/session/<id>`)
  await publishPageUrl()

  async function setState(c: DbConnection, sessionId: bigint, status: 'Rendering' | 'Ready' | 'Failed', clipCount: number, url?: string, error?: string): Promise<void> {
    await withTimeout(c.reducers.setSessionCompilation({ sessionId, status: { tag: status }, clipCount, url, error }), `set compilation ${sessionId}`, callTimeout)
  }

  async function render(c: DbConnection, sessionId: bigint): Promise<void> {
    rendering.add(sessionId)
    try {
      const clips = orderClips([...c.db.workerSessionClips.iter()].filter(clip => clip.sessionId === sessionId))
      o.log(`session ${sessionId}: rendering ${clips.length} clip(s)`)
      await setState(c, sessionId, 'Rendering', 0)
      const chunks = new Map<bigint, { seq: number; data: Uint8Array }[]>()
      for (const ch of c.db.workerSessionClipChunks.iter()) {
        const list = chunks.get(ch.clipId) ?? []
        list.push({ seq: ch.seq, data: ch.data })
        chunks.set(ch.clipId, list)
      }
      const files = clips.map(clip => {
        const parts = (chunks.get(clip.id) ?? []).sort((a, b) => a.seq - b.seq).map(p => p.data)
        const file = Buffer.concat(parts)
        if (file.length !== clip.sizeBytes) throw new Error(`clip ${clip.id}: ${file.length}/${clip.sizeBytes} bytes held`)
        return file
      })
      const name = videoName(sessionId, clips.length)
      const started = Date.now()
      await renderCompilation(files, join(o.outDir, name), o.ffmpegBin)
      for (const old of staleVideos(readdirSync(o.outDir), sessionId, name)) rmSync(join(o.outDir, old), { force: true })
      await setState(c, sessionId, 'Ready', clips.length, `${pageBase}${VIDEO_PATH}${name}`)
      failedAt.delete(sessionId)
      o.log(`session ${sessionId}: ready ${name} (${Date.now() - started} ms)`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      o.log(`session ${sessionId}: failed: ${message}`)
      failedAt.set(sessionId, Date.now())
      await setState(c, sessionId, 'Failed', 0, undefined, message).catch(e => o.log(`could not report failure: ${e instanceof Error ? e.message : e}`))
    } finally {
      rendering.delete(sessionId)
    }
  }

  let busy = false
  async function tick(): Promise<void> {
    const c = conn
    if (busy || stopped || !c) return
    busy = true
    try {
      const clips: PlanClip[] = [...c.db.workerSessionClips.iter()].map(clip => ({ id: clip.id, sessionId: clip.sessionId, momentAtMs: clip.momentAtMs, chunkCount: clip.chunkCount }))
      const held = new Map<bigint, number>()
      for (const ch of c.db.workerSessionClipChunks.iter()) held.set(ch.clipId, (held.get(ch.clipId) ?? 0) + 1)
      const due = dueSessions({
        sessionIds: [...c.db.workerEndedSessions.iter()].map(s => s.id),
        clips,
        chunksHeld: held,
        lastActivityMs: lastActivity,
        failedAtMs: failedAt,
        rendering,
        now: Date.now(),
        quietMs: o.quietMs,
        retryMs: o.retryMs
      })
      for (const id of due) { if (!stopped && conn === c) await render(c, id) }
    } finally {
      busy = false
    }
  }
  timer = setInterval(() => { tick().catch(e => o.log(`tick failed: ${e instanceof Error ? e.message : e}`)) }, o.pollMs)

  return {
    identity,
    port,
    dropConnection() { conn?.disconnect() },
    async stop() {
      stopped = true
      if (timer) clearInterval(timer)
      const give = Date.now() + 10_000
      while (busy && Date.now() < give) await new Promise(r => setTimeout(r, 50))
      conn?.disconnect()
      await new Promise<void>(r => server.close(() => r()))
    }
  }
}
