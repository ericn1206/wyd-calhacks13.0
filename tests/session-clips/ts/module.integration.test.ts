// Integration test of the session_clip reducers against a real SpacetimeDB database.
// Opt-in: skipped unless WYD_TEST_STDB_URI and WYD_TEST_STDB_DB point at a scratch db
// that has this module published (see ../README.md). Never point it at the shared maincloud db.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { StdbClient } from '../../../src/main/db/stdb'

const uri = process.env['WYD_TEST_STDB_URI']
const db = process.env['WYD_TEST_STDB_DB']
const skip = !uri || !db ? 'set WYD_TEST_STDB_URI and WYD_TEST_STDB_DB to run' : false

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const dirs: string[] = []
const none = undefined
const bytes = (n: number, fill = 1) => new Uint8Array(n).fill(fill)

/** A client with its own identity (own token file). */
async function client(): Promise<StdbClient> {
  const dir = mkdtempSync(join(tmpdir(), 'wyd-it-'))
  dirs.push(dir)
  process.env['WYD_TEST_USERDATA'] = dir
  process.env['SPACETIME_URI'] = uri
  process.env['SPACETIME_DB'] = db
  const c = new StdbClient()
  await c.connect()
  await sleep(1500)
  return c
}

async function inSession(c: StdbClient): Promise<void> {
  await c.call('createSession', {
    name: 'clip it',
    settings: { pomodoroWorkSecs: none, pomodoroBreakSecs: none, offTaskThresholdSecs: none, callCooldownSecs: none, maxCallSecs: none, scoreboardEnabled: none, groupCallEnabled: none, topicDescription: none, allowedDomains: none, blockedDomains: none },
    code: none
  })
  await sleep(300)
}

let n = 0
const begin = (key: string, over: Record<string, unknown> = {}) => ({
  clipKey: key,
  momentAtMs: 2000n,
  startedAtMs: 1000n,
  durationMs: 30_000,
  width: 320,
  height: 240,
  fps: 8,
  mime: 'video/mp4',
  sizeBytes: 300,
  chunkCount: 2,
  ...over
})
const key = () => `it-clip-${Date.now()}-${n++}`
const rejects = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, re)

