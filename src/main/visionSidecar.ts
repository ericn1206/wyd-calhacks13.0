import { spawn, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { createInterface } from 'readline'

const MAX_RESTARTS = 5

/** `focus` is what the UI and the LiveKit `focus` attribute show. */
export interface VisionState {
  focus: 'focused' | 'away' | 'noface' | 'off'
  face: boolean
  prob: number
  eyes: 'open' | 'closed'
  t: number
  reason?: string
}

interface DetectorLine {
  t: number
  face: boolean
  prob: number
  distracted: boolean
  eyes: 'open' | 'closed'
}

let child: ChildProcess | null = null
let retry: ReturnType<typeof setTimeout> | null = null
let running = false

export function visionOff(reason: string): VisionState {
  return { focus: 'off', face: false, prob: 0, eyes: 'open', t: Date.now(), reason }
}

function toState(line: DetectorLine): VisionState {
  const focus = !line.face ? 'noface' : line.distracted ? 'away' : 'focused'
  return { focus, face: line.face, prob: line.prob, eyes: line.eyes, t: line.t }
}

/**
 * Run vision/detector.py (Python sidecar) and report one state per second.
 * Never throws: a missing venv or model reports `focus: 'off'` with a reason.
 */
export function startVision(root: string, onUpdate: (state: VisionState) => void): void {
  if (running) return
  const python = join(root, 'vision/.venv/bin/python')
  const script = join(root, 'vision/detector.py')
  const model = process.env['VISION_MODEL']?.trim() || join(root, 'vision/distraction_model.json')

  if (!existsSync(python)) {
    console.log('[vision] off: run `npm run setup:vision` to create vision/.venv')
    onUpdate(visionOff('Run npm run setup:vision'))
    return
  }
  if (!existsSync(model)) {
    console.log(`[vision] off: no model at ${model}`)
    onUpdate(visionOff('No webcam model yet'))
    return
  }

  running = true
  let restarts = 0

  const launch = () => {
    if (!running) return
    const proc = spawn(python, [script, '--model', model], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] })
    child = proc
    let lastError = ''

    createInterface({ input: proc.stdout! }).on('line', (text) => {
      try {
        const line = JSON.parse(text) as DetectorLine
        restarts = 0
        onUpdate(toState(line))
      } catch {
        // ignore anything that is not a detector line
      }
    })
    createInterface({ input: proc.stderr! }).on('line', (text) => {
      // mediapipe logs a lot; keep only our own messages for the exit report
      if (!/^[WIE]\d{4} |absl|TensorFlow Lite|All log messages/.test(text)) lastError = text
    })

    proc.on('exit', (code) => {
      if (child === proc) child = null
      if (!running) return
      restarts += 1
      console.error(`[vision] detector exited (${code})${lastError ? `: ${lastError}` : ''}`)
      if (restarts > MAX_RESTARTS) {
        running = false
        onUpdate(visionOff(lastError || 'Webcam detector keeps crashing'))
        return
      }
      onUpdate(visionOff('Restarting webcam detector'))
      retry = setTimeout(launch, Math.min(8000, 1000 * 2 ** (restarts - 1)))
    })
  }

  launch()
}

export function stopVision(): void {
  running = false
  if (retry) clearTimeout(retry)
  retry = null
  // Closing stdin also stops the detector if SIGTERM is missed.
  child?.stdin?.end()
  child?.kill('SIGTERM')
  child = null
}
