import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/** Load `.env` into `process.env` without overriding variables already set. */
export function loadEnv(): void {
  const path = [join(process.cwd(), '.env'), join(__dirname, '../../.env')].find(p => existsSync(p))
  if (!path) return

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}