describe('session_clip reducers', { skip }, () => {
  after(() => dirs.forEach(d => rmSync(d, { recursive: true, force: true })))

  it('rejects a caller who is in no session', async () => {
    const c = await client()
    await rejects(c.call('beginSessionClip', begin(key())), /not in a session/)
    c.disconnect()
  })

  it('accepts a complete upload: begin, chunks out of order, finish', async () => {
    const c = await client()
    await inSession(c)
    const k = key()
    await c.call('beginSessionClip', begin(k))
    await c.call('uploadClipChunk', { clipKey: k, seq: 1, data: bytes(100, 2) })
    await c.call('uploadClipChunk', { clipKey: k, seq: 0, data: bytes(200, 1) })
    await c.call('finishSessionClip', { clipKey: k })
    await c.call('finishSessionClip', { clipKey: k }) // idempotent
    c.disconnect()
  })

  it('refuses to finish with a missing chunk or a wrong total size', async () => {
    const c = await client()
    await inSession(c)
    const k = key()
    await c.call('beginSessionClip', begin(k))
    await c.call('uploadClipChunk', { clipKey: k, seq: 0, data: bytes(200) })
    await rejects(c.call('finishSessionClip', { clipKey: k }), /incomplete: 1\/2/)
    await c.call('uploadClipChunk', { clipKey: k, seq: 1, data: bytes(50) })
    await rejects(c.call('finishSessionClip', { clipKey: k }), /incomplete: 2\/2 chunks, 250\/300 bytes/)
    c.disconnect()
  })

  it('re-sending a chunk replaces it instead of counting twice', async () => {
    const c = await client()
    await inSession(c)
    const k = key()
    await c.call('beginSessionClip', begin(k))
    await c.call('uploadClipChunk', { clipKey: k, seq: 0, data: bytes(10) })
    await c.call('uploadClipChunk', { clipKey: k, seq: 0, data: bytes(200) })
    await c.call('uploadClipChunk', { clipKey: k, seq: 1, data: bytes(100) })
    await c.call('finishSessionClip', { clipKey: k })
    c.disconnect()
  })

  it('beginning the same key again restarts the upload', async () => {
    const c = await client()
    await inSession(c)
    const k = key()
    await c.call('beginSessionClip', begin(k))
    await c.call('uploadClipChunk', { clipKey: k, seq: 0, data: bytes(200) })
    await c.call('beginSessionClip', begin(k))
    await rejects(c.call('finishSessionClip', { clipKey: k }), /incomplete: 0\/2/)
    c.disconnect()
  })

  it('rejects bad chunks and a finished clip', async () => {
    const c = await client()
    await inSession(c)
    const k = key()
    await c.call('beginSessionClip', begin(k, { sizeBytes: 10, chunkCount: 1 }))
    await rejects(c.call('uploadClipChunk', { clipKey: k, seq: 1, data: bytes(10) }), /out of range/)
    await rejects(c.call('uploadClipChunk', { clipKey: k, seq: 0, data: bytes(0) }), /bad chunk size/)
    await rejects(c.call('uploadClipChunk', { clipKey: k, seq: 0, data: bytes(256 * 1024 + 1) }), /bad chunk size/)
    await c.call('uploadClipChunk', { clipKey: k, seq: 0, data: bytes(10) })
    await c.call('finishSessionClip', { clipKey: k })
    await rejects(c.call('uploadClipChunk', { clipKey: k, seq: 0, data: bytes(10) }), /already finished/)
    c.disconnect()
  })

  it('validates the clip description', async () => {
    const c = await client()
    await inSession(c)
    await rejects(c.call('beginSessionClip', begin('short')), /bad clip key/)
    await rejects(c.call('beginSessionClip', begin(key(), { mime: 'video/webm' })), /must be video\/mp4/)
    await rejects(c.call('beginSessionClip', begin(key(), { sizeBytes: 0 })), /too large/)
    await rejects(c.call('beginSessionClip', begin(key(), { sizeBytes: 64 * 1024 * 1024 + 1 })), /too large/)
    await rejects(c.call('beginSessionClip', begin(key(), { chunkCount: 0 })), /bad chunk count/)
    await rejects(c.call('beginSessionClip', begin(key(), { chunkCount: 401 })), /bad chunk count/)
    await rejects(c.call('beginSessionClip', begin(key(), { durationMs: 0 })), /bad clip duration/)
    await rejects(c.call('beginSessionClip', begin(key(), { durationMs: 60_001 })), /bad clip duration/)
    c.disconnect()
  })

  it("another member cannot write to or finish someone else's clip", async () => {
    const a = await client()
    const b = await client()
    await inSession(a)
    await inSession(b)
    const k = key()
    await a.call('beginSessionClip', begin(k))
    await rejects(b.call('uploadClipChunk', { clipKey: k, seq: 0, data: bytes(200) }), /unknown clip/)
    await rejects(b.call('finishSessionClip', { clipKey: k }), /unknown clip/)
    await rejects(b.call('beginSessionClip', begin(k)), /clip key taken/)
    a.disconnect()
    b.disconnect()
  })

  it('caps clips per member at 20', async () => {
    const c = await client()
    await inSession(c)
    for (let i = 0; i < 20; i++) await c.call('beginSessionClip', begin(key()))
    await rejects(c.call('beginSessionClip', begin(key())), /clip limit reached/)
    c.disconnect()
  })

  it('still accepts the upload after the member has left the session (grace window)', async () => {
    const c = await client()
    await inSession(c)
    const k = key()
    await c.call('leaveSession', {})
    await sleep(200)
    await c.call('beginSessionClip', begin(k, { sizeBytes: 10, chunkCount: 1 }))
    await c.call('uploadClipChunk', { clipKey: k, seq: 0, data: bytes(10) })
    await c.call('finishSessionClip', { clipKey: k })
    c.disconnect()
  })
})
