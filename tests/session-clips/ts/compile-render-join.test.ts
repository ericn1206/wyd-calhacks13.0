import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { ffmpegArgs, renderCompilation } from '../../../worker/compile/render'

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0
const skip = hasFfmpeg ? false : 'ffmpeg not installed'

/** A solid-colour test clip. */
function makeColorClip(path: string, color: string, size: string, secs: number) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:size=${size}:rate=10`, '-t', String(secs), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path])
}

/** RGB of one pixel of the frame at `atSecs`. */
function pixelAt(video: string, atSecs: number, x: number, y: number): [number, number, number] {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(atSecs), '-i', video, '-vf', `format=rgb24,crop=1:1:${x}:${y}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1024 })
  return [raw[0], raw[1], raw[2]]
}

function durationSecs(path: string): number {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]).toString())
}

describe('ffmpegArgs with joiner overlays', () => {
  const overlays = [{ base: 0, path: '/t/j0.mp4', offsetSecs: 5 }, { base: 1, path: '/t/j1.mp4', offsetSecs: 2.5 }]

  it('adds the overlay clips after the clips and before the soundtrack', () => {
    const args = ffmpegArgs(['/t/a.mp4', '/t/b.mp4'], '/o/out.mp4', '/t/song.mp3', overlays)
    const inputs = args.flatMap((a, i) => (a === '-i' ? [args[i + 1]] : []))
    assert.deepEqual(inputs, ['/t/a.mp4', '/t/b.mp4', '/t/j0.mp4', '/t/j1.mp4', '/t/song.mp3'])
  })

  it('maps the soundtrack by the TOTAL input count, overlays included', () => {
    const args = ffmpegArgs(['/t/a.mp4', '/t/b.mp4'], '/o/out.mp4', '/t/song.mp3', overlays)
    assert.ok(args.includes('4:a:0'), args.join(' '))
  })

  it('shifts each overlay to its join time and puts it over its own clip only', () => {
    const graph = ffmpegArgs(['/t/a.mp4', '/t/b.mp4'], '/o/out.mp4', undefined, overlays).join(' ')
    assert.match(graph, /\[2:v\][^;]*setpts=PTS-STARTPTS\+5\.000\/TB[^;]*\[j0\]/)
    assert.match(graph, /\[3:v\][^;]*setpts=PTS-STARTPTS\+2\.500\/TB[^;]*\[j1\]/)
    assert.match(graph, /\[b0_0\]\[j0\]overlay=/)
    assert.match(graph, /\[b1_0\]\[j1\]overlay=/)
  })

  it('without overlays the graph has no overlay', () => {
    assert.ok(!ffmpegArgs(['/t/a.mp4'], '/o/out.mp4').join(' ').includes('overlay'))
  })
})

