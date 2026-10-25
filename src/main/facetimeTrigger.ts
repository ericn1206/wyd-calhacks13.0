import { type ChildProcess, spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

let child: ChildProcess | null = null

/** One `debug {...}` line from vision/facetime_trigger.py (one per 5 s interval), plus arrival time. */
export interface DetectorDebug {
  t: number
  status: 'on' | 'off' | 'none'
  screen: 'ok' | 'off' | 'unknown'
  reason: string
  ocrChars: number
  webcam: 'focused' | 'distracted' | 'none'
  face: boolean
  prob: number
  screenStreak: number
  camStreak: number
}

/** Reply from vision/detector.py for a `clip <path>` request: the mp4 is finished, or `clip` is null with `error`. */
export interface ClipInfo {
  clip: string | null
  error?: string
  /** Off-task moment (epoch ms) and first frame (epoch ms). */
  t: number
  startedAt: number
  durationMs: number
  width: number
  height: number
  fps: number
  /** The clip includes the person's screen (not just the webcam). */
  hasScreen?: boolean
}

function projectRoot(): string {
  const candidates = [process.cwd(), app.getAppPath(), join(app.getAppPath(), '..'), join(__dirname, '..', '..')]
  for (const dir of candidates) {
    if (existsSync(join(dir, 'vision/facetime_trigger.py'))) return dir
  }
  return process.cwd()
}

/**
 * Run vision/facetime_trigger.py. A stdout line `face time` starts a circle check-in;
 * `status on` / `status off` (every interval with a verdict) drive the status dots.
 */
export function startFacetimeTrigger(
  goal: string,
  onTrigger: () => void,
  onStatus: (offTask: boolean) => void,
  onDebug: (entry: DetectorDebug) => void,
  onClip: (info: ClipInfo) => void,
  sites = ''
): void {
  stopFacetimeTrigger()
  const root = projectRoot()
  const python = join(root, 'vision/.venv/bin/python')
  const script = join(root, 'vision/facetime_trigger.py')
  if (!existsSync(python)) {
    console.error('[facetime] no vision/.venv. Run npm run setup:vision')
    return
  }
  // Second argument: sites/apps they mentioned. Passed to Gemini as context, not a hard allowlist.
  const args = [script, goal]
  if (sites.trim()) args.push(sites)
  // stdin stays open: `clip <path>` lines request a session clip (see requestClip).
  // WYD_APP_PID: the detector leaves this app's windows (overlay with the check-in tiles) out of the screen clip.
  const proc = spawn(python, args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, WYD_APP_PID: String(process.pid) } })
  child = proc
  let pending = ''
  proc.stdout?.on('data', (buf: Buffer) => {
    pending += buf.toString()
    let nl = pending.indexOf('\n')
    while (nl !== -1) {
      const line = pending.slice(0, nl).trim()
      pending = pending.slice(nl + 1)
      if (line === 'face time') {
        console.log('[facetime] face time → opening check-in')
        onTrigger()
      }
      else if (line === 'status on' || line === 'status off') onStatus(line === 'status off')
      else if (line.startsWith('clip {')) {
        try {
          onClip(JSON.parse(line.slice(5)) as ClipInfo)
        } catch {
          // malformed clip line; ignore
        }
      }
      else if (line.startsWith('debug {')) {
        try {
          onDebug({ ...(JSON.parse(line.slice(6)) as Omit<DetectorDebug, 't'>), t: Date.now() })
        } catch {
          // malformed debug line; ignore
        }
      }
      else if (line) process.stdout.write(`${line}\n`)
      nl = pending.indexOf('\n')
    }
  })
  proc.stderr?.on('data', (buf: Buffer) => process.stderr.write(buf))
  proc.stdin?.on('error', () => { /* trigger already exited */ })
  proc.on('exit', (code) => {
    if (child === proc) child = null
    if (code) console.error(`[facetime] trigger exited (${code})`)
  })
}

/** Ask the webcam detector for a 30 s clip (10 s before now, 20 s after) written to `path`. False when tracking is off. */
export function requestClip(path: string): boolean {
  const stdin = child?.stdin
  if (!stdin || stdin.destroyed) return false
  stdin.write(`clip ${path}\n`)
  return true
}

export function stopFacetimeTrigger(): void {
  const proc = child
  child = null
  proc?.kill('SIGTERM')
}
