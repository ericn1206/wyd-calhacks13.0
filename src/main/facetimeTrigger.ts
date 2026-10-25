import { type ChildProcess, spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

let child: ChildProcess | null = null

/** One `debug {...}` line from vision/facetime_trigger.py (one per 10 s interval), plus arrival time. */
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
export function startFacetimeTrigger(goal: string, onTrigger: () => void, onStatus: (offTask: boolean) => void, onDebug: (entry: DetectorDebug) => void, sites = ''): void {
  stopFacetimeTrigger()
  const root = projectRoot()
  const python = join(root, 'vision/.venv/bin/python')
  const script = join(root, 'vision/facetime_trigger.py')
  if (!existsSync(python)) {
    console.error('[facetime] no vision/.venv. Run npm run setup:vision')
    return
  }
  // Second argument: everything the user mentioned (sites/apps); the trigger allows only apps named there.
  const args = [script, goal]
  if (sites.trim()) args.push(sites)
  const proc = spawn(python, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
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
  proc.on('exit', (code) => {
    if (child === proc) child = null
    if (code) console.error(`[facetime] trigger exited (${code})`)
  })
}

export function stopFacetimeTrigger(): void {
  const proc = child
  child = null
  proc?.kill('SIGTERM')
}
