import { app } from 'electron'
import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'

/** On in dev, off when packaged; force with WYD_DEBUG=1 / 0. Read lazily: `.env` loads after imports. */
const enabled = () => (process.env['WYD_DEBUG'] ? process.env['WYD_DEBUG'] !== '0' : !app.isPackaged)

let file: string | null = null
const logFile = (): string | null => {
  if (file) return file
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    file = join(dir, 'stdb.log')
  } catch { /* terminal output only */ }
  return file
}

export const logPath = (): string | null => logFile()

const show = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x === undefined ? '∅' : x))

/** `[stdb 12:00:00.123] tag message {data}` → terminal and `userData/logs/stdb.log`. */
export function dbLog(tag: string, message: string, data?: unknown): void {
  if (!enabled()) return
  const t = new Date()
  const stamp = `${t.toTimeString().slice(0, 8)}.${String(t.getMilliseconds()).padStart(3, '0')}`
  const line = `[stdb ${stamp}] ${tag.padEnd(7)} ${message}${data === undefined ? '' : ' ' + show(data)}`
  console.log(line)
  const path = logFile()
  if (path) { try { appendFileSync(path, line + '\n') } catch { /* ignore */ } }
}
