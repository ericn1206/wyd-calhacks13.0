// End to end: clips uploaded by a member -> session ends -> the compiler (as a worker identity) joins them ->
// the video is served over HTTP and its URL appears in the member's `compilations` view.
// Opt-in: needs WYD_TEST_STDB_URI, WYD_TEST_STDB_DB (scratch db with this module) and WYD_TEST_WORKER_TOKEN
// (token of an authorized worker, i.e. the identity that published the db). Also needs ffmpeg. See ../README.md.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { startCompiler, type RunningCompiler } from '../../../worker/compile/compiler'
import { StdbClient } from '../../../src/main/db/stdb'
import { newClipPath, uploadClip } from '../../../src/main/clipUpload'

const uri = process.env['WYD_TEST_STDB_URI']
const db = process.env['WYD_TEST_STDB_DB']
const workerToken = process.env['WYD_TEST_WORKER_TOKEN']
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0
const skip = !uri || !db || !workerToken ? 'set WYD_TEST_STDB_URI, WYD_TEST_STDB_DB, WYD_TEST_WORKER_TOKEN to run' : !hasFfmpeg ? 'ffmpeg not installed' : false

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const dirs: string[] = []
const none = undefined

async function until<T>(what: string, fn: () => T | undefined | false, ms = 30_000): Promise<T> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = fn()
    if (v) return v
    await sleep(200)
  }
  throw new Error(`timed out waiting for ${what}`)
}

async function freePort(): Promise<number> {
  return new Promise(resolve => {
    const s = createServer().listen(0, () => {
      const p = (s.address() as { port: number }).port
      s.close(() => resolve(p))
    })
  })
}

async function client(): Promise<StdbClient> {
  const dir = mkdtempSync(join(tmpdir(), 'wyd-it-'))
  dirs.push(dir)
  process.env['WYD_TEST_USERDATA'] = dir
  process.env['SPACETIME_URI'] = uri
  process.env['SPACETIME_DB'] = db
  const c = new StdbClient()
  await c.connect()
  await sleep(1500)
  return c
}

function realClip(secs: number): string {
  const path = newClipPath()
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=8', '-t', String(secs), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path])
  return path
}

const uploadReal = (c: StdbClient, secs: number, momentAt: number) =>
  uploadClip(c, { clip: realClip(secs), t: momentAt, startedAt: momentAt - 10_000, durationMs: secs * 1000, width: 320, height: 240, fps: 8 })

const ready = (c: StdbClient, count: number) =>
  c.snapshot().tables.compilations.find(r => (r.status as { tag: string }).tag === 'Ready' && r.clipCount === count)

function secs(file: string): number {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString())
}

