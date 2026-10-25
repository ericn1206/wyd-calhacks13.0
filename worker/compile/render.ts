import { spawn } from 'node:child_process'
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RENDER_TIMEOUT_MS = 5 * 60 * 1000

export const OUT_W = 1280
export const OUT_H = 720
export const OUT_FPS = 10

/**
 * ffmpeg arguments that join the clips (already in order) into one 1280x720, 10 fps H.264 mp4. Each input is
 * fitted into the frame (letterboxed, never stretched) and joined with the concat filter, so older low-res webcam
 * clips, the `mp4v` fallback or any other size/rate cannot break the join.
 */
export function ffmpegArgs(clipPaths: readonly string[], outPath: string): string[] {
  const fit = `scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=decrease,pad=${OUT_W}:${OUT_H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${OUT_FPS},format=yuv420p`
  const normalised = clipPaths.map((_, i) => `[${i}:v]${fit}[v${i}]`)
  const inputs = clipPaths.map((_, i) => `[v${i}]`).join('')
  return [
    '-v', 'error', '-y',
    ...clipPaths.flatMap(p => ['-i', p]),
    '-filter_complex', `${normalised.join(';')};${inputs}concat=n=${clipPaths.length}:v=1:a=0[out]`,
    '-map', '[out]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outPath
  ]
}

/**
 * Join the clips into one mp4. Output is written next to `outPath` and renamed, so the file server never
 * serves a half-written video.
 */
export async function renderCompilation(clips: readonly Uint8Array[], outPath: string, ffmpegBin = 'ffmpeg'): Promise<void> {
  if (clips.length === 0) throw new Error('no clips to render')
  const dir = mkdtempSync(join(tmpdir(), 'wyd-compile-'))
  const part = `${outPath}.part.mp4`
  try {
    const paths = clips.map((data, i) => {
      const p = join(dir, `clip-${String(i).padStart(3, '0')}.mp4`)
      writeFileSync(p, data)
      return p
    })
    await run(ffmpegBin, ffmpegArgs(paths, part))
    renameSync(part, outPath)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(part, { force: true })
  }
}

function run(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    proc.stderr.on('data', (b: Buffer) => { err = (err + b.toString()).slice(-2000) })
    const timer = setTimeout(() => proc.kill('SIGKILL'), RENDER_TIMEOUT_MS)
    proc.on('error', e => { clearTimeout(timer); reject(new Error(`cannot run ${bin}: ${e.message}`)) })
    proc.on('exit', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg ${signal ?? `exit ${code}`}: ${err.trim().split('\n').slice(-3).join(' | ')}`))
    })
  })
}
