// Two members in one session: the drifter's clip plus a teammate's webcam clip (uploaded as `join-`) -> one video with
// the teammate in an inset, counted in clip_count. Same opt-in env as compile.integration.test.ts. See ../README.md.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

function colourClip(color: string, size: string, secs: number): string {
  const path = newClipPath()
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:size=${size}:rate=10`, '-t', String(secs), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path])
  return path
}

function pixelAt(video: string, atSecs: number, x: number, y: number): [number, number, number] {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(atSecs), '-i', video, '-vf', `format=rgb24,crop=1:1:${x}:${y}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1024 })
  return [raw[0], raw[1], raw[2]]
}

describe('clip compilation with a teammate who joined the check-in', { skip }, () => {
  let compiler: RunningCompiler | undefined
  after(async () => {
    await compiler?.stop()
    dirs.forEach(d => rmSync(d, { recursive: true, force: true }))
  })

  it('lays the teammate\'s clip over the drifter\'s; clip_count counts both; an unmatched teammate clip is noted and left out', async () => {
    const drifter = await client()
    await drifter.call('createSession', {
      name: 'join it',
      settings: { pomodoroWorkSecs: none, pomodoroBreakSecs: none, offTaskThresholdSecs: none, callCooldownSecs: none, maxCallSecs: none, scoreboardEnabled: none, groupCallEnabled: none, topicDescription: none, allowedDomains: none, blockedDomains: none },
      code: none
    })
    await sleep(500)
    const code = drifter.snapshot().tables.sessions.map(s => s.code as string).at(-1)!
    const teammate = await client()
    await teammate.call('joinSession', { code })
    await sleep(500)

    const t0 = Date.now()
    // Drifter: 30 s clip, moment at +10 s (first frame at t0). Teammate joined at +13 s: 20 s of webcam from there.
    // Another teammate clip hours later belongs to no check-in.
    await uploadClip(drifter, { clip: colourClip('gray', '1280x720', 8), t: t0 + 10_000, startedAt: t0, durationMs: 8_000, width: 1280, height: 720, fps: 10 })
    await uploadClip(teammate, { clip: colourClip('red', '320x240', 4), t: t0 + 13_000, startedAt: t0 + 3_000, durationMs: 4_000, width: 320, height: 240, fps: 10 }, { joiner: true })
    await uploadClip(teammate, { clip: colourClip('blue', '320x240', 4), t: t0 + 7_200_000, startedAt: t0 + 7_200_000, durationMs: 4_000, width: 320, height: 240, fps: 10 }, { joiner: true })
    await drifter.call('endSession', {})

    const outDir = mkdtempSync(join(tmpdir(), 'wyd-out-'))
    dirs.push(outDir)
    const port = await freePort()
    compiler = await startCompiler({
      uri: uri!, database: db!, token: workerToken, tokenFile: join(outDir, 'token'), outDir, port,
      publicUrl: `http://127.0.0.1:${port}`, quietMs: 0, retryMs: 1000, pollMs: 300, ffmpegBin: 'ffmpeg', log: () => {}
    })

    const row = await until('Ready compilation (3 clips)', () => drifter.snapshot().tables.compilations.find(r => (r.status as { tag: string }).tag === 'Ready' && r.clipCount === 3))
    assert.match(row.url as string, /^\/compilations\/session-\d+-3\.mp4$/, 'named by the TOTAL clip count, joiners included')
    assert.match(String(row.error), /1 teammate clip\(s\) without a matching check-in left out/)

    const res = await fetch(`http://127.0.0.1:${port}${row.url}`)
    assert.equal(res.status, 200)
    const file = join(outDir, 'fetched.mp4')
    writeFileSync(file, Buffer.from(await res.arrayBuffer()))
    const isGray = (p: number[]) => p.every(c => Math.abs(c - 128) < 16)
    const [r, g, b] = pixelAt(file, 5, 100, 620)
    assert.ok(isGray(pixelAt(file, 1, 100, 620)), 'no inset before the teammate joined')
    assert.ok(r > 200 && g < 60 && b < 60, `teammate inset after joining: ${r},${g},${b}`)

    // Stays Ready: the session is not re-queued for rendering (clip_count matches what the module counts).
    await sleep(2000)
    assert.ok(drifter.snapshot().tables.compilations.some(x => (x.status as { tag: string }).tag === 'Ready' && x.clipCount === 3))
    await compiler.stop()
    compiler = undefined
    drifter.disconnect()
    teammate.disconnect()
  })
})
