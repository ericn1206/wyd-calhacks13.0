import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { createVideoServer, parseRange } from '../../../worker/compile/serve'

describe('parseRange', () => {
  it('returns null when there is no (usable) Range header', () => {
    assert.equal(parseRange(undefined, 100), null)
    assert.equal(parseRange('bytes=-', 100), null)
    assert.equal(parseRange('items=0-5', 100), null)
  })

  it('parses start-end, open-ended and suffix ranges', () => {
    assert.deepEqual(parseRange('bytes=0-9', 100), { start: 0, end: 9 })
    assert.deepEqual(parseRange('bytes=90-', 100), { start: 90, end: 99 })
    assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 })
  })

  it('clamps the end to the file and rejects unsatisfiable ranges', () => {
    assert.deepEqual(parseRange('bytes=50-500', 100), { start: 50, end: 99 })
    assert.equal(parseRange('bytes=100-', 100), 'bad')
    assert.equal(parseRange('bytes=20-10', 100), 'bad')
  })
})

describe('video server', () => {
  let dir: string
  let base: string
  let server: ReturnType<typeof createVideoServer>
  const body = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251))

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'wyd-serve-'))
    writeFileSync(join(dir, 'session-1-2.mp4'), body)
    writeFileSync(join(dir, 'secret.txt'), 'nope')
    server = createVideoServer(dir)
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  after(async () => {
    await new Promise<void>(r => server.close(() => r()))
    rmSync(dir, { recursive: true, force: true })
  })

  const get = (path: string, init?: RequestInit) => fetch(base + path, init)

  it('serves a compilation as video/mp4 with CORS and range support advertised', async () => {
    const res = await get('/compilations/session-1-2.mp4')
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'video/mp4')
    assert.equal(res.headers.get('accept-ranges'), 'bytes')
    assert.equal(res.headers.get('access-control-allow-origin'), '*')
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(body))
  })

  it('answers a Range request with 206 and just those bytes', async () => {
    const res = await get('/compilations/session-1-2.mp4', { headers: { range: 'bytes=10-19' } })
    assert.equal(res.status, 206)
    assert.equal(res.headers.get('content-range'), 'bytes 10-19/1000')
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(body.subarray(10, 20)))
  })

  it('answers a suffix range', async () => {
    const res = await get('/compilations/session-1-2.mp4', { headers: { range: 'bytes=-5' } })
    assert.equal(res.status, 206)
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(body.subarray(995)))
  })

  it('answers 416 for a range past the end', async () => {
    const res = await get('/compilations/session-1-2.mp4', { headers: { range: 'bytes=5000-' } })
    assert.equal(res.status, 416)
    await res.arrayBuffer()
  })

  it('HEAD returns the headers without a body', async () => {
    const res = await get('/compilations/session-1-2.mp4', { method: 'HEAD' })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-length'), '1000')
    assert.equal((await res.arrayBuffer()).byteLength, 0)
  })

  it('404s for unknown videos, other files, and path tricks', async () => {
    for (const path of ['/compilations/session-9-9.mp4', '/compilations/secret.txt', '/compilations/..%2Fsecret.txt', '/compilations/../secret.txt', '/secret.txt', '/']) {
      const res = await get(path)
      assert.equal(res.status, 404, path)
      await res.arrayBuffer()
    }
  })

  it('rejects methods other than GET/HEAD and has a health check', async () => {
    const post = await get('/compilations/session-1-2.mp4', { method: 'POST' })
    assert.equal(post.status, 405)
    await post.arrayBuffer()
    const health = await get('/health')
    assert.equal(health.status, 200)
    assert.equal(await health.text(), 'ok')
  })
})