describe('renderCompilation with joiners', { skip }, () => {
  let dir: string
  before(() => { dir = mkdtempSync(join(tmpdir(), 'wyd-render-join-')) })
  after(() => rmSync(dir, { recursive: true, force: true }))
  // First inset: 200 px wide from x 20, bottom-left, ~151 px tall for a 4:3 clip -> (100, 620) is inside it.
  const INSET = [100, 620] as const
  const isGray = (p: number[]) => p.every(c => Math.abs(c - 128) < 16)
  const isRed = (p: number[]) => p[0] > 200 && p[1] < 60 && p[2] < 60

  it('shows the joiner only from the moment they joined; the video is as long as the drifter clip', async () => {
    const base = join(dir, 'base.mp4')
    const red = join(dir, 'red.mp4')
    makeColorClip(base, 'gray', '1280x720', 10)
    makeColorClip(red, 'red', '320x240', 8) // 5 s + 8 s = 13 s: runs past the end of the base clip
    const out = join(dir, 'out.mp4')
    const result = await renderCompilation([readFileSync(base)], out, 'ffmpeg', undefined, [{ base: 0, data: readFileSync(red), offsetSecs: 5 }])
    assert.deepEqual(result.skippedJoiners, [])
    assert.ok(isGray(pixelAt(out, 2, ...INSET)), `before the join: ${pixelAt(out, 2, ...INSET)}`)
    assert.ok(isRed(pixelAt(out, 8, ...INSET)), `after the join: ${pixelAt(out, 8, ...INSET)}`)
    assert.ok(isGray(pixelAt(out, 8, 640, 100)), 'the rest of the frame is the base clip')
    assert.ok(Math.abs(durationSecs(out) - 10) < 0.4, `duration ${durationSecs(out)}`)
  })

  it('puts a joiner over its own segment, not its neighbours', async () => {
    const a = join(dir, 'sa.mp4')
    const b = join(dir, 'sb.mp4')
    const red = join(dir, 'sred.mp4')
    makeColorClip(a, 'gray', '1280x720', 4)
    makeColorClip(b, 'gray', '1280x720', 4)
    makeColorClip(red, 'red', '320x240', 3)
    const out = join(dir, 'seg.mp4')
    await renderCompilation([readFileSync(a), readFileSync(b)], out, 'ffmpeg', undefined, [{ base: 1, data: readFileSync(red), offsetSecs: 0.5 }])
    assert.ok(isGray(pixelAt(out, 2, ...INSET)), 'first segment has no inset')
    assert.ok(isRed(pixelAt(out, 5.5, ...INSET)), 'second segment has the inset')
    assert.ok(Math.abs(durationSecs(out) - 8) < 0.4)
  })

  it('places several joiners side by side', async () => {
    const base = join(dir, 'mb.mp4')
    const red = join(dir, 'mr.mp4')
    const blue = join(dir, 'mbl.mp4')
    makeColorClip(base, 'gray', '1280x720', 6)
    makeColorClip(red, 'red', '320x240', 5)
    makeColorClip(blue, 'blue', '320x240', 5)
    const out = join(dir, 'multi.mp4')
    await renderCompilation([readFileSync(base)], out, 'ffmpeg', undefined, [
      { base: 0, data: readFileSync(red), offsetSecs: 0 },
      { base: 0, data: readFileSync(blue), offsetSecs: 0 }
    ])
    assert.ok(isRed(pixelAt(out, 2, 100, 620)))
    const [r, g, b] = pixelAt(out, 2, 330, 620) // second slot starts at x = 20 + 200 + 10
    assert.ok(b > 200 && r < 60 && g < 60, `second inset ${r},${g},${b}`)
  })

  it('keeps the soundtrack when joiners are added', async () => {
    const base = join(dir, 'ab.mp4')
    const red = join(dir, 'ar.mp4')
    const song = join(dir, 'song.m4a')
    makeColorClip(base, 'gray', '640x360', 3)
    makeColorClip(red, 'red', '320x240', 2)
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', song])
    const out = join(dir, 'audio.mp4')
    await renderCompilation([readFileSync(base)], out, 'ffmpeg', song, [{ base: 0, data: readFileSync(red), offsetSecs: 0.5 }])
    const streams = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', out]).toString()
    assert.match(streams, /audio/)
    assert.match(streams, /video/)
  })

  it('drops only the inset of an unreadable joiner clip', async () => {
    const base = join(dir, 'ub.mp4')
    makeColorClip(base, 'gray', '1280x720', 3)
    const out = join(dir, 'unreadable.mp4')
    const result = await renderCompilation([readFileSync(base)], out, 'ffmpeg', undefined, [{ base: 0, data: Buffer.from('garbage'), offsetSecs: 0 }])
    assert.deepEqual(result.skipped, [])
    assert.deepEqual(result.skippedJoiners, [0])
    assert.ok(isGray(pixelAt(out, 1, ...INSET)))
  })

  it('drops the joiners of a clip that was left out and keeps the others on the right segment', async () => {
    const good = join(dir, 'good.mp4')
    const red = join(dir, 'lred.mp4')
    makeColorClip(good, 'gray', '1280x720', 3)
    makeColorClip(red, 'red', '320x240', 2)
    const out = join(dir, 'leftout.mp4')
    const result = await renderCompilation([Buffer.from('garbage'), readFileSync(good)], out, 'ffmpeg', undefined, [
      { base: 0, data: readFileSync(red), offsetSecs: 0 }, // its base clip is unreadable
      { base: 1, data: readFileSync(red), offsetSecs: 0 }
    ])
    assert.deepEqual(result.skipped, [0])
    assert.deepEqual(result.skippedJoiners, [0])
    assert.ok(isRed(pixelAt(out, 1, ...INSET)))
  })
})
