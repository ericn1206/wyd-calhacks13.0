// Runs the session-clips tests. No extra dependencies: esbuild comes with vite, the rest is Node + Python stdlib.
//   node tests/session-clips/run.mjs          all
//   node tests/session-clips/run.mjs ts       TypeScript only (src/main uploader; integration tests if WYD_TEST_STDB_* set)
//   node tests/session-clips/run.mjs py       Python only (vision/detector.py, vision/facetime_trigger.py)
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const which = process.argv[2] ?? 'all'
let failed = false

function runTs() {
  const out = join(here, '.build')
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  const tests = readdirSync(join(here, 'ts')).filter(f => f.endsWith('.test.ts')).map(f => join(here, 'ts', f))
  return build({
    entryPoints: tests,
    outdir: out,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outExtension: { '.js': '.mjs' },
    alias: { electron: join(here, 'ts', 'electron-stub.ts') },
    banner: { js: "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);" },
    logLevel: 'error'
  }).then(() => {
    const files = readdirSync(out).filter(f => f.endsWith('.mjs')).map(f => join(out, f))
    // A test that waits on a dead server must fail, not hang: 90 s per test, 4 min for the whole run.
    const res = spawnSync(process.execPath, ['--test', '--test-timeout=90000', ...files], { stdio: 'inherit', timeout: 4 * 60 * 1000 })
    rmSync(out, { recursive: true, force: true })
    if (res.status !== 0) failed = true
  })
}

function runPy() {
  const venv = join(root, 'vision', '.venv', 'bin', 'python')
  const python = process.env.WYD_TEST_PYTHON ?? (existsSync(venv) ? venv : 'python3')
  const probe = spawnSync(python, ['-I', '-c', 'import cv2, numpy'], { stdio: 'ignore' })
  if (probe.status !== 0) {
    console.error(`python tests skipped: ${python} has no cv2/numpy (npm run setup:vision, or set WYD_TEST_PYTHON)`)
    return
  }
  const res = spawnSync(python, ['-m', 'unittest', 'discover', '-v', '-s', join(here, 'python'), '-p', 'test_*.py'], { stdio: 'inherit' })
  if (res.status !== 0) failed = true
}

if (which === 'ts' || which === 'all') await runTs()
if (which === 'py' || which === 'all') runPy()
process.exit(failed ? 1 : 0)
