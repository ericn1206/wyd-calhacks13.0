import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { ffmpegArgs, ffprobeBin, renderCompilation } from '../../../worker/compile/render'

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0
const skip = hasFfmpeg ? false : 'ffmpeg not installed'

/** A test clip made by ffmpeg: size/rate/duration vary so the join has to normalise them. */
function makeClip(path: string, size: string, rate: number, secs: number, codec = 'libx264') {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=${rate}`, '-t', String(secs), '-c:v', codec, '-pix_fmt', 'yuv420p', path])
}

function probe(path: string) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,r_frame_rate:format=duration', '-of', 'json', path]).toString()
  const j = JSON.parse(out)
  return { codec: j.streams[0].codec_name as string, w: j.streams[0].width as number, h: j.streams[0].height as number, fps: j.streams[0].r_frame_rate as string, secs: Number(j.format.duration) }
}

describe('ffmpegArgs', () => {
  it('takes every clip as an input, in order, and writes the given path', () => {
    const args = ffmpegArgs(['/t/a.mp4', '/t/b.mp4', '/t/c.mp4'], '/o/out.mp4')
    const inputs = args.flatMap((a, i) => (a === '-i' ? [args[i + 1]] : []))
    assert.deepEqual(inputs, ['/t/a.mp4', '/t/b.mp4', '/t/c.mp4'])
    assert.equal(args.at(-1), '/o/out.mp4')
  })

  it('normalises each input then concats them in order, as faststart H.264', () => {
    const args = ffmpegArgs(['/t/a.mp4', '/t/b.mp4'], '/o/out.mp4')
    const graph = args[args.indexOf('-filter_complex') + 1]
    assert.match(graph, /\[0:v\]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720.*fps=10.*\[v0\]/)
    assert.match(graph, /\[1:v\]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720.*fps=10.*\[v1\]/)
    assert.match(graph, /\[v0\]\[v1\]concat=n=2:v=1:a=0\[out\]/)
    assert.ok(args.includes('libx264') && args.includes('+faststart'))
  })
})

describe('ffprobeBin', () => {
  it('finds ffprobe next to the given ffmpeg, or on PATH', () => {
    assert.equal(ffprobeBin('ffmpeg'), 'ffprobe')
    assert.equal(ffprobeBin('/opt/homebrew/bin/ffmpeg'), '/opt/homebrew/bin/ffprobe')
    assert.equal(ffprobeBin('/x/ffmpeg-7/bin/ffmpeg'), '/x/ffmpeg-7/bin/ffprobe')
  })
})

describe('ffmpegArgs audio', () => {
  it('loops the track as the last input and stops at the end of the video', () => {
    const args = ffmpegArgs(['/t/a.mp4', '/t/b.mp4'], '/o/out.mp4', '/t/song.mp3')
    const i = args.indexOf('-stream_loop')
    assert.deepEqual(args.slice(i, i + 4), ['-stream_loop', '-1', '-i', '/t/song.mp3'])
    assert.ok(args.includes('2:a:0') && args.includes('-shortest'))
  })

  it('adds no audio options without a track', () => {
    const args = ffmpegArgs(['/t/a.mp4'], '/o/out.mp4')
    assert.ok(!args.includes('-stream_loop') && !args.includes('-shortest'))
  })
})

describe('renderCompilation', { skip }, () => {
  let dir: string
  before(() => { dir = mkdtempSync(join(tmpdir(), 'wyd-render-')) })
  after(() => rmSync(dir, { recursive: true, force: true }))

  it('joins clips in the given order into one 1280x720 10 fps H.264 video', async () => {
    const a = join(dir, 'a.mp4')
    const b = join(dir, 'b.mp4')
    makeClip(a, '1280x720', 10, 2)
    makeClip(b, '320x240', 8, 1) // an older low-res webcam clip
    const out = join(dir, 'out.mp4')
    await renderCompilation([readFileSync(a), readFileSync(b)], out)
    const info = probe(out)
    assert.equal(info.codec, 'h264')
    assert.deepEqual([info.w, info.h], [1280, 720])
    assert.equal(info.fps, '10/1')
    assert.ok(Math.abs(info.secs - 3) < 0.4, `duration ${info.secs}`)
  })

  it('letterboxes a 4:3 clip instead of stretching it', async () => {
    const a = join(dir, 'box.mp4')
    makeClip(a, '640x480', 10, 1)
    const out = join(dir, 'box-out.mp4')
    await renderCompilation([readFileSync(a)], out)
    // 640x480 fitted into 1280x720 is 960x720: black bars of 160 px on each side, picture in the middle.
    const px = (x: number) => execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-vf', `crop=2:2:${x}:360`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1024 }).readUInt8(0)
    assert.ok(px(40) < 24, `left bar luma ${px(40)}`)
    assert.ok(px(1240) < 24, `right bar luma ${px(1240)}`)
    assert.ok(px(640) > 24, `centre luma ${px(640)}`)
  })

  it('accepts clips written with the mp4v fallback codec', async () => {
    const a = join(dir, 'm.mp4')
    makeClip(a, '320x240', 8, 1, 'mpeg4')
    const out = join(dir, 'mpeg4.mp4')
    await renderCompilation([readFileSync(a)], out)
    assert.equal(probe(out).codec, 'h264')
  })

  it('leaves no .part file or temp files behind', async () => {
    const a = join(dir, 'c.mp4')
    makeClip(a, '320x240', 8, 1)
    const out = join(dir, 'clean.mp4')
    await renderCompilation([readFileSync(a)], out)
    assert.equal(existsSync(`${out}.part.mp4`), false)
    assert.equal(readdirSync(dir).some(f => f.endsWith('.part.mp4')), false)
  })

  it('rejects when no clip is readable and writes no output', async () => {
    const out = join(dir, 'bad.mp4')
    await assert.rejects(renderCompilation([Buffer.from('not a video'), Buffer.from('also not')], out), /no readable clips \(2 unreadable\)/)
    assert.equal(existsSync(out), false)
    assert.equal(existsSync(`${out}.part.mp4`), false)
  })

  it('leaves an unreadable clip out and joins the rest', async () => {
    const a = join(dir, 'g1.mp4')
    const b = join(dir, 'g2.mp4')
    makeClip(a, '320x240', 8, 2)
    makeClip(b, '320x240', 8, 1)
    const out = join(dir, 'skip.mp4')
    const result = await renderCompilation([readFileSync(a), Buffer.from('garbage, not an mp4'), readFileSync(b)], out)
    assert.deepEqual(result.skipped, [1])
    assert.ok(Math.abs(probe(out).secs - 3) < 0.4, `duration ${probe(out).secs}`)
  })

  it('treats a truncated file as unreadable too', async () => {
    const a = join(dir, 't1.mp4')
    const b = join(dir, 't2.mp4')
    makeClip(a, '320x240', 8, 2)
    makeClip(b, '320x240', 8, 1)
    const whole = readFileSync(b)
    const out = join(dir, 'trunc.mp4')
    const result = await renderCompilation([readFileSync(a), whole.subarray(0, 40)], out)
    assert.deepEqual(result.skipped, [1])
    assert.ok(existsSync(out))
  })

  it('reports nothing skipped when every clip is fine', async () => {
    const a = join(dir, 'ok.mp4')
    makeClip(a, '320x240', 8, 1)
    assert.deepEqual((await renderCompilation([readFileSync(a)], join(dir, 'ok-out.mp4'))).skipped, [])
  })

  it('still renders when ffprobe is not installed next to ffmpeg (nothing is skipped)', async () => {
    const bin = join(dir, 'only-ffmpeg')
    mkdirSync(bin)
    symlinkSync(execFileSync('which', ['ffmpeg']).toString().trim(), join(bin, 'ffmpeg'))
    const a = join(dir, 'np.mp4')
    makeClip(a, '320x240', 8, 1)
    const result = await renderCompilation([readFileSync(a)], join(dir, 'np-out.mp4'), join(bin, 'ffmpeg'))
    assert.deepEqual(result.skipped, [])
  })

  it('rejects when there are no clips', async () => {
    await assert.rejects(renderCompilation([], join(dir, 'none.mp4')), /no clips/)
  })

  it('reports a missing ffmpeg binary clearly', async () => {
    await assert.rejects(renderCompilation([Buffer.from('x')], join(dir, 'x.mp4'), '/nonexistent/ffmpeg'), /cannot run/)
  })
})
