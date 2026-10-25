import { createReadStream, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { isVideoName } from './plan.ts'

export const VIDEO_PATH = '/compilations/'

/** Parse a single `Range: bytes=a-b` header; null = whole file, 'bad' = unsatisfiable. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | 'bad' {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '')) return null
  let start: number
  let end: number
  if (m[1] === '') {
    start = Math.max(0, size - Number(m[2]))
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  }
  return start > end || start >= size ? 'bad' : { start, end }
}

/**
 * Serves finished compilations from `dir` at GET /compilations/<session-ID-N.mp4> (with Range, so players can seek)
 * plus GET /health. Only names the compiler writes are served; nothing else in `dir` is reachable.
 */
export function createVideoServer(dir: string): Server {
  return createServer((req, res) => {
    const cors = { 'access-control-allow-origin': '*' }
    const url = new URL(req.url ?? '/', 'http://x')
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, cors).end(); return }
    if (url.pathname === '/health') { res.writeHead(200, { ...cors, 'content-type': 'text/plain' }).end('ok'); return }
    if (!url.pathname.startsWith(VIDEO_PATH)) { res.writeHead(404, cors).end(); return }
    const name = url.pathname.slice(VIDEO_PATH.length)
    if (!isVideoName(name)) { res.writeHead(404, cors).end(); return }
    let size: number
    try { size = statSync(join(dir, name)).size } catch { res.writeHead(404, cors).end(); return }
    const range = parseRange(req.headers.range, size)
    if (range === 'bad') { res.writeHead(416, { ...cors, 'content-range': `bytes */${size}` }).end(); return }
    const headers = { ...cors, 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'cache-control': 'no-cache' }
    const { start, end } = range ?? { start: 0, end: size - 1 }
    res.writeHead(range ? 206 : 200, {
      ...headers,
      'content-length': end - start + 1,
      ...(range ? { 'content-range': `bytes ${start}-${end}/${size}` } : {})
    })
    if (req.method === 'HEAD') { res.end(); return }
    createReadStream(join(dir, name), { start, end }).pipe(res)
  })
}
