import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { ffmpegArgs, renderCompilation } from '../../../worker/compile/render'

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
    assert.match(graph, /\[0:v\]scale=320:240.*fps=8.*\[v0\]/)
    assert.match(graph, /\[1:v\]scale=320:240.*fps=8.*\[v1\]/)
    assert.match(graph, /\[v0\]\[v1\]concat=n=2:v=1:a=0\[out\]/)
    assert.ok(args.includes('libx264') && args.includes('+faststart'))
  })
})

describe('renderCompilation', { skip }, () => {
  let dir: string
  before(() => { dir = mkdtempSync(join(tmpdir(), 'wyd-render-')) })
  after(() => rmSync(dir, { recursive: true, force: true }))

  it('joins clips in the given order into one 320x240 8 fps H.264 video', async () => {
    const a = join(dir, 'a.mp4')
    const b = join(dir, 'b.mp4')
    makeClip(a, '320x240', 8, 2)
    makeClip(b, '640x480', 25, 1) // different size and rate than the camera clips
    const out = join(dir, 'out.mp4')
    await renderCompilation([readFileSync(a), readFileSync(b)], out)
    const info = probe(out)
    assert.equal(info.codec, 'h264')
    assert.deepEqual([info.w, info.h], [320, 240])
    assert.equal(info.fps, '8/1')
    assert.ok(Math.abs(info.secs - 3) < 0.4, `duration ${info.secs}`)
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

  it('rejects with the ffmpeg error for corrupt input and writes no output', async () => {
    const out = join(dir, 'bad.mp4')
    writeFileSync(join(dir, 'junk.bin'), 'not a video')
    await assert.rejects(renderCompilation([Buffer.from('not a video')], out), /ffmpeg/)
    assert.equal(existsSync(out), false)
    assert.equal(existsSync(`${out}.part.mp4`), false)
  })

  it('rejects when there are no clips', async () => {
    await assert.rejects(renderCompilation([], join(dir, 'none.mp4')), /no clips/)
  })

  it('reports a missing ffmpeg binary clearly', async () => {
    await assert.rejects(renderCompilation([Buffer.from('x')], join(dir, 'x.mp4'), '/nonexistent/ffmpeg'), /cannot run/)
  })
})
