// Clip compiler entry. Run with `npm run clips:host` (shares links on this laptop's network address) or
// `npm run worker:compile` (links use COMPILE_PUBLIC_URL / localhost). Both bundle this file, then run it.
// Flag: --host  use this laptop's network address in the links. Run only one compiler per database (docs/components/clip-compiler.md).
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startCompiler } from './compiler.ts'
import { lanAddress } from './network.ts'

const root = process.env['COMPILE_ROOT'] || join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const env = process.env
const flags = new Set(process.argv.slice(2))
const port = Number(env['COMPILE_PORT'] ?? 8787)
const lan = lanAddress()
const publicUrl = env['COMPILE_PUBLIC_URL'] || (flags.has('--host') ? `http://${lan ?? 'localhost'}:${port}` : `http://localhost:${port}`)
const database = env['SPACETIME_DB'] || 'calhacks-13-wyd'

const compiler = await startCompiler({
  uri: env['SPACETIME_URI'] || 'wss://maincloud.spacetimedb.com',
  database,
  token: env['WYD_WORKER_TOKEN'] || undefined,
  tokenFile: env['COMPILE_TOKEN_FILE'] || join(root, 'worker', '.state', 'compile-token'),
  outDir: env['COMPILE_OUT_DIR'] || join(root, 'worker', 'out', 'compilations'),
  port,
  publicUrl,
  quietMs: Number(env['COMPILE_QUIET_SECS'] ?? 30) * 1000,
  retryMs: 60_000,
  pollMs: 2000,
  ffmpegBin: env['FFMPEG_BIN'] || 'ffmpeg',
  log: m => console.log(`[compile ${new Date().toTimeString().slice(0, 8)}] ${m}`)
}).catch(err => {
  console.error(`[compile] could not start: ${err instanceof Error ? err.message : err}`)
  process.exit(1)
})

if (flags.has('--host')) {
  console.log(`[compile] session pages: ${publicUrl}/session/<session id>  (teammates must be on the same network)`)
  if (!lan && !env['COMPILE_PUBLIC_URL']) console.log('[compile] no network address found; links only work on this laptop')
}
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { void compiler.stop().then(() => process.exit(0)) })
