import { type ChildProcess, spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

let child: ChildProcess | null = null

function projectRoot(): string {
  const candidates = [process.cwd(), app.getAppPath(), join(app.getAppPath(), '..'), join(__dirname, '..', '..')]
  for (const dir of candidates) {
    if (existsSync(join(dir, 'vision/facetime_trigger.py'))) return dir
  }
  return process.cwd()
}

/** Run vision/facetime_trigger.py. Its stdout line `face time` is the only trigger output. */
export function startFacetimeTrigger(goal: string): void {
  stopFacetimeTrigger()
  const root = projectRoot()
  const python = join(root, 'vision/.venv/bin/python')
  const script = join(root, 'vision/facetime_trigger.py')
  if (!existsSync(python)) {
    console.error('[facetime] no vision/.venv. Run npm run setup:vision')
    return
  }
  const proc = spawn(python, [script, goal], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  child = proc
  proc.stdout?.on('data', (buf: Buffer) => process.stdout.write(buf))
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
