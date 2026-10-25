import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

const RENDER_TIMEOUT_MS = 5 * 60 * 1000

export const OUT_W = 1280
export const OUT_H = 720
export const OUT_FPS = 10
const OVERLAY_W = 200
const OVERLAY_MARGIN = 20
const OVERLAY_GAP = 10

/** A teammate's webcam clip laid over clip number `base` (index into the clip list), starting `offsetSecs` into it. */
export interface Overlay {
  base: number
  path: string
  offsetSecs: number
}

/**
 * ffmpeg arguments that join the clips (already in order) into one 1280x720, 10 fps H.264 mp4. Each input is
 * fitted into the frame (letterboxed, never stretched) and joined with the concat filter, so older low-res webcam
 * clips, the `mp4v` fallback or any other size/rate cannot break the join.
 * With `audioPath` the audio is looped endlessly and cut where the video ends (`-shortest`), so a short track
 * repeats under a long video and a long track is trimmed.
 */
export function ffmpegArgs(clipPaths: readonly string[], outPath: string, audioPath?: string, overlays: readonly Overlay[] = []): string[] {
  const fit = `scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=decrease,pad=${OUT_W}:${OUT_H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${OUT_FPS},format=yuv420p`
  // Inputs: the clips, then the overlay clips, then the soundtrack.
  const segments = clipPaths.map((_, i) => {
    const mine = overlays.map((o, j) => ({ o, j })).filter(x => x.o.base === i)
    if (mine.length === 0) return `[${i}:v]${fit}[v${i}]`
    // Teammates who joined this check-in: small bordered insets along the bottom-left (the drifter's own webcam is bottom-right),
    // each shifted to start when that person joined. Before that, and after it ends, the base shows through (eof_action=pass).
    const parts = [`[${i}:v]${fit}[b${i}_0]`]
    mine.forEach(({ o, j }, k) => {
      parts.push(`[${clipPaths.length + j}:v]scale=${OVERLAY_W - 4}:-2,pad=iw+4:ih+4:2:2:color=white,setpts=PTS-STARTPTS+${Math.max(0, o.offsetSecs).toFixed(3)}/TB,format=yuv420p[j${j}]`)
      const x = OVERLAY_MARGIN + k * (OVERLAY_W + OVERLAY_GAP)
      parts.push(`[b${i}_${k}][j${j}]overlay=x=${x}:y=H-h-${OVERLAY_MARGIN}:eof_action=pass:repeatlast=0[b${i}_${k + 1}]`)
    })
    parts.push(`[b${i}_${mine.length}]null[v${i}]`)
    return parts.join(';')
  })
  const inputs = clipPaths.map((_, i) => `[v${i}]`).join('')
  const audioIndex = clipPaths.length + overlays.length
  return [
    '-v', 'error', '-y',
    ...clipPaths.flatMap(p => ['-i', p]),
    ...overlays.flatMap(o => ['-i', o.path]),
    ...(audioPath ? ['-stream_loop', '-1', '-i', audioPath] : []),
    '-filter_complex', `${segments.join(';')};${inputs}concat=n=${clipPaths.length}:v=1:a=0[out]`,
    '-map', '[out]',
    ...(audioPath ? ['-map', `${audioIndex}:a:0`, '-c:a', 'aac', '-b:a', '160k', '-shortest'] : []),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outPath
  ]
}

/**
 * Join the clips into one mp4. Output is written next to `outPath` and renamed, so the file server never
 * serves a half-written video.
 */
export interface RenderResult {
  /** Indexes (into the `clips` argument) of clips that had no readable video and were left out. */
  skipped: number[]
  /** Indexes (into the `joiners` argument) of webcam clips left out: unreadable, or their base clip was. */
  skippedJoiners: number[]
}

/** A teammate's webcam clip to lay over `clips[base]`, starting `offsetSecs` into it. */
export interface JoinerInput {
  base: number
  data: Uint8Array
  offsetSecs: number
}

/** The ffprobe that ships with the given ffmpeg (same folder, or on PATH). */
export function ffprobeBin(ffmpegBin: string): string {
  const base = basename(ffmpegBin).replace('ffmpeg', 'ffprobe')
  return dirname(ffmpegBin) === '.' ? base : join(dirname(ffmpegBin), base)
}

/** true = has a video stream, false = unreadable, 'unknown' = ffprobe is not installed (let ffmpeg decide). */
async function hasVideo(file: string, probe: string): Promise<boolean | 'unknown'> {
  return new Promise(resolve => {
    const proc = spawn(probe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    proc.stdout.on('data', (b: Buffer) => { out += b.toString() })
    const timer = setTimeout(() => proc.kill('SIGKILL'), 30_000)
    proc.on('error', () => { clearTimeout(timer); resolve('unknown') })
    proc.on('exit', code => { clearTimeout(timer); resolve(code === 0 && out.includes('video')) })
  })
}

export async function renderCompilation(clips: readonly Uint8Array[], outPath: string, ffmpegBin = 'ffmpeg', audioPath?: string, joiners: readonly JoinerInput[] = []): Promise<RenderResult> {
  if (clips.length === 0) throw new Error('no clips to render')
  const dir = mkdtempSync(join(tmpdir(), 'wyd-compile-'))
  const part = `${outPath}.part.mp4`
  try {
    const paths = clips.map((data, i) => {
      const p = join(dir, `clip-${String(i).padStart(3, '0')}.mp4`)
      writeFileSync(p, data)
      return p
    })
    // One unreadable clip must not cost the whole session its video: probe each and join the rest.
    const probe = ffprobeBin(ffmpegBin)
    const verdicts = await Promise.all(paths.map(p => hasVideo(p, probe)))
    const skipped = verdicts.flatMap((ok, i) => (ok === false ? [i] : []))
    const readable = paths.filter((_, i) => !skipped.includes(i))
    if (readable.length === 0) throw new Error(`no readable clips (${skipped.length} unreadable)`)
    // An unreadable webcam clip only costs its inset; one whose base clip was left out has nothing to sit on.
    const joinerPaths = joiners.map((j, i) => {
      const p = join(dir, `join-${String(i).padStart(3, '0')}.mp4`)
      writeFileSync(p, j.data)
      return p
    })
    const joinerVerdicts = await Promise.all(joinerPaths.map(p => hasVideo(p, probe)))
    const skippedJoiners = joiners.flatMap((j, i) => (joinerVerdicts[i] === false || skipped.includes(j.base) ? [i] : []))
    const overlays: Overlay[] = joiners.flatMap((j, i) =>
      skippedJoiners.includes(i) ? [] : [{ base: readable.indexOf(paths[j.base]), path: joinerPaths[i], offsetSecs: j.offsetSecs }])
    // Checked per render, so dropping the file in takes effect without a restart; no file = silent video.
    await run(ffmpegBin, ffmpegArgs(readable, part, audioPath && existsSync(audioPath) ? audioPath : undefined, overlays))
    renameSync(part, outPath)
    return { skipped, skippedJoiners }
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
