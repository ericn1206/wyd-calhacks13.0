// The single-compiler lease, on a real database. Opt-in like compile.integration.test.ts:
// WYD_TEST_STDB_URI, WYD_TEST_STDB_DB and WYD_TEST_WORKER_TOKEN (see ../README.md).
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, afterEach, describe, it } from 'node:test'
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
    lease: { label, takeover }, leaseHeartbeatMs: 300,
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
