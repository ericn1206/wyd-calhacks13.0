import { randomUUID } from 'crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { StdbClient } from './db/stdb'
import type { ClipInfo } from './facetimeTrigger'

const CHUNK_BYTES = 240 * 1024 // module limit is 256 KiB per upload_clip_chunk
const RETRIES = 2

/** Local clips live here until uploaded (or the next app start). */
export function clipDir(): string {
  const dir = join(app.getPath('userData'), 'clips')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Path for the next clip the detector writes. */
export function newClipPath(): string {
  return join(clipDir(), `${randomUUID()}.mp4`)
}

/** Remove clips left by a crash or a failed upload; they never outlive the app run. */
export function clearClipDir(): void {
  try {
    for (const name of readdirSync(clipDir())) rmSync(join(clipDir(), name), { force: true })
  } catch { /* nothing to clear */ }
}

async function withRetry(label: string, fn: () => Promise<void>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { return await fn() } catch (err) {
      if (attempt >= RETRIES) throw new Error(`${label}: ${err instanceof Error ? err.message : String(err)}`)
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
    }
  }
}

/**
 * Send a finished clip to SpacetimeDB (`begin_session_clip` → `upload_clip_chunk` × n → `finish_session_clip`)
 * and delete the local file afterwards, whether or not the upload worked.
 */
export async function uploadClip(stdb: StdbClient, info: ClipInfo): Promise<void> {
  const path = info.clip
  if (!path) return
  const started = Date.now()
  try {
    const bytes = readFileSync(path)
    const chunkCount = Math.ceil(bytes.length / CHUNK_BYTES)
    const clipKey = randomUUID()
    console.log(`[clip] uploading ${path}: ${bytes.length} bytes, ${chunkCount} chunks, key ${clipKey}, ${info.width}x${info.height} ${info.durationMs} ms`)
    await withRetry('begin', () => stdb.call('beginSessionClip', {
      clipKey,
      momentAtMs: BigInt(info.t),
      startedAtMs: BigInt(info.startedAt),
      durationMs: info.durationMs,
      width: info.width,
      height: info.height,
      fps: info.fps,
      mime: 'video/mp4',
      sizeBytes: bytes.length,
      chunkCount
    }))
    for (let seq = 0; seq < chunkCount; seq++) {
      const data = new Uint8Array(bytes.subarray(seq * CHUNK_BYTES, (seq + 1) * CHUNK_BYTES))
      await withRetry(`chunk ${seq}`, () => stdb.call('uploadClipChunk', { clipKey, seq, data }))
    }
    await withRetry('finish', () => stdb.call('finishSessionClip', { clipKey }))
    console.log(`[clip] uploaded ${bytes.length} bytes in ${chunkCount} chunks, ${Date.now() - started} ms`)
  } catch (err) {
    console.error('[clip] upload failed:', err instanceof Error ? err.message : err)
  } finally {
    rmSync(path, { force: true })
  }
}
