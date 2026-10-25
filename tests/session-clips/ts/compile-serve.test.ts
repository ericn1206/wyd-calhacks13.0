import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import type { CompileState } from '../../../worker/compile/page'
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

describe('session page', () => {
  let server: ReturnType<typeof createVideoServer>
  let base: string
  const states = new Map<bigint, CompileState>()

  before(async () => {
    server = createVideoServer(tmpdir(), id => states.get(id) ?? { state: 'waiting' })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  after(() => new Promise<void>(r => server.close(() => r())))

  const status = async (id: number) => (await fetch(`${base}/session/${id}/status`)).json()

  it('serves a self-updating HTML page for a session id', async () => {
    const res = await fetch(`${base}/session/45`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /^text\/html/)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    const html = await res.text()
    assert.match(html, /<video/)
    assert.match(html, /\/session\/' \+ id \+ '\/status/)
    assert.match(html, /var id = "45"/)
  })

  it('reports waiting for a session the worker knows nothing about', async () => {
    assert.deepEqual(await status(999), { state: 'waiting' })
  })

  it('reports rendering, then ready with the video path, then failed with the error', async () => {
    states.set(7n, { state: 'rendering' })
    assert.deepEqual(await status(7), { state: 'rendering' })
    states.set(7n, { state: 'ready', clipCount: 3 })
    assert.deepEqual(await status(7), { state: 'ready', clipCount: 3, video: '/compilations/session-7-3.mp4' })
    states.set(7n, { state: 'failed', error: 'ffmpeg exit 1' })
    assert.deepEqual(await status(7), { state: 'failed', error: 'ffmpeg exit 1' })
  })

  it('reports an ended session without clips as empty and a lost database connection as offline', async () => {
    states.set(8n, { state: 'empty' })
    assert.deepEqual(await status(8), { state: 'empty' })
    states.set(8n, { state: 'offline' })
    assert.deepEqual(await status(8), { state: 'offline' })
  })

  it('the page has a message for every state, including empty and offline', async () => {
    const html = await (await fetch(`${base}/session/1`)).text()
    for (const text of ['Waiting for the session to end', 'Putting your clips together', 'Reconnecting to the session database', 'ended without a saved moment', 'Could not build the video']) {
      assert.ok(html.includes(text), text)
    }
  })

  it('status is never cached, so the page sees changes', async () => {
    assert.equal((await fetch(`${base}/session/1/status`)).headers.get('cache-control'), 'no-store')
  })

  it('only accepts numeric session ids', async () => {
    for (const path of ['/session/abc', '/session/1;alert(1)', '/session/', '/session/1/other', '/session/12345678901234567890123', '/session/-1']) {
      const res = await fetch(base + path)
      assert.equal(res.status, 404, path)
      await res.arrayBuffer()
    }
  })

  it('page and status support HEAD', async () => {
    assert.equal((await fetch(`${base}/session/1`, { method: 'HEAD' })).status, 200)
    assert.equal((await fetch(`${base}/session/1/status`, { method: 'HEAD' })).status, 200)
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
