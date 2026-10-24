import { useCallback, useEffect, useRef, useState } from 'react'

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

export interface CircleRoom {
  name: string
  sessionCode: string
  signalUrl: string
}

export interface CirclePeer {
  peerId: string
  name: string
}

export interface RemoteTile {
  peerId: string
  name: string
  stream: MediaStream | null
  connection: RTCPeerConnectionState
}

interface SignalData {
  description?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
}

interface ServerMessage {
  type: string
  peers?: CirclePeer[]
  peer?: CirclePeer
  peerId?: string
  from?: string
  name?: string
  endsAt?: number
  data?: SignalData
  message?: string
  call?: { from: string; name: string; endsAt: number } | null
}

interface PeerLink {
  peerId: string
  name: string
  pc: RTCPeerConnection
  pendingCandidates: RTCIceCandidateInit[]
}

export interface CircleCall {
  status: 'idle' | 'connecting' | 'connected' | 'error'
  error: string
  callError: string
  peers: CirclePeer[]
  callActive: boolean
  callEndsAt: number | null
  inCall: boolean
  joining: boolean
  localStream: MediaStream | null
  remotes: RemoteTile[]
  muted: boolean
  cameraOn: boolean
  startCall: () => void
  joinCall: () => void
  leaveCall: () => void
  dismissCallError: () => void
  toggleMute: () => void
  toggleCamera: () => void
}

function playJoinChime(): void {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return
  const ctx = new Ctx()
  void ctx.resume().catch(() => undefined)
  ;[523.25, 659.25].forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    const start = ctx.currentTime + i * 0.12
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.04, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(start)
    osc.stop(start + 0.34)
  })
  window.setTimeout(() => void ctx.close().catch(() => undefined), 1200)
}

function localDescription(pc: RTCPeerConnection): RTCSessionDescriptionInit | null {
  const description = pc.localDescription
  if (!description) return null
  return { type: description.type, sdp: description.sdp }
}

function normalizeSignalUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return 'ws://localhost:8787'
  if (/^wss?:\/\//i.test(trimmed)) return trimmed
  return `ws://${trimmed}`
}

