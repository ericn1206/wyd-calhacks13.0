import { createServer, type Server } from 'http'
import { networkInterfaces } from 'os'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'

export const SIGNAL_PORT = 8787
const CALL_DURATION_MS = 90_000
const MAX_PEERS = 6

export interface SignalInfo {
  port: number
  urls: string[]
}

interface Peer {
  ws: WebSocket
  name: string
}

interface CallState {
  from: string
  name: string
  endsAt: number
}

interface Room {
  peers: Map<string, Peer>
  call: CallState | null
  endTimer: ReturnType<typeof setTimeout> | null
}

type ClientSocket = WebSocket & {
  isAlive?: boolean
  sessionCode?: string
  peerId?: string
}

const rooms = new Map<string, Room>()

let httpServer: Server | null = null
let sockets: WebSocketServer | null = null
let pulse: ReturnType<typeof setInterval> | null = null
let owned = false

export function listSignalUrls(port = SIGNAL_PORT): string[] {
  const urls = [`ws://localhost:${port}`]
  let nets: ReturnType<typeof networkInterfaces> = {}
  try {
    nets = networkInterfaces()
  } catch {
    return urls
  }
  for (const list of Object.values(nets)) {
    for (const net of list ?? []) {
      const family = String(net.family)
      if ((family === 'IPv4' || family === '4') && !net.internal) {
        urls.push(`ws://${net.address}:${port}`)
      }
    }
  }
  return urls
}

function rawText(raw: RawData): string {
  if (typeof raw === 'string') return raw
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString()
  if (Array.isArray(raw)) return Buffer.concat(raw).toString()
  return raw.toString()
}

function cleanCode(value: unknown): string {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
}

function cleanName(value: unknown): string {
  return String(value ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24)
}

function send(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload))
}

function broadcast(room: Room, payload: unknown, except?: WebSocket): void {
  const data = JSON.stringify(payload)
  for (const peer of room.peers.values()) {
    if (peer.ws !== except && peer.ws.readyState === peer.ws.OPEN) peer.ws.send(data)
  }
}

function activeCall(room: Room): CallState | null {
  if (!room.call) return null
  if (room.call.endsAt <= Date.now()) return null
  return room.call
}

function clearCall(room: Room): void {
  if (room.endTimer) clearTimeout(room.endTimer)
  room.endTimer = null
  room.call = null
}

function scheduleCallEnd(code: string, room: Room): void {
  if (room.endTimer) clearTimeout(room.endTimer)
  const endsAt = room.call?.endsAt ?? Date.now()
  room.endTimer = setTimeout(() => {
    if (!rooms.get(code)) return
    clearCall(room)
    broadcast(room, { type: 'call-end' })
  }, Math.max(0, endsAt - Date.now()))
}

function removePeer(code: string, peerId: string, ws: WebSocket): void {
  const room = rooms.get(code)
  if (!room) return
  const peer = room.peers.get(peerId)
  if (!peer || peer.ws !== ws) return
  room.peers.delete(peerId)
  broadcast(room, { type: 'peer-left', peerId })
  if (room.peers.size === 0) {
    clearCall(room)
    rooms.delete(code)
  }
}

function handleJoin(ws: ClientSocket, msg: Record<string, unknown>): void {
  const sessionCode = cleanCode(msg.sessionCode)
  const peerId = String(msg.peerId ?? '').slice(0, 64)
  const name = cleanName(msg.name)
  if (sessionCode.length < 4 || !peerId || !name) {
    send(ws, { type: 'error', message: 'Enter your name and a session code of at least 4 characters.' })
    return
  }

  let room = rooms.get(sessionCode)
  if (!room) {
    room = { peers: new Map(), call: null, endTimer: null }
    rooms.set(sessionCode, room)
  }

  const existing = room.peers.get(peerId)
  if (!existing && room.peers.size >= MAX_PEERS) {
    send(ws, { type: 'error', message: 'This circle is full (6 people).' })
    return
  }

  room.peers.set(peerId, { ws, name })
  ws.sessionCode = sessionCode
  ws.peerId = peerId
  if (existing && existing.ws !== ws) existing.ws.close()

  const peers = [...room.peers.entries()]
    .filter(([id]) => id !== peerId)
    .map(([id, peer]) => ({ peerId: id, name: peer.name }))

  const call = activeCall(room)
  send(ws, {
    type: 'joined',
    peers,
    call: call ? { from: call.from, name: call.name, endsAt: call.endsAt } : null,
  })
  broadcast(room, { type: 'peer-joined', peer: { peerId, name } }, ws)
}

