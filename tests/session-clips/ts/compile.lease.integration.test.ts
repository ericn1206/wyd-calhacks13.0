// The single-compiler lease, on a real database. Opt-in like compile.integration.test.ts:
// WYD_TEST_STDB_URI, WYD_TEST_STDB_DB and WYD_TEST_WORKER_TOKEN (see ../README.md).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, afterEach, describe, it } from 'node:test'
import { StdbClient } from '../../../src/main/db/stdb'
import { newClipPath, uploadClip } from '../../../src/main/clipUpload'
import { startCompiler, type CompilerOptions, type RunningCompiler } from '../../../worker/compile/compiler'

const uri = process.env['WYD_TEST_STDB_URI']
const db = process.env['WYD_TEST_STDB_DB']
const workerToken = process.env['WYD_TEST_WORKER_TOKEN']
const skip = !uri || !db || !workerToken ? 'set WYD_TEST_STDB_URI, WYD_TEST_STDB_DB, WYD_TEST_WORKER_TOKEN to run' : false

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const dirs: string[] = []
const running: RunningCompiler[] = []

async function freePort(): Promise<number> {
  return new Promise(resolve => {
    const s = createServer().listen(0, () => {
      const p = (s.address() as { port: number }).port
      s.close(() => resolve(p))
    })
  })
}

async function start(label: string, over: Partial<CompilerOptions> = {}, takeover = false): Promise<{ c: RunningCompiler; port: number; logs: string[] }> {
  const outDir = mkdtempSync(join(tmpdir(), 'wyd-lease-'))
  dirs.push(outDir)
  const port = await freePort()
  const logs: string[] = []
  const c = await startCompiler({
    uri: uri!, database: db!, token: workerToken, tokenFile: join(outDir, 'token'), outDir, port,
    publicUrl: `http://127.0.0.1:${port}`, quietMs: 60_000, retryMs: 1000, pollMs: 500, ffmpegBin: 'ffmpeg', reconnectMs: 200,
    lease: { label, takeover }, leaseHeartbeatMs: 300, rebuildMissing: false, // these tests are about the lease, not the old sessions in the db
    log: m => logs.push(m),
    ...over
  })
  running.push(c)
  return { c, port, logs }
}

const health = (port: number) => fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) }).then(r => r.ok, () => false)

