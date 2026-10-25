import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { clearClipDir, clipDir, newClipPath, uploadClip } from '../../../src/main/clipUpload'
import type { StdbClient } from '../../../src/main/db/stdb'
import type { ClipInfo } from '../../../src/main/facetimeTrigger'

const CHUNK = 240 * 1024
type Call = { name: string; args: Record<string, unknown> }

/** Fake StdbClient: records reducer calls; `fail(call, n)` returns an error to throw on the n-th try of that call. */
function fakeStdb(fail?: (call: Call, attempt: number) => Error | undefined) {
  const calls: Call[] = []
  const tries = new Map<string, number>()
  const stdb = {
    async call(name: string, args: Record<string, unknown> = {}) {
      const call = { name, args }
      const key = `${name}:${args['seq'] ?? ''}`
      const attempt = (tries.get(key) ?? 0) + 1
      tries.set(key, attempt)
      calls.push(call)
      const err = fail?.(call, attempt)
      if (err) throw err
    }
  }
  return { stdb: stdb as unknown as StdbClient, calls }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wyd-clip-test-'))
  process.env['WYD_TEST_USERDATA'] = dir
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function makeClip(bytes: number): { info: ClipInfo; data: Buffer } {
  const data = Buffer.alloc(bytes)
  for (let i = 0; i < bytes; i++) data[i] = (i * 31 + 7) & 0xff
  const clip = newClipPath()
  writeFileSync(clip, data)
  return { info: { clip, t: 1_700_000_030_000, startedAt: 1_700_000_020_000, durationMs: 30_000, width: 1280, height: 720, fps: 10 }, data }
}

describe('uploadClip', () => {
  it('sends begin, every chunk in order, then finish', async () => {
    const { info } = makeClip(CHUNK * 2 + 100)
    const { stdb, calls } = fakeStdb()
    await uploadClip(stdb, info)
    assert.deepEqual(calls.map(c => c.name), ['beginSessionClip', 'uploadClipChunk', 'uploadClipChunk', 'uploadClipChunk', 'finishSessionClip'])
    assert.deepEqual(calls.filter(c => c.name === 'uploadClipChunk').map(c => c.args['seq']), [0, 1, 2])
  })

  it('marks a teammate\'s webcam clip with the join- key prefix, an own clip never has it', async () => {
    const { stdb: a, calls: joined } = fakeStdb()
    await uploadClip(a, makeClip(100).info, { joiner: true })
    const { stdb: b, calls: own } = fakeStdb()
    await uploadClip(b, makeClip(100).info)
    assert.match(String(joined[0].args['clipKey']), /^join-.{8,}$/)
    assert.ok(String(joined[0].args['clipKey']).length <= 64)
    assert.ok(!String(own[0].args['clipKey']).startsWith('join-'))
  })

  it('describes the clip in begin: ids, timing, format, size, chunk count', async () => {
    const { info, data } = makeClip(CHUNK + 1)
    const { stdb, calls } = fakeStdb()
    await uploadClip(stdb, info)
    const begin = calls[0].args
    assert.equal(typeof begin['clipKey'], 'string')
    assert.equal(begin['momentAtMs'], BigInt(info.t))
    assert.equal(begin['startedAtMs'], BigInt(info.startedAt))
    assert.equal(begin['durationMs'], 30_000)
    assert.equal(begin['width'], 1280)
    assert.equal(begin['height'], 720)
    assert.equal(begin['fps'], 10)
    assert.equal(begin['mime'], 'video/mp4')
    assert.equal(begin['sizeBytes'], data.length)
    assert.equal(begin['chunkCount'], 2)
  })

  it('uses one clipKey for every call', async () => {
    const { info } = makeClip(CHUNK * 3)
    const { stdb, calls } = fakeStdb()
    await uploadClip(stdb, info)
    assert.equal(new Set(calls.map(c => c.args['clipKey'])).size, 1)
  })

  it('chunks reassemble to the original bytes and stay under the module limit', async () => {
    const { info, data } = makeClip(CHUNK * 4 + 12_345)
    const { stdb, calls } = fakeStdb()
    await uploadClip(stdb, info)
    const chunks = calls.filter(c => c.name === 'uploadClipChunk').map(c => c.args['data'] as Uint8Array)
    for (const c of chunks) assert.ok(c.length > 0 && c.length <= 256 * 1024)
    assert.ok(Buffer.concat(chunks).equals(data))
  })

  it('an exact multiple of the chunk size makes no empty trailing chunk', async () => {
    const { info } = makeClip(CHUNK * 2)
    const { stdb, calls } = fakeStdb()
    await uploadClip(stdb, info)
    assert.equal(calls[0].args['chunkCount'], 2)
    assert.equal(calls.filter(c => c.name === 'uploadClipChunk').length, 2)
  })

  it('a clip smaller than one chunk is a single chunk', async () => {
    const { info } = makeClip(10)
    const { stdb, calls } = fakeStdb()
    await uploadClip(stdb, info)
    assert.equal(calls[0].args['chunkCount'], 1)
  })

  it('deletes the local file after a successful upload', async () => {
    const { info } = makeClip(1000)
    await uploadClip(fakeStdb().stdb, info)
    assert.equal(existsSync(info.clip!), false)
  })

  it('retries a chunk that fails once and still finishes', async () => {
    const { info } = makeClip(CHUNK * 2)
    const { stdb, calls } = fakeStdb((c, attempt) => (c.name === 'uploadClipChunk' && c.args['seq'] === 1 && attempt === 1 ? new Error('blip') : undefined))
    await uploadClip(stdb, info)
    assert.equal(calls.filter(c => c.name === 'uploadClipChunk' && c.args['seq'] === 1).length, 2)
    assert.equal(calls.at(-1)?.name, 'finishSessionClip')
  })

  it('gives up after repeated failures: no finish, no throw, file still deleted', async () => {
    const { info } = makeClip(CHUNK * 2)
    const { stdb, calls } = fakeStdb(c => (c.name === 'uploadClipChunk' && c.args['seq'] === 0 ? new Error('server says no') : undefined))
    await uploadClip(stdb, info)
    assert.equal(calls.some(c => c.name === 'finishSessionClip'), false)
    assert.equal(calls.filter(c => c.name === 'uploadClipChunk').length, 3)
    assert.equal(existsSync(info.clip!), false)
  })

  it('a rejected begin (e.g. not in a session) uploads nothing and deletes the file', async () => {
    const { info } = makeClip(1000)
    const { stdb, calls } = fakeStdb(c => (c.name === 'beginSessionClip' ? new Error('you are not in a session') : undefined))
    await uploadClip(stdb, info)
    assert.deepEqual([...new Set(calls.map(c => c.name))], ['beginSessionClip'])
    assert.equal(existsSync(info.clip!), false)
  })

  it('a missing file is handled without calling the database', async () => {
    const { stdb, calls } = fakeStdb()
    await uploadClip(stdb, { clip: join(dir, 'gone.mp4'), t: 1, startedAt: 0, durationMs: 1, width: 1, height: 1, fps: 1 })
    assert.equal(calls.length, 0)
  })

  it('does nothing when the detector reported no clip', async () => {
    const { stdb, calls } = fakeStdb()
    await uploadClip(stdb, { clip: null, error: 'busy', t: 0, startedAt: 0, durationMs: 0, width: 0, height: 0, fps: 0 })
    assert.equal(calls.length, 0)
  })
})

describe('clip files', () => {
  it('newClipPath is a unique .mp4 inside userData/clips', () => {
    const a = newClipPath()
    const b = newClipPath()
    assert.notEqual(a, b)
    assert.ok(a.startsWith(clipDir()) && a.endsWith('.mp4'))
    assert.equal(clipDir(), join(dir, 'clips'))
  })

  it('clearClipDir removes leftovers from earlier runs', () => {
    writeFileSync(join(clipDir(), 'a.mp4'), 'x')
    writeFileSync(join(clipDir(), 'b.mp4'), 'y')
    clearClipDir()
    assert.deepEqual(readdirSync(clipDir()), [])
  })
})