describe('clip compilation, end to end', { skip }, () => {
  let compiler: RunningCompiler | undefined
  after(async () => {
    await compiler?.stop()
    dirs.forEach(d => rmSync(d, { recursive: true, force: true }))
  })

  it('renders, hosts and publishes the video; a late clip triggers a re-render', async () => {
    const member = await client()
    await member.call('createSession', {
      name: 'compile it',
      settings: { pomodoroWorkSecs: none, pomodoroBreakSecs: none, offTaskThresholdSecs: none, callCooldownSecs: none, maxCallSecs: none, scoreboardEnabled: none, groupCallEnabled: none, topicDescription: none, allowedDomains: none, blockedDomains: none },
      code: none
    })
    await sleep(300)
    const now = Date.now()
    await uploadReal(member, 2, now + 5_000) // uploaded first, happened second
    await uploadReal(member, 3, now)
    await member.call('endSession', {})

    const outDir = mkdtempSync(join(tmpdir(), 'wyd-out-'))
    dirs.push(outDir)
    const port = await freePort()
    compiler = await startCompiler({
      uri: uri!,
      database: db!,
      token: workerToken,
      tokenFile: join(outDir, 'token'),
      outDir,
      port,
      publicUrl: `http://127.0.0.1:${port}`,
      quietMs: 0,
      retryMs: 1000,
      pollMs: 300,
      ffmpegBin: 'ffmpeg',
      log: () => {}
    })

    const row = await until('Ready compilation (2 clips)', () => ready(member, 2))
    const url = row.url as string
    assert.match(url, new RegExp(`^http://127\\.0\\.0\\.1:${port}/compilations/session-\\d+-2\\.mp4$`))

    const res = await fetch(url)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'video/mp4')
    const file = join(outDir, 'fetched.mp4')
    writeFileSync(file, Buffer.from(await res.arrayBuffer()))
    assert.ok(Math.abs(secs(file) - 5) < 0.6, `compilation is ${secs(file)} s, expected ~5`)

    // A clip that finishes uploading after the session ended (within the grace window) is added.
    await uploadReal(member, 1, now + 1_000)
    const again = await until('Ready compilation (3 clips)', () => ready(member, 3))
    const url3 = again.url as string
    assert.match(url3, /session-\d+-3\.mp4$/)
    const res3 = await fetch(url3)
    assert.equal(res3.status, 200)
    writeFileSync(file, Buffer.from(await res3.arrayBuffer()))
    assert.ok(Math.abs(secs(file) - 6) < 0.7, `compilation is ${secs(file)} s, expected ~6`)
    assert.equal((await fetch(url)).status, 404, 'the old render is removed')
    assert.ok(readFileSync(file).length > 0)
    member.disconnect()
  })

  it('an ended session with no clips reports empty, and a dropped connection reports offline then recovers', async () => {
    const member = await client()
    await member.call('createSession', {
      name: 'no clips',
      settings: { pomodoroWorkSecs: none, pomodoroBreakSecs: none, offTaskThresholdSecs: none, callCooldownSecs: none, maxCallSecs: none, scoreboardEnabled: none, groupCallEnabled: none, topicDescription: none, allowedDomains: none, blockedDomains: none },
      code: none
    })
    await sleep(300)
    const sessionId = member.snapshot().tables.sessions.map(s => Number(s.id)).sort((a, b) => b - a)[0]
    const outDir = mkdtempSync(join(tmpdir(), 'wyd-out-'))
    dirs.push(outDir)
    const port = await freePort()
    const logs: string[] = []
    const c = await startCompiler({
      uri: uri!, database: db!, token: workerToken, tokenFile: join(outDir, 'token'), outDir, port,
      publicUrl: `http://127.0.0.1:${port}`, quietMs: 0, emptyGraceMs: 1500, reconnectMs: 200, callTimeoutMs: 3000, retryMs: 1000, pollMs: 300, ffmpegBin: 'ffmpeg',
      log: m => logs.push(m)
    })
    const status = async () => (await (await fetch(`http://127.0.0.1:${port}/session/${sessionId}/status`)).json()) as { state: string }

    assert.equal((await status()).state, 'waiting', 'a running session is waiting')
    await member.call('endSession', {})
    let state = ''
    const end = Date.now() + 20_000
    while (Date.now() < end && state !== 'empty') { state = (await status()).state; if (state !== 'empty') await sleep(300) }
    assert.equal(state, 'empty', 'ended without any clip')

    c.dropConnection()
    await sleep(50)
    assert.equal((await status()).state, 'offline', 'no database connection')
    const back = Date.now() + 20_000
    while (Date.now() < back && (await status()).state === 'offline') await sleep(300)
    assert.notEqual((await status()).state, 'offline', 'reconnected')
    assert.ok(logs.some(l => l.includes('reconnected')), logs.join(' | '))
    assert.equal(await (async () => { for (let i = 0; i < 60; i++) { const s = (await status()).state; if (s === 'empty') return s; await sleep(300) } return 'never' })(), 'empty', 'state is correct again after reconnecting')
    await c.stop()
    member.disconnect()
  })

  it('a session that ended before the compiler started is not treated as fresh activity (restart)', async () => {
    const member = await client()
    await member.call('createSession', {
      name: 'ended before start',
      settings: { pomodoroWorkSecs: none, pomodoroBreakSecs: none, offTaskThresholdSecs: none, callCooldownSecs: none, maxCallSecs: none, scoreboardEnabled: none, groupCallEnabled: none, topicDescription: none, allowedDomains: none, blockedDomains: none },
      code: none
    })
    await sleep(300)
    const sessionId = member.snapshot().tables.sessions.map(s => Number(s.id)).sort((a, b) => b - a)[0]
    await member.call('endSession', {})
    await sleep(500)
    const outDir = mkdtempSync(join(tmpdir(), 'wyd-out-'))
    dirs.push(outDir)
    const port = await freePort()
    // A long quiet period: if the startup snapshot counted as activity this would stay `waiting` for a minute.
    const c = await startCompiler({
      uri: uri!, database: db!, token: workerToken, tokenFile: join(outDir, 'token'), outDir, port,
      publicUrl: `http://127.0.0.1:${port}`, quietMs: 60_000, emptyGraceMs: 0, retryMs: 1000, pollMs: 300, ffmpegBin: 'ffmpeg', log: () => {}
    })
    let state = ''
    const end = Date.now() + 8_000
    while (Date.now() < end && state !== 'empty') {
      state = ((await (await fetch(`http://127.0.0.1:${port}/session/${sessionId}/status`)).json()) as { state: string }).state
      if (state !== 'empty') await sleep(300)
    }
    assert.equal(state, 'empty')
    await c.stop()
    member.disconnect()
  })

  it('the compiler publishes its page address, which every client can read', async () => {
    const reader = await client()
    const outDir = mkdtempSync(join(tmpdir(), 'wyd-out-'))
    dirs.push(outDir)
    const port = await freePort()
    const second = await startCompiler({
      uri: uri!, database: db!, token: workerToken, tokenFile: join(outDir, 'token'), outDir, port,
      publicUrl: `http://10.1.2.3:${port}/`, quietMs: 60_000, retryMs: 1000, pollMs: 300, ffmpegBin: 'ffmpeg', log: () => {}
    })
    const row = await until('clip_page_base_url setting', () => reader.snapshot().tables.settings.find(s => s.key === 'clip_page_base_url' && String(s.valueJson).includes('10.1.2.3')))
    assert.equal(JSON.parse(row.valueJson as string), `http://10.1.2.3:${port}`, 'trailing slash removed')
    await second.stop()
    reader.disconnect()
  })

  it('only a worker can set the page address', async () => {
    const stranger = await client()
    await assert.rejects(stranger.call('setClipPageBaseUrl', { url: 'http://evil:1' }), /only the AI worker/)
    stranger.disconnect()
  })

  it('the page address must be an http(s) url', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wyd-it-'))
    dirs.push(dir)
    writeFileSync(join(dir, 'stdb-token.json'), JSON.stringify({ token: workerToken }))
    process.env['WYD_TEST_USERDATA'] = dir
    process.env['SPACETIME_URI'] = uri
    process.env['SPACETIME_DB'] = db
    const asWorker = new StdbClient()
    await asWorker.connect()
    await sleep(1500)
    for (const bad of ['javascript:alert(1)', 'ftp://h/x', 'http://has space', '', `http://h/${'x'.repeat(250)}`]) {
      await assert.rejects(asWorker.call('setClipPageBaseUrl', { url: bad }), /bad url/, bad)
    }
    asWorker.disconnect()
  })

  it('only a worker can write compilation state', async () => {
    const stranger = await client()
    await assert.rejects(
      stranger.call('setSessionCompilation', { sessionId: 1n, status: { tag: 'Ready' }, clipCount: 1, url: 'http://evil', error: none }),
      /only the AI worker/
    )
    stranger.disconnect()
  })
})
