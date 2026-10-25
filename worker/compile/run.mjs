// Bundles main.ts (it imports the generated TS bindings, which Node cannot run as-is) and runs it.
//   npm run worker:compile            (from the repo root)
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '.build', 'main.mjs')
await build({
  entryPoints: [join(here, 'main.ts')],
  outfile: out,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  banner: { js: "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);" },
  logLevel: 'error'
})
const child = spawn(process.execPath, ['--env-file-if-exists=' + join(here, '..', '..', '.env'), out, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, COMPILE_ROOT: join(here, '..', '..') }
})
child.on('exit', code => process.exit(code ?? 0))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))