describe('compiler lease', { skip }, () => {
  afterEach(async () => {
    for (const c of running.splice(0)) await c.stop().catch(() => {})
  })
  after(() => dirs.forEach(d => rmSync(d, { recursive: true, force: true })))

  it('the first compiler starts; a second is refused and told who holds it', async () => {
    const first = await start('laptop-A (http://192.168.1.10:8787)')
    assert.equal(await health(first.port), true)
    await assert.rejects(start('laptop-B'), /a clip compiler is already running: laptop-A \(http:\/\/192\.168\.1\.10:8787\), last seen \d+ s ago \(start with --takeover/)
  })

  it('a refused compiler leaves nothing behind: its port is free and the holder is unaffected', async () => {
    const first = await start('holder')
    const port = await freePort()
    await assert.rejects(start('intruder', { port }), /already running/)
    // the intruder's server was closed, so the port can be used again
    await new Promise<void>((resolve, reject) => { const s = createServer().once('error', reject).listen(port, () => s.close(() => resolve())) })
    assert.equal(await health(first.port), true)
    await sleep(1200) // several heartbeats later the holder still holds it
    await assert.rejects(start('intruder again'), /already running/)
  })

  it('a graceful stop releases the lease at once', async () => {
    const first = await start('A')
    await first.c.stop()
    const second = await start('B')
    assert.equal(await health(second.port), true)
  })

  it('--takeover replaces the holder, and the old compiler notices and stops itself', async () => {
    let lost = false
    const first = await start('old', { onLeaseLost: () => { lost = true } })
    const second = await start('new', {}, true)
    assert.equal(await health(second.port), true)
    const end = Date.now() + 8000
    while (Date.now() < end && !lost) await sleep(200)
    assert.equal(lost, true, 'the old compiler was told it lost the lease')
    assert.ok(first.logs.some(l => l.includes('took over the lease')), first.logs.join(' | '))
    assert.equal(await health(first.port), false, 'the old compiler no longer serves')
    assert.equal(await health(second.port), true)
  })

  it('a holder that went silent can be replaced after the stale period, without --takeover', { timeout: 60_000 }, async () => {
    // Heartbeat far apart = a crashed holder (its process is still around only so the test can clean up).
    const crashed = await start('crashed', { leaseHeartbeatMs: 10 * 60_000 })
    await assert.rejects(start('too early'), /already running/)
    await sleep(21_500)
    const replacement = await start('replacement')
    assert.equal(await health(replacement.port), true)
    await crashed.c.stop().catch(() => {})
  })

  it('a dropped connection is re-established under the same lease, still refusing others', async () => {
    const first = await start('A')
    first.c.dropConnection()
    const end = Date.now() + 15_000
    while (Date.now() < end && !first.logs.some(l => l.includes('reconnected'))) await sleep(200)
    assert.ok(first.logs.some(l => l.includes('reconnected')), first.logs.join(' | '))
    await assert.rejects(start('B'), /already running/)
    assert.equal(await health(first.port), true)
  })

  it('without a lease option a compiler does not touch the lease (tests, tooling)', async () => {
    const holder = await start('holder')
    const free = await start('ignored', { lease: undefined })
    assert.equal(await health(free.port), true)
    assert.equal(await health(holder.port), true)
  })
})


// ── Videos that are not on this machine ──
const none = undefined

async function memberWithEndedSession(): Promise<{ member: StdbClient; sessionId: number }> {
  const dir = mkdtempSync(join(tmpdir(), 'wyd-it-'))
  dirs.push(dir)
  process.env['WYD_TEST_USERDATA'] = dir
  process.env['SPACETIME_URI'] = uri
  process.env['SPACETIME_DB'] = db
  const member = new StdbClient()
  await member.connect()
  await sleep(1500)
  await member.call('createSession', {
    name: 'rebuild',
    settings: { pomodoroWorkSecs: none, pomodoroBreakSecs: none, offTaskThresholdSecs: none, callCooldownSecs: none, maxCallSecs: none, scoreboardEnabled: none, groupCallEnabled: none, topicDescription: none, allowedDomains: none, blockedDomains: none },
    code: none
  })
  await sleep(300)
  const sessionId = member.snapshot().tables.sessions.map(r => Number(r.id)).sort((a, b) => b - a)[0]
  const clip = newClipPath()
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=8', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip])
  const now = Date.now()
  await uploadClip(member, { clip, t: now, startedAt: now - 10_000, durationMs: 2000, width: 320, height: 240, fps: 8 })
  await member.call('endSession', {})
  return { member, sessionId }
}

async function waitFor(what: string, fn: () => boolean | Promise<boolean>, ms = 60_000): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fn()) return
    await sleep(250)
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('rebuilding videos that are not here', { skip, timeout: 240_000 }, () => {
  afterEach(async () => {
    for (const c of running.splice(0)) await c.stop().catch(() => {})
  })

  const startWithLease = (label: string, outDir: string) => {
    const port = freePort()
    return port.then(async p => {
      const c = await startCompiler({
        uri: uri!, database: db!, token: workerToken, tokenFile: join(outDir, 'token'), outDir, port: p,
        publicUrl: `http://127.0.0.1:${p}`, quietMs: 0, retryMs: 60_000, pollMs: 300, ffmpegBin: 'ffmpeg', reconnectMs: 200,
        lease: { label, takeover: false }, leaseHeartbeatMs: 300, log: () => {}
      })
      running.push(c)
      return { c, port: p }
    })
  }

  it('a video file that disappears is rendered again, and the stored url is a path without a host', async () => {
    const { member, sessionId } = await memberWithEndedSession()
    const outDir = mkdtempSync(join(tmpdir(), 'wyd-rb-'))
    dirs.push(outDir)
    const file = join(outDir, `session-${sessionId}-1.mp4`)
    const { port } = await startWithLease('rebuilder', outDir)
    await waitFor('the first render', () => existsSync(file))
    const row = member.snapshot().tables.compilations.find(r => r.sessionId === sessionId)
    assert.match(String(row?.url), /^\/compilations\/session-\d+-1\.mp4$/)

    rmSync(file) // e.g. someone cleaned the folder
    await waitFor('the file to be rebuilt', () => existsSync(file))
    const res = await fetch(`http://127.0.0.1:${port}/compilations/session-${sessionId}-1.mp4`)
    assert.equal(res.status, 200)
    await res.arrayBuffer()
    await waitFor('the row to be Ready again', () => member.snapshot().tables.compilations.some(r => r.sessionId === sessionId && (r.status as { tag: string }).tag === 'Ready'))
    member.disconnect()
  })

  it('a compiler started on another machine (another folder) rebuilds the existing videos', async () => {
    const { member, sessionId } = await memberWithEndedSession()
    const folderA = mkdtempSync(join(tmpdir(), 'wyd-rbA-'))
    const folderB = mkdtempSync(join(tmpdir(), 'wyd-rbB-'))
    dirs.push(folderA, folderB)
    const first = await startWithLease('machine A', folderA)
    await waitFor('machine A to render', () => existsSync(join(folderA, `session-${sessionId}-1.mp4`)))
    await first.c.stop() // machine A goes away (releases the lease)

    const second = await startWithLease('machine B', folderB)
    await waitFor('machine B to rebuild the video', () => existsSync(join(folderB, `session-${sessionId}-1.mp4`)))
    const res = await fetch(`http://127.0.0.1:${second.port}/session/${sessionId}/status`)
    assert.equal(((await res.json()) as { state: string }).state, 'ready')
    member.disconnect()
  })

  it('without a lease the compiler does not rebuild anything (so several test compilers never fight)', async () => {
    const { member, sessionId } = await memberWithEndedSession()
    const outDir = mkdtempSync(join(tmpdir(), 'wyd-norb-'))
    dirs.push(outDir)
    const port = await freePort()
    const logs: string[] = []
    const c = await startCompiler({
      uri: uri!, database: db!, token: workerToken, tokenFile: join(outDir, 'token'), outDir, port,
      publicUrl: `http://127.0.0.1:${port}`, quietMs: 0, retryMs: 60_000, pollMs: 300, ffmpegBin: 'ffmpeg', log: m => logs.push(m)
    })
    running.push(c)
    await waitFor('the render', () => existsSync(join(outDir, `session-${sessionId}-1.mp4`)))
    await sleep(2500)
    assert.equal(logs.some(l => l.includes('rebuilding')), false, logs.join(' | '))
    member.disconnect()
  })
})