export function useCircleCall(room: CircleRoom | null): CircleCall {
  const selfId = useRef(crypto.randomUUID())
  const wsRef = useRef<WebSocket | null>(null)
  const peersRef = useRef<CirclePeer[]>([])
  const pcs = useRef<Map<string, PeerLink>>(new Map())
  const queued = useRef<Map<string, SignalData[]>>(new Map())
  const localStreamRef = useRef<MediaStream | null>(null)
  const inCallRef = useRef(false)
  const callEndsAtRef = useRef<number | null>(null)
  const declinedEndsAt = useRef<number | null>(null)
  const startingRef = useRef<Promise<void> | null>(null)
  const chimedFor = useRef<number | null>(null)
  const haltRef = useRef(false)
  const handlers = useRef({
    onServer: (_msg: ServerMessage) => undefined as void,
    stopMedia: () => undefined as void,
    onSocketDown: () => undefined as void,
  })

  const [status, setStatus] = useState<CircleCall['status']>('idle')
  const [error, setError] = useState('')
  const [callError, setCallError] = useState('')
  const [peers, setPeers] = useState<CirclePeer[]>([])
  const [callActive, setCallActive] = useState(false)
  const [callEndsAt, setCallEndsAt] = useState<number | null>(null)
  const [inCall, setInCall] = useState(false)
  const [joining, setJoining] = useState(false)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remotes, setRemotes] = useState<RemoteTile[]>([])
  const [muted, setMuted] = useState(false)
  const [cameraOn, setCameraOn] = useState(true)

  const send = useCallback((payload: unknown) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload))
  }, [])

  const setCallWindow = useCallback((endsAt: number | null) => {
    if (endsAt && endsAt > Date.now()) {
      callEndsAtRef.current = endsAt
      setCallEndsAt(endsAt)
      setCallActive(true)
      return
    }
    callEndsAtRef.current = null
    setCallEndsAt(null)
    setCallActive(false)
  }, [])

  const upsertRemote = useCallback((peerId: string, patch: Partial<RemoteTile> & { name?: string }) => {
    setRemotes((prev) => {
      const current = prev.find((tile) => tile.peerId === peerId)
      if (!current) {
        return [...prev, {
          peerId,
          name: patch.name ?? 'Friend',
          stream: patch.stream ?? null,
          connection: patch.connection ?? 'new',
        }]
      }
      return prev.map((tile) => (tile.peerId === peerId ? { ...tile, ...patch } : tile))
    })
  }, [])

  const applySignal = useCallback(async (link: PeerLink, data: SignalData) => {
    const pc = link.pc
    try {
      if (data.description) {
        await pc.setRemoteDescription(data.description)
        const pending = link.pendingCandidates.splice(0)
        for (const candidate of pending) {
          await pc.addIceCandidate(candidate).catch(() => undefined)
        }
        if (data.description.type === 'offer') {
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          const description = localDescription(pc)
          if (description) send({ type: 'signal', to: link.peerId, data: { description } })
        }
        return
      }
      if (data.candidate) {
        if (!pc.remoteDescription) {
          link.pendingCandidates.push(data.candidate)
          return
        }
        await pc.addIceCandidate(data.candidate)
      }
    } catch (err) {
      console.error('WebRTC signal failed', err)
    }
  }, [send])

  const ensurePeer = useCallback((peerId: string, name: string): PeerLink | null => {
    const stream = localStreamRef.current
    if (!stream) return null
    const existing = pcs.current.get(peerId)
    if (existing) {
      existing.name = name
      upsertRemote(peerId, { name })
      return existing
    }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    const link: PeerLink = { peerId, name, pc, pendingCandidates: [] }
    pcs.current.set(peerId, link)
    upsertRemote(peerId, { name, stream: null, connection: pc.connectionState })

    const offerer = selfId.current < peerId
    pc.onnegotiationneeded = async () => {
      if (!offerer) return
      try {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        const description = localDescription(pc)
        if (!description) return
        send({ type: 'signal', to: peerId, data: { description } })
      } catch (err) {
        console.error('Failed to create offer', err)
      }
    }

    pc.onicecandidate = (event) => {
      if (!event.candidate) return
      send({
        type: 'signal',
        to: peerId,
        data: { candidate: event.candidate.toJSON() },
      })
    }

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0]
      if (!remoteStream) return
      upsertRemote(peerId, { name: link.name, stream: remoteStream, connection: pc.connectionState })
    }

    pc.onconnectionstatechange = () => {
      upsertRemote(peerId, { connection: pc.connectionState })
    }

    for (const track of stream.getTracks()) pc.addTrack(track, stream)
    return link
  }, [send, upsertRemote])

  const connectToPeer = useCallback((peer: CirclePeer) => {
    const link = ensurePeer(peer.peerId, peer.name)
    if (!link) return
    const waiting = queued.current.get(peer.peerId)
    if (!waiting?.length) return
    queued.current.delete(peer.peerId)
    for (const data of waiting) void applySignal(link, data)
  }, [applySignal, ensurePeer])

  const handleSignal = useCallback((from: string, data: SignalData) => {
    if (!localStreamRef.current) {
      const list = queued.current.get(from) ?? []
      list.push(data)
      queued.current.set(from, list)
      return
    }
    const name = peersRef.current.find((peer) => peer.peerId === from)?.name ?? 'Friend'
    const link = ensurePeer(from, name)
    if (!link) return
    void applySignal(link, data)
  }, [applySignal, ensurePeer])

  const leaveMedia = useCallback((notify: boolean) => {
    inCallRef.current = false
    setInCall(false)
    setJoining(false)
    for (const link of pcs.current.values()) link.pc.close()
    pcs.current.clear()
    queued.current.clear()
    setRemotes([])
    const stream = localStreamRef.current
    localStreamRef.current = null
    stream?.getTracks().forEach((track) => track.stop())
    setLocalStream(null)
    setMuted(false)
    setCameraOn(true)
    if (notify) send({ type: 'call-leave' })
  }, [send])

  const beginMedia = useCallback(async () => {
    if (localStreamRef.current) {
      for (const peer of peersRef.current) connectToPeer(peer)
      inCallRef.current = true
      setInCall(true)
      setJoining(false)
      setCallError('')
      return
    }
    if (startingRef.current) {
      await startingRef.current
      return
    }

    const task = (async () => {
      setJoining(true)
      setCallError('')
      void window.circleAPI?.setCallMode(true)
      const endsAt = callEndsAtRef.current
      if (endsAt && chimedFor.current !== endsAt) {
        chimedFor.current = endsAt
        playJoinChime()
      }
      try {
        if (window.circleAPI) {
          const access = await window.circleAPI.requestMediaAccess()
          if (!access.camera && !access.microphone) {
            throw new Error('Camera and microphone are blocked. Allow them for Electron in System Settings, then try the call again.')
          }
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        })
        localStreamRef.current = stream
        setLocalStream(stream)
        inCallRef.current = true
        setInCall(true)
        for (const peer of peersRef.current) connectToPeer(peer)
      } catch (err) {
        inCallRef.current = false
        setInCall(false)
        const denied = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'NotFoundError')
        setCallError(denied
          ? 'Camera or microphone permission was denied.'
          : err instanceof Error ? err.message : 'Could not open the camera.')
      } finally {
        setJoining(false)
      }
    })()

    startingRef.current = task
    try {
      await task
    } finally {
      startingRef.current = null
    }
  }, [connectToPeer])

  const onServer = useCallback((msg: ServerMessage) => {
    if (msg.type === 'error') {
      haltRef.current = true
      setStatus('error')
      setError(msg.message || 'Could not join this session.')
      wsRef.current?.close()
      return
    }

    if (msg.type === 'joined') {
      setStatus('connected')
      setError('')
      peersRef.current = msg.peers ?? []
      setPeers(peersRef.current)
      const endsAt = msg.call?.endsAt ?? null
      setCallWindow(endsAt)
      if (endsAt && declinedEndsAt.current !== endsAt) void beginMedia()
      return
    }

    if (msg.type === 'peer-joined' && msg.peer) {
      peersRef.current = [...peersRef.current.filter((peer) => peer.peerId !== msg.peer!.peerId), msg.peer]
      setPeers([...peersRef.current])
      if (localStreamRef.current) connectToPeer(msg.peer)
      return
    }

    if (msg.type === 'peer-left' && msg.peerId) {
      peersRef.current = peersRef.current.filter((peer) => peer.peerId !== msg.peerId)
      setPeers([...peersRef.current])
      pcs.current.get(msg.peerId)?.pc.close()
      pcs.current.delete(msg.peerId)
      setRemotes((prev) => prev.filter((tile) => tile.peerId !== msg.peerId))
      return
    }

    if (msg.type === 'signal' && msg.from && msg.data) {
      handleSignal(msg.from, msg.data)
      return
    }

    if (msg.type === 'call-start' && msg.endsAt) {
      setCallWindow(msg.endsAt)
      if (declinedEndsAt.current === msg.endsAt) return
      void beginMedia()
      return
    }

    if (msg.type === 'call-leave' && msg.peerId) {
      pcs.current.get(msg.peerId)?.pc.close()
      pcs.current.delete(msg.peerId)
      setRemotes((prev) => prev.filter((tile) => tile.peerId !== msg.peerId))
      return
    }

    if (msg.type === 'call-end') {
      declinedEndsAt.current = null
      setCallWindow(null)
      leaveMedia(false)
    }
  }, [beginMedia, connectToPeer, handleSignal, leaveMedia, setCallWindow])

  handlers.current.onServer = onServer
  handlers.current.stopMedia = () => leaveMedia(false)
  handlers.current.onSocketDown = () => {
    for (const link of pcs.current.values()) link.pc.close()
    pcs.current.clear()
    queued.current.clear()
    setRemotes([])
  }

  useEffect(() => {
    if (!callEndsAt) return
    const timer = window.setTimeout(() => {
      declinedEndsAt.current = null
      setCallWindow(null)
      leaveMedia(false)
    }, Math.max(0, callEndsAt - Date.now() + 400))
    return () => window.clearTimeout(timer)
  }, [callEndsAt, leaveMedia, setCallWindow])

  useEffect(() => {
    if (!room) {
      setStatus('idle')
      setPeers([])
      peersRef.current = []
      return
    }

    const url = normalizeSignalUrl(room.signalUrl)
    let disposed = false
    let socket: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let attempts = 0
    haltRef.current = false

    const connect = () => {
      if (disposed || haltRef.current) return
      setStatus('connecting')
      const ws = new WebSocket(url)
      socket = ws
      wsRef.current = ws
      ws.onopen = () => {
        if (disposed) {
          ws.close()
          return
        }
        attempts = 0
        ws.send(JSON.stringify({
          type: 'join',
          sessionCode: room.sessionCode,
          peerId: selfId.current,
          name: room.name,
        }))
      }
      ws.onmessage = (event) => {
        try {
          handlers.current.onServer(JSON.parse(String(event.data)) as ServerMessage)
        } catch {
          // ignore malformed payloads
        }
      }
      ws.onerror = () => undefined
      ws.onclose = () => {
        const replaced = wsRef.current !== null && wsRef.current !== ws
        if (wsRef.current === ws) wsRef.current = null
        if (disposed || replaced) return
        if (!haltRef.current) handlers.current.onSocketDown()
        if (haltRef.current) return
        attempts += 1
        setStatus('connecting')
        setError(attempts > 1 ? `Reconnecting to ${url}…` : '')
        retry = setTimeout(connect, Math.min(4000, 800 * attempts))
      }
    }

    connect()
    return () => {
      disposed = true
      if (retry) clearTimeout(retry)
      handlers.current.stopMedia()
      socket?.close()
      window.circleAPI?.setCallMode(false)
    }
  }, [room?.name, room?.sessionCode, room?.signalUrl])

  const startCall = useCallback(() => {
    declinedEndsAt.current = null
    if (callEndsAtRef.current && callEndsAtRef.current > Date.now()) {
      void beginMedia()
      return
    }
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError('Still connecting to the circle. Try the call again in a moment.')
      return
    }
    send({ type: 'call-start' })
  }, [beginMedia, send])

  const joinCall = useCallback(() => {
    declinedEndsAt.current = null
    void beginMedia()
  }, [beginMedia])

  const leaveCall = useCallback(() => {
    declinedEndsAt.current = callEndsAtRef.current
    setCallError('')
    leaveMedia(true)
    void window.circleAPI?.setCallMode(false)
  }, [leaveMedia])

  const dismissCallError = useCallback(() => {
    declinedEndsAt.current = callEndsAtRef.current
    setCallError('')
    void window.circleAPI?.setCallMode(false)
  }, [])

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      const next = !current
      localStreamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = !next
      })
      return next
    })
  }, [])

  const toggleCamera = useCallback(() => {
    setCameraOn((current) => {
      const next = !current
      localStreamRef.current?.getVideoTracks().forEach((track) => {
        track.enabled = next
      })
      return next
    })
  }, [])

  return {
    status: room ? status : 'idle',
    error,
    callError,
    peers,
    callActive,
    callEndsAt,
    inCall,
    joining,
    localStream,
    remotes,
    muted,
    cameraOn,
    startCall,
    joinCall,
    leaveCall,
    dismissCallError,
    toggleMute,
    toggleCamera,
  }
}
