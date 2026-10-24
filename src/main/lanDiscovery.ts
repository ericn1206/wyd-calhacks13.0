import { createSocket, type Socket } from 'dgram'
import { randomUUID } from 'crypto'
import { networkInterfaces } from 'os'

const DISCOVERY_PORT = 8788
const SIGNAL_PORT = 8787
const FRESH_MS = 4000

export interface CircleHost {
  url: string
  name: string
}

interface Announcement {
  id: string
  since: number
  address: string
  port: number
  name: string
  seen: number
}

function usefulAddress(address: string): boolean {
  if (!address || address.startsWith('127.') || address === '0.0.0.0') return false
  if (address.startsWith('169.254.')) return false
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(address)
}

function broadcastAddresses(): string[] {
  const targets = new Set<string>(['255.255.255.255'])
  let nets: ReturnType<typeof networkInterfaces> = {}
  try {
    nets = networkInterfaces()
  } catch {
    return [...targets]
  }
  for (const list of Object.values(nets)) {
    for (const net of list ?? []) {
      if (String(net.family) !== 'IPv4' && String(net.family) !== '4') continue
      if (net.internal || !net.netmask || !usefulAddress(net.address)) continue
      const ip = net.address.split('.').map(Number)
      const mask = net.netmask.split('.').map(Number)
      if (ip.length !== 4 || mask.length !== 4) continue
      const broadcast = ip.map((part, i) => (part | (~(mask[i] ?? 0) & 255)) >>> 0)
      targets.add(broadcast.join('.'))
    }
  }
  return [...targets]
}

/** Pick the earlier computer on the Wi-Fi as the shared room. Null means this computer hosts it. */
export function pickHost(
  self: { id: string; since: number },
  heard: Announcement[],
  now: number
): CircleHost | null {
  const fresh = heard.filter((item) =>
    now - item.seen < FRESH_MS &&
    item.id !== self.id &&
    item.port === SIGNAL_PORT &&
    usefulAddress(item.address)
  )
  fresh.sort((a, b) => a.since - b.since || a.id.localeCompare(b.id))
  const best = fresh[0]
  if (!best) return null
  const earlier = best.since < self.since || (best.since === self.since && best.id < self.id)
  if (!earlier) return null
  return { url: `ws://${best.address}:${best.port}`, name: best.name }
}

export function startLanDiscovery(options: {
  code: string
  name: string
  onHost: (host: CircleHost | null) => void
}): () => void {
  const code = options.code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
  const name = options.name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24) || 'Friend'
  if (code.length < 4) return () => undefined

  const self = { id: randomUUID(), since: Date.now() }
  const heard: Announcement[] = []
  let chosen = ''
  let closed = false
  let socket: Socket | null = null
  let pulse: ReturnType<typeof setInterval> | null = null

  const publish = () => {
    const next = pickHost(self, heard, Date.now())
    const key = next?.url ?? ''
    if (key === chosen) return
    chosen = key
    console.log(next ? `[lan] joining ${next.name} at ${next.url}` : `[lan] hosting ${code} on this computer`)
    options.onHost(next)
  }

  const announce = () => {
    if (!socket) return
    const payload = Buffer.from(JSON.stringify({
      v: 1,
      code,
      port: SIGNAL_PORT,
      name,
      id: self.id,
      since: self.since,
    }))
    for (const target of broadcastAddresses()) {
      socket.send(payload, DISCOVERY_PORT, target, () => undefined)
    }
  }

  try {
    socket = createSocket({ type: 'udp4', reuseAddr: true })
  } catch (err) {
    console.error('[lan] could not open discovery', err)
    return () => undefined
  }

  socket.on('error', (err) => {
    console.error('[lan] discovery error', err)
  })

  socket.on('message', (msg, rinfo) => {
    if (closed) return
    let parsed: {
      v?: number
      code?: string
      port?: number
      name?: string
      id?: string
      since?: number
    }
    try {
      parsed = JSON.parse(msg.toString('utf8'))
    } catch {
      return
    }
    if (parsed.v !== 1 || parsed.code !== code || parsed.port !== SIGNAL_PORT) return
    if (typeof parsed.id !== 'string' || typeof parsed.since !== 'number') return
    const address = rinfo.address.replace(/^::ffff:/, '')
    const existing = heard.find((item) => item.id === parsed.id)
    const row: Announcement = {
      id: parsed.id,
      since: parsed.since,
      address,
      port: SIGNAL_PORT,
      name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim().slice(0, 24) : 'Friend',
      seen: Date.now(),
    }
    if (existing) Object.assign(existing, row)
    else heard.push(row)
    publish()
  })

  socket.bind(DISCOVERY_PORT, () => {
    if (closed || !socket) return
    console.log(`[lan] listening for ${code} on UDP ${DISCOVERY_PORT}`)
    try {
      socket.setBroadcast(true)
    } catch (err) {
      console.error('[lan] broadcast disabled', err)
    }
    announce()
    publish()
    pulse = setInterval(() => {
      announce()
      publish()
    }, 1000)
  })

  return () => {
    closed = true
    if (pulse) clearInterval(pulse)
    pulse = null
    try {
      socket?.close()
    } catch {
      // already closed
    }
    socket = null
  }
}
