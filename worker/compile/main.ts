// Clip compiler entry. Run with `npm run worker:compile` (bundles this file, then runs it); env in docs/components/clip-compiler.md.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startCompiler } from './compiler.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const env = process.env
const port = Number(env['COMPILE_PORT'] ?? 8787)

const compiler = await startCompiler({
  uri: env['SPACETIME_URI'] || 'wss://maincloud.spacetimedb.com',
  database: env['SPACETIME_DB'] || 'calhacks-13-wyd',
  token: env['WYD_WORKER_TOKEN'] || undefined,
  tokenFile: env['COMPILE_TOKEN_FILE'] || join(root, 'worker', '.state', 'compile-token'),
  outDir: env['COMPILE_OUT_DIR'] || join(root, 'worker', 'out', 'compilations'),
  port,
  publicUrl: env['COMPILE_PUBLIC_URL'] || `http://localhost:${port}`,
  quietMs: Number(env['COMPILE_QUIET_SECS'] ?? 30) * 1000,
  retryMs: 60_000,
  pollMs: 2000,
  ffmpegBin: env['FFMPEG_BIN'] || 'ffmpeg',
  log: m => console.log(`[compile ${new Date().toTimeString().slice(0, 8)}] ${m}`)
}).catch(err => {
  console.error('[compile] could not start:', err instanceof Error ? err.message : err)
  process.exit(1)
})

console.log(`[compile] if renders fail with "only the AI worker may call this", authorize this identity once:`)
console.log(`  spacetime call ${env['SPACETIME_DB'] || 'calhacks-13-wyd'} authorize_worker '"0x${compiler.identity}"'`)
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { void compiler.stop().then(() => process.exit(0)) })