function handleMessage(ws: ClientSocket, msg: Record<string, unknown>): void {
  if (msg.type === 'join') {
    handleJoin(ws, msg)
    return
  }

  const code = ws.sessionCode
  const peerId = ws.peerId
  if (!code || !peerId) return
  const room = rooms.get(code)
  if (!room || !room.peers.has(peerId)) return
  const self = room.peers.get(peerId)
  if (!self) return

  if (msg.type === 'signal') {
    const target = room.peers.get(String(msg.to ?? ''))
    if (!target || typeof msg.data !== 'object' || msg.data === null) return
    send(target.ws, { type: 'signal', from: peerId, data: msg.data })
    return
  }

  if (msg.type === 'call-start') {
    const current = activeCall(room)
    if (current) {
      send(ws, { type: 'call-start', from: current.from, name: current.name, endsAt: current.endsAt })
      return
    }
    room.call = { from: peerId, name: self.name, endsAt: Date.now() + CALL_DURATION_MS }
    scheduleCallEnd(code, room)
    broadcast(room, { type: 'call-start', from: peerId, name: self.name, endsAt: room.call.endsAt })
    return
  }

  if (msg.type === 'call-leave') {
    broadcast(room, { type: 'call-leave', peerId }, ws)
  }
}

function attach(wss: WebSocketServer): void {
  wss.on('connection', (socket) => {
    const ws = socket as ClientSocket
    ws.isAlive = true
    ws.on('pong', () => {
      ws.isAlive = true
    })
    ws.on('message', (raw) => {
      const text = rawText(raw)
      if (text.length > 100_000) return
      let msg: Record<string, unknown> | null = null
      try {
        const parsed = JSON.parse(text) as unknown
        if (parsed && typeof parsed === 'object') msg = parsed as Record<string, unknown>
      } catch {
        return
      }
      if (!msg) return
      handleMessage(ws, msg)
    })
    ws.on('close', () => {
      if (ws.sessionCode && ws.peerId) removePeer(ws.sessionCode, ws.peerId, ws)
    })
  })
}

export function startSignalServer(port = SIGNAL_PORT): Promise<SignalInfo> {
  if (owned && httpServer) {
    return Promise.resolve({ port, urls: listSignalUrls(port) })
  }

  return new Promise((resolve, reject) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('ok')
    })
    const wss = new WebSocketServer({ server })
    attach(wss)

    let settled = false
    const onListenError = (err: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      wss.close()
      server.close()
      if (err.code === 'EADDRINUSE') {
        console.log(`[signal] port ${port} is already open — using that server`)
        resolve({ port, urls: listSignalUrls(port) })
        return
      }
      reject(err)
    }
    // `ws` re-emits the HTTP server's error. Without this listener that
    // second emit crashes Electron as an uncaught exception.
    server.on('error', onListenError)
    wss.on('error', onListenError)

    server.listen(port, '0.0.0.0', () => {
      if (settled) return
      settled = true
      owned = true
      httpServer = server
      sockets = wss
      pulse = setInterval(() => {
        for (const client of wss.clients) {
          const sock = client as ClientSocket
          if (sock.isAlive === false) {
            sock.terminate()
            continue
          }
          sock.isAlive = false
          sock.ping()
        }
      }, 15000)

      const info = { port, urls: listSignalUrls(port) }
      console.log('[signal] study-circle server ready')
      for (const url of info.urls) console.log(`  ${url}`)
      resolve(info)
    })
  })
}

export function stopSignalServer(): void {
  if (pulse) clearInterval(pulse)
  pulse = null
  sockets?.close()
  httpServer?.close()
  sockets = null
  httpServer = null
  owned = false
  for (const room of rooms.values()) clearCall(room)
  rooms.clear()
}

const entry = process.argv[1] ?? ''
if (entry.includes('signalServer')) {
  startSignalServer()
    .then((info) => {
      console.log(`[signal] listening on ${info.urls.join(', ')}`)
    })
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
