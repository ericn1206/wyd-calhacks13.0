import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DbConnection } from '../../src/main/db/module_bindings/index.ts'
import type { CompileState } from './page.ts'
import { dueSessions, groupClips, missingVideos, staleVideos, videoName } from './plan.ts'
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
  /** Track laid over every video (looped to its length). Missing file = no audio. */
  audioPath?: string
  /** First wait before reconnecting after the connection drops; doubles up to 30 s. Default 2000. */
  reconnectMs?: number
  /**
   * Take the single-compiler lease in the database before doing anything (and keep it alive). Startup is refused while another
   * compiler holds it, unless `takeover`. Without this option no lease is used (tests).
   */
  lease?: { label: string; takeover: boolean }
  /** Called after the compiler stopped itself because another one took the lease. */
  onLeaseLost?: () => void
  /** Lease heartbeat interval. Default 5000 (the module treats 20 s of silence as gone). */
  leaseHeartbeatMs?: number
  /**
   * Re-render videos the database calls Ready but whose file is not in `outDir` (a new machine, a wiped folder).
   * Default: on when a lease is used. Without the lease two compilers with different folders would keep
   * invalidating each other's videos, so never turn this on for several compilers.
   */
  rebuildMissing?: boolean
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
  /** Sessions being re-queued because their file is gone: their clips reappearing is not new activity. */
  const rebuilding = new Set<bigint>()
  const rebuildMissing = o.rebuildMissing ?? !!o.lease
  const hasFile = (id: bigint, clipCount: number) => existsSync(join(o.outDir, videoName(id, clipCount)))

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
      // Ready in the database but no file here: it is being (or is about to be) rebuilt, do not offer a broken video.
      if (row.status.tag === 'Ready') return rebuildMissing && !hasFile(id, row.clipCount) ? { state: 'rendering' } : { state: 'ready', clipCount: row.clipCount }
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
      // Only changes caused by a reducer while connected count as activity; the initial snapshot (old sessions) does not.
      const live = (ctx: unknown) => (ctx as { event?: { tag?: string } } | undefined)?.event?.tag === 'Reducer'
      const bump = (ctx: unknown, sessionId: bigint) => { if (live(ctx) && !rebuilding.has(sessionId)) lastActivity.set(sessionId, Date.now()) }
      built = DbConnection.builder()
        .withUri(o.uri)
        .withDatabaseName(o.database)
        .withToken(savedToken)
        .onConnect((c, id, token) => {
          if (!o.token) { try { mkdirSync(dirname(o.tokenFile), { recursive: true }); writeFileSync(o.tokenFile, token) } catch { /* in memory only */ } }
          c.db.workerSessionClips.onInsert((ctx, clip) => bump(ctx, clip.sessionId))
          c.db.workerEndedSessions.onInsert((ctx, s) => bump(ctx, s.id))
          c.subscriptionBuilder()
            .onApplied(() => { conn = built; resolve(id.toHexString()) })
            .onError(() => reject(new Error('subscription failed (is this identity an authorized worker?)')))
            .subscribe(VIEWS.map(v => `SELECT * FROM ${v}`))
        })
        .onConnectError((_c, err) => reject(err))
        .onDisconnect((_c, err) => {
          if (conn === built) conn = undefined
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
        try {
          await claimLease() // same lease id: refreshes our lease, or is refused if someone took over while we were offline
        } catch (err) {
          if (/already running/.test(String(err))) { await loseLease(); break }
          conn?.disconnect() // a transient failure: drop this connection and try again
          conn = undefined
          throw err
        }
        await publishPageUrl()
        o.log('reconnected')
        break
      } catch (err) {
        o.log(`reconnect failed: ${err instanceof Error ? err.message : err}`)
      }
    }
    reconnecting = false
  }

  // ── Single-compiler lease (database): two compilers would overwrite each other's URLs ──
  const leaseId = randomUUID()
  let heartbeat: NodeJS.Timeout | undefined
  async function claimLease(takeover = o.lease?.takeover ?? false): Promise<void> {
    const c = conn
    if (!o.lease || !c) return
    await withTimeout(c.reducers.claimCompilerLease({ leaseId, label: o.lease.label, url: o.publicUrl, takeover }), 'claim lease', callTimeout)
  }
  /** Another compiler took the lease (--takeover): stop serving so the two never run together. */
  async function loseLease(): Promise<void> {
    o.log('another clip compiler took over the lease; stopping this one')
    await stopCompiler(false)
    o.onLeaseLost?.()
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
  try {
    await claimLease()
  } catch (err) {
    // Refused (another compiler is running) or the call failed: leave nothing behind.
    stopped = true
    conn?.disconnect()
    await new Promise<void>(r => server.close(() => r()))
    throw new Error(String(err instanceof Error ? err.message : err).replace(/^.*?(a clip compiler is already running)/s, '$1'))
  }
  o.log(`connected as worker ${identity}; serving ${o.outDir} on :${port}; session page: ${pageBase}/session/<id>${o.lease ? '; lease taken' : ''}`)
  await publishPageUrl()
  if (o.lease) {
    heartbeat = setInterval(() => {
      const c = conn
      if (!c || stopped) return
      withTimeout(c.reducers.heartbeatCompilerLease({ leaseId }), 'lease heartbeat', callTimeout).catch(err => {
        if (/lease lost/.test(String(err))) void loseLease()
        else o.log(`lease heartbeat failed: ${err instanceof Error ? err.message : err}`)
      })
    }, o.leaseHeartbeatMs ?? 5000)
  }

  async function setState(c: DbConnection, sessionId: bigint, status: 'Rendering' | 'Ready' | 'Failed', clipCount: number, url?: string, error?: string): Promise<void> {
    await withTimeout(c.reducers.setSessionCompilation({ sessionId, status: { tag: status }, clipCount, url, error }), `set compilation ${sessionId}`, callTimeout)
  }

  async function render(c: DbConnection, sessionId: bigint): Promise<void> {
    rendering.add(sessionId)
    rebuilding.delete(sessionId)
    try {
      // `clips` = everything the session has (what the module compares as clipCount); the video's segments are the
      // drifters' clips, with the joined teammates' webcam clips laid over the one they overlap.
      const clips = [...c.db.workerSessionClips.iter()].filter(clip => clip.sessionId === sessionId)
      const { groups, orphans } = groupClips(clips)
      if (groups.length === 0) throw new Error(`no clips to show (${orphans.length} teammate clip(s) without a check-in)`)
      o.log(`session ${sessionId}: rendering ${groups.length} clip(s) + ${clips.length - groups.length - orphans.length} teammate video(s)`)
      await setState(c, sessionId, 'Rendering', 0)
      const chunks = new Map<bigint, { seq: number; data: Uint8Array }[]>()
      for (const ch of c.db.workerSessionClipChunks.iter()) {
        const list = chunks.get(ch.clipId) ?? []
        list.push({ seq: ch.seq, data: ch.data })
        chunks.set(ch.clipId, list)
      }
      const fileOf = (clip: (typeof clips)[number]) => {
        const parts = (chunks.get(clip.id) ?? []).sort((a, b) => a.seq - b.seq).map(p => p.data)
        const file = Buffer.concat(parts)
        if (file.length !== clip.sizeBytes) throw new Error(`clip ${clip.id}: ${file.length}/${clip.sizeBytes} bytes held`)
        return file
      }
      const bases = groups.map(g => g.base)
      const files = bases.map(fileOf)
      const joiners = groups.flatMap((g, base) => g.joiners.map(clip => ({
        clip,
        input: { base, data: fileOf(clip), offsetSecs: Math.max(0, Number(clip.startedAtMs) - Number(g.base.startedAtMs)) / 1000 }
      })))
      const name = videoName(sessionId, clips.length)
      const started = Date.now()
      const { skipped, skippedJoiners } = await renderCompilation(files, join(o.outDir, name), o.ffmpegBin, o.audioPath, joiners.map(j => j.input))
      for (const old of staleVideos(readdirSync(o.outDir), sessionId, name)) rmSync(join(o.outDir, old), { force: true })
      // clipCount stays the number of clips the session has (what the module compares), even when some were left out.
      const unreadable = [...skipped.map(i => bases[i].id), ...skippedJoiners.map(i => joiners[i].clip.id)]
      const notes = [
        unreadable.length ? `${unreadable.length} unreadable clip(s) left out (ids ${unreadable.join(', ')})` : '',
        orphans.length ? `${orphans.length} teammate clip(s) without a matching check-in left out (ids ${orphans.map(clip => clip.id).join(', ')})` : ''
      ].filter(Boolean)
      const note = notes.length ? notes.join('; ') : undefined
      if (note) o.log(`session ${sessionId}: ${note}`)
      // Stored without the host: clients add the current clip_page_base_url, so a changed address never stales it.
      await setState(c, sessionId, 'Ready', clips.length, `${VIDEO_PATH}${name}`, note)
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
      if (rebuildMissing) {
        // Back to Rendering makes the module list the session's clips again (views hide Ready sessions), so the normal path re-renders it.
        const rows = [...c.db.workerSessionCompilations.iter()].map(r => ({ sessionId: r.sessionId, status: r.status.tag, clipCount: r.clipCount }))
        for (const id of missingVideos(rows, name => existsSync(join(o.outDir, name))).slice(0, 5)) {
          if (stopped || conn !== c || rendering.has(id)) break
          o.log(`session ${id}: video file is not here, rebuilding`)
          rebuilding.add(id)
          lastActivity.set(id, 0)
          await setState(c, id, 'Rendering', 0).catch(err => { rebuilding.delete(id); o.log(`could not queue session ${id} for rebuild: ${err instanceof Error ? err.message : err}`) })
        }
      }
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

  /** Stop everything; `release` frees the lease for the next compiler (not when it was already taken from us). */
  async function stopCompiler(release: boolean): Promise<void> {
    if (stopped && !conn && !timer) return
    stopped = true
    if (timer) clearInterval(timer)
    if (heartbeat) clearInterval(heartbeat)
    timer = null
    heartbeat = undefined
    const give = Date.now() + 10_000
    while (busy && Date.now() < give) await new Promise(r => setTimeout(r, 50))
    const c = conn
    if (release && o.lease && c) await withTimeout(c.reducers.releaseCompilerLease({ leaseId }), 'release lease', 5000).catch(() => { /* it goes stale in 20 s */ })
    c?.disconnect()
    conn = undefined
    await new Promise<void>(r => server.close(() => r()))
  }

  return {
    identity,
    port,
    dropConnection() { conn?.disconnect() },
    stop: () => stopCompiler(true)
  }
}
