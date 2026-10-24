import { exec } from 'child_process'
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { promisify } from 'util'

const execAsync = promisify(exec)

const TMP = join(tmpdir(), 'lockin')
const BIN = join(TMP, 'transcribe')

let compiled = false

async function ensureTranscriber(): Promise<void> {
  if (compiled && existsSync(BIN)) return
  mkdirSync(TMP, { recursive: true })
  // Source is alongside this file in src/main/ during dev, or app resources in prod
  const candidates = [
    join(__dirname, 'transcribe.swift'),
    join(process.cwd(), 'src/main/transcribe.swift'),
  ]
  const src = candidates.find(p => existsSync(p))
  if (!src) throw new Error('transcribe.swift not found')

  const swiftSrc = join(TMP, 'transcribe.swift')
  writeFileSync(swiftSrc, readFileSync(src))
  await execAsync(`swiftc -swift-version 5 "${swiftSrc}" -o "${BIN}"`)
  compiled = true
}

export async function transcribeAudio(webmBuffer: Buffer): Promise<string> {
  await ensureTranscriber()
  mkdirSync(TMP, { recursive: true })

  const webmPath = join(TMP, 'recording.webm')
  const wavPath = join(TMP, 'recording.wav')

  writeFileSync(webmPath, webmBuffer)

  // Convert to 16kHz mono WAV — required by SFSpeechRecognizer
  await execAsync(`ffmpeg -y -i "${webmPath}" -ar 16000 -ac 1 "${wavPath}" 2>/dev/null`)

  const { stdout } = await execAsync(`"${BIN}" "${wavPath}"`)
  const result = stdout.trim()

  if (!result || result.startsWith('error:')) {
    throw new Error(result || 'empty transcript')
  }

  return result
}
