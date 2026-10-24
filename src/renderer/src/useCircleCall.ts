import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ConnectionState,
  createLocalTracks,
  type LocalTrack,
  type Participant,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
} from 'livekit-client'

const CALL_DURATION_MS = 90_000
// Call state lives on participant attributes so late joiners see it too.
// Everyone in a call copies the end time, so it survives the starter leaving.
const CALL_ENDS_AT = 'callEndsAt'
const IN_CALL = 'inCall'
// Demo live view: `on:<ms>` / `off:<ms>`; the newest switch from anyone wins.
const LIVE_VIEW = 'liveView'
// Webcam detector status shown as a badge on tiles: focused / away / noface / off.
const FOCUS = 'focus'

const VIDEO_OPTIONS = { resolution: VideoPresets.h720.resolution, facingMode: 'user' as const }

export interface CircleRoom {
  name: string
  sessionCode: string
}

export interface CircleOptions {
  /** This laptop's detector status, published as the `focus` attribute. */
  focus?: string
  /** Only with LOCKIN_DEMO=1. Without it, live view switches from others are ignored. */
  allowLiveView?: boolean
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
  focus: string
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
  liveView: boolean
  setLiveView: (on: boolean) => void
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

function endsAtOf(participant: Participant): number {
  const value = Number(participant.attributes[CALL_ENDS_AT])
  return Number.isFinite(value) ? value : 0
}

interface LiveSwitch {
  on: boolean
  at: number
}

function liveSwitchOf(participant: Participant): LiveSwitch | null {
  const match = /^(on|off):(\d+)$/.exec(participant.attributes[LIVE_VIEW] ?? '')
  return match ? { on: match[1] === 'on', at: Number(match[2]) } : null
}

function trackOf(tracks: LocalTrack[], kind: Track.Kind): LocalTrack | undefined {
  return tracks.find((track) => track.kind === kind)
}

/** Electron prefixes errors thrown in ipcMain handlers; keep only the message. */
function ipcMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export function useCircleCall(room: CircleRoom | null, options: CircleOptions = {}): CircleCall {
  const { focus = 'off', allowLiveView = false } = options
  const selfId = useRef(crypto.randomUUID())
  const liveViewRef = useRef(false)
  // This laptop's last switch. Covers the gap before LiveKit echoes our attributes back.
  const ownLive = useRef<LiveSwitch | null>(null)
  const allowLiveRef = useRef(allowLiveView)
  allowLiveRef.current = allowLiveView
  const focusRef = useRef(focus)
  focusRef.current = focus
  // Every publish/unpublish runs in order, so a call and live view never both open the camera.
  const mediaQueue = useRef<Promise<void>>(Promise.resolve())
  const roomRef = useRef<Room | null>(null)
  const tracksRef = useRef<LocalTrack[]>([])
  const streams = useRef<Map<string, { key: string; stream: MediaStream | null }>>(new Map())
  const inCallRef = useRef(false)
  const callEndsAtRef = useRef<number | null>(null)
  // The end time this computer claimed. Covers the gap before LiveKit echoes our attributes back.
  const ownEndsAt = useRef<number | null>(null)
  const declinedEndsAt = useRef<number | null>(null)
  const startingRef = useRef<Promise<void> | null>(null)
  const chimedFor = useRef<number | null>(null)
  const handlers = useRef({
    refresh: () => undefined as void,
    stopMedia: () => undefined as void,
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
  const [liveView, setLiveViewState] = useState(false)

  const enqueue = useCallback((task: () => Promise<void>): Promise<void> => {
    const next = mediaQueue.current.then(task, task)
    mediaQueue.current = next.catch(() => undefined)
    return next
  }, [])

  const setAttributes = useCallback((attributes: Record<string, string>) => {
    const lk = roomRef.current
    if (!lk || lk.state !== ConnectionState.Connected) return
    void lk.localParticipant.setAttributes(attributes).catch((err) => {
      console.error('Could not update call attributes', err)
    })
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

  const activeEndsAt = useCallback((lk: Room): number | null => {
    let best = ownEndsAt.current ?? 0
    best = Math.max(best, endsAtOf(lk.localParticipant))
    for (const participant of lk.remoteParticipants.values()) best = Math.max(best, endsAtOf(participant))
    return best > Date.now() ? best : null
  }, [])

  const syncLocalStream = useCallback(() => {
    const tracks = tracksRef.current
    setLocalStream(tracks.length ? new MediaStream(tracks.map((track) => track.mediaStreamTrack)) : null)
  }, [])

  const dropTracks = useCallback((keep: (track: LocalTrack) => boolean) => {
    const lk = roomRef.current
    const dropped = tracksRef.current.filter((track) => !keep(track))
    tracksRef.current = tracksRef.current.filter(keep)
    for (const track of dropped) {
      if (lk) void lk.localParticipant.unpublishTrack(track).catch(() => undefined)
      track.stop()
    }
    syncLocalStream()
  }, [syncLocalStream])

  /** Leaves the call. Video stays published while live view is on, unless `everything`. */
  const leaveMedia = useCallback((endCall: boolean, everything = false) => {
    inCallRef.current = false
    setInCall(false)
    setJoining(false)
    const keepVideo = liveViewRef.current && !everything
    dropTracks((track) => keepVideo && track.kind === Track.Kind.Video)
    setMuted(false)
    if (!keepVideo) {
      streams.current.clear()
      setRemotes([])
      setCameraOn(true)
    }
    if (endCall) ownEndsAt.current = null
    setAttributes(endCall ? { [IN_CALL]: '', [CALL_ENDS_AT]: '' } : { [IN_CALL]: '' })
    if (keepVideo) handlers.current.refresh()
  }, [dropTracks, setAttributes])

  const beginMedia = useCallback(async () => {
    const lk = roomRef.current
    if (!lk) return
    if (trackOf(tracksRef.current, Track.Kind.Audio) && trackOf(tracksRef.current, Track.Kind.Video)) {
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
      let created: LocalTrack[] = []
      try {
        if (window.circleAPI) {
          const access = await window.circleAPI.requestMediaAccess()
          if (!access.camera && !access.microphone) {
            throw new Error('Camera and microphone are blocked. Allow them for Electron in System Settings, then try the call again.')
          }
        }
        let stale = false
        // Live view may already publish video; only open what is missing.
        await enqueue(async () => {
          const needAudio = !trackOf(tracksRef.current, Track.Kind.Audio)
          const needVideo = !trackOf(tracksRef.current, Track.Kind.Video)
          if (!needAudio && !needVideo) return
          created = await createLocalTracks({
            audio: needAudio ? { echoCancellation: true, noiseSuppression: true } : false,
            video: needVideo ? VIDEO_OPTIONS : false,
          })
          if (roomRef.current !== lk) {
            created.forEach((track) => track.stop())
            created = []
            stale = true
            return
          }
          for (const track of created) await lk.localParticipant.publishTrack(track)
          tracksRef.current = [...tracksRef.current, ...created]
        })
        if (stale) return
        syncLocalStream()
        inCallRef.current = true
        setInCall(true)
        const claimed = callEndsAtRef.current
        if (claimed) ownEndsAt.current = Math.max(ownEndsAt.current ?? 0, claimed)
        setAttributes({ [IN_CALL]: '1', [CALL_ENDS_AT]: claimed ? String(claimed) : '' })
        handlers.current.refresh()
      } catch (err) {
        const failed = new Set(created)
        tracksRef.current = tracksRef.current.filter((track) => !failed.has(track))
        for (const track of created) {
          void lk.localParticipant.unpublishTrack(track).catch(() => undefined)
          track.stop()
        }
        inCallRef.current = false
        setInCall(false)
        // Do not auto-retry this call on the next attribute change.
        declinedEndsAt.current = callEndsAtRef.current
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
  }, [enqueue, setAttributes, syncLocalStream])

  const startLiveVideo = useCallback(() => enqueue(async () => {
    const lk = roomRef.current
    if (!lk || !liveViewRef.current || trackOf(tracksRef.current, Track.Kind.Video)) return
    let video: LocalTrack | undefined
    try {
      if (window.circleAPI) {
        const access = await window.circleAPI.requestMediaAccess()
        if (!access.camera) throw new Error('Camera access is off. Allow it for Electron in System Settings.')
      }
      ;[video] = await createLocalTracks({ audio: false, video: VIDEO_OPTIONS })
      if (!video || roomRef.current !== lk || !liveViewRef.current) {
        video?.stop()
        return
      }
      await lk.localParticipant.publishTrack(video)
      tracksRef.current = [...tracksRef.current, video]
      setCameraOn(true)
      syncLocalStream()
      handlers.current.refresh()
    } catch (err) {
      if (video && !tracksRef.current.includes(video)) video.stop()
      setError(err instanceof Error ? err.message : 'Could not open the camera for live view.')
    }
  }), [enqueue, syncLocalStream])

  const stopLiveVideo = useCallback(() => enqueue(async () => {
    if (liveViewRef.current || inCallRef.current) return
    dropTracks(() => false)
    streams.current.clear()
    setRemotes([])
  }), [dropTracks, enqueue])

  /** Newest live view switch from anyone in the room, including our own unechoed one. */
  const liveViewWanted = useCallback((lk: Room): boolean => {
    if (!allowLiveRef.current) return false
    let latest = ownLive.current
    for (const participant of [lk.localParticipant, ...lk.remoteParticipants.values()]) {
      const next = liveSwitchOf(participant)
      if (next && (!latest || next.at > latest.at)) latest = next
    }
    return Boolean(latest?.on)
  }, [])

  const refresh = useCallback(() => {
    const lk = roomRef.current
    if (!lk) return
    const participants = [...lk.remoteParticipants.values()]
    setPeers(participants.map((participant) => ({
      peerId: participant.identity,
      name: participant.name || 'Friend',
    })))

    const wantLive = liveViewWanted(lk)
    if (wantLive !== liveViewRef.current) {
      liveViewRef.current = wantLive
      setLiveViewState(wantLive)
      void (wantLive ? startLiveVideo() : stopLiveVideo())
    }

    const reconnecting = lk.state === ConnectionState.Reconnecting || lk.state === ConnectionState.SignalReconnecting
    const tiles: RemoteTile[] = []
    const live = new Set<string>()
    if (inCallRef.current || liveViewRef.current) {
      for (const participant of participants) {
        // Live view is video only: play others' audio only while we are in the call too.
        const tracks = [...participant.trackPublications.values()]
          .filter((pub) => pub.track && (pub.kind === Track.Kind.Video || (pub.kind === Track.Kind.Audio && inCallRef.current)))
          .map((pub) => pub.track!.mediaStreamTrack)
        if (participant.attributes[IN_CALL] !== '1' && tracks.length === 0) continue
        live.add(participant.identity)
        // Reuse the MediaStream until the tracks change so <video> does not reload.
        const key = tracks.map((track) => track.id).sort().join(',')
        let cached = streams.current.get(participant.identity)
        if (!cached || cached.key !== key) {
          cached = { key, stream: tracks.length ? new MediaStream(tracks) : null }
          streams.current.set(participant.identity, cached)
        }
        tiles.push({
          peerId: participant.identity,
          name: participant.name || 'Friend',
          stream: cached.stream,
          connection: reconnecting ? 'disconnected' : cached.stream ? 'connected' : 'connecting',
          focus: participant.attributes[FOCUS] || 'off',
        })
      }
    }
    for (const id of [...streams.current.keys()]) {
      if (!live.has(id)) streams.current.delete(id)
    }
    setRemotes(tiles)

    const endsAt = activeEndsAt(lk)
    if (endsAt !== callEndsAtRef.current) setCallWindow(endsAt)
    if (endsAt && !inCallRef.current && !startingRef.current && declinedEndsAt.current !== endsAt) {
      void beginMedia()
    }
  }, [activeEndsAt, beginMedia, liveViewWanted, setCallWindow, startLiveVideo, stopLiveVideo])

  handlers.current.refresh = refresh
  handlers.current.stopMedia = () => {
    liveViewRef.current = false
    ownLive.current = null
    setLiveViewState(false)
    leaveMedia(false, true)
  }

  useEffect(() => {
    if (status === 'connected') setAttributes({ [FOCUS]: focus })
  }, [focus, status, setAttributes])

  // Turning the demo flag off stops live view here even if someone else left it on.
  useEffect(() => {
    handlers.current.refresh()
  }, [allowLiveView])

  useEffect(() => {
    if (!callEndsAt) return
    const timer = window.setTimeout(() => {
      declinedEndsAt.current = null
      setCallWindow(null)
      leaveMedia(true)
    }, Math.max(0, callEndsAt - Date.now() + 400))
    return () => window.clearTimeout(timer)
  }, [callEndsAt, leaveMedia, setCallWindow])

  useEffect(() => {
    if (!room) {
      setStatus('idle')
      setPeers([])
      return
    }

    let disposed = false
    let retry: ReturnType<typeof setTimeout> | null = null
    let attempts = 0
    // adaptiveStream pauses video that is not attached through LiveKit; we render raw MediaStreams.
    const lk = new Room({ adaptiveStream: false, dynacast: true })
    roomRef.current = lk

    const refreshNow = () => handlers.current.refresh()
    const scheduleRetry = (message: string) => {
      attempts += 1
      setStatus('connecting')
      setError(attempts > 1 ? `Reconnecting to the circle… (${message})` : '')
      retry = setTimeout(() => void connect(), Math.min(8000, 1000 * attempts))
    }

    lk
      .on(RoomEvent.ParticipantConnected, refreshNow)
      .on(RoomEvent.ParticipantDisconnected, refreshNow)
      .on(RoomEvent.ParticipantAttributesChanged, refreshNow)
      .on(RoomEvent.ParticipantNameChanged, refreshNow)
      .on(RoomEvent.TrackSubscribed, refreshNow)
      .on(RoomEvent.TrackUnsubscribed, refreshNow)
      .on(RoomEvent.Reconnecting, () => {
        setStatus('connecting')
        refreshNow()
      })
      .on(RoomEvent.Reconnected, () => {
        setStatus('connected')
        setError('')
        refreshNow()
      })
      .on(RoomEvent.Disconnected, () => {
        if (disposed) return
        handlers.current.stopMedia()
        setPeers([])
        scheduleRetry('connection lost')
      })

    const connect = async () => {
      if (disposed) return
      setStatus('connecting')
      try {
        if (!window.circleAPI) throw new Error('Calls need the Lock In desktop app.')
        const { url, token } = await window.circleAPI.getCallToken(room.sessionCode, selfId.current, room.name)
        if (disposed) return
        await lk.connect(url, token)
        if (disposed) {
          void lk.disconnect()
          return
        }
        attempts = 0
        setStatus('connected')
        setError('')
        refreshNow()
      } catch (err) {
        if (disposed) return
        const message = ipcMessage(err)
        if (/not set up|session code|desktop app/i.test(message)) {
          setStatus('error')
          setError(message)
          return
        }
        console.error('LiveKit connect failed', err)
        scheduleRetry(message)
      }
    }

    void connect()
    return () => {
      disposed = true
      if (retry) clearTimeout(retry)
      handlers.current.stopMedia()
      roomRef.current = null
      void lk.disconnect()
      window.circleAPI?.setCallMode(false)
    }
  }, [room?.name, room?.sessionCode])

  const startCall = useCallback(() => {
    declinedEndsAt.current = null
    if (callEndsAtRef.current && callEndsAtRef.current > Date.now()) {
      void beginMedia()
      return
    }
    const lk = roomRef.current
    if (!lk || lk.state !== ConnectionState.Connected) {
      setError('Still connecting to the circle. Try the call again in a moment.')
      return
    }
    const endsAt = Date.now() + CALL_DURATION_MS
    ownEndsAt.current = endsAt
    setCallWindow(endsAt)
    setAttributes({ [CALL_ENDS_AT]: String(endsAt) })
    void beginMedia()
  }, [beginMedia, setAttributes, setCallWindow])

  const joinCall = useCallback(() => {
    declinedEndsAt.current = null
    void beginMedia()
  }, [beginMedia])

  const leaveCall = useCallback(() => {
    declinedEndsAt.current = callEndsAtRef.current
    setCallError('')
    leaveMedia(false)
    void window.circleAPI?.setCallMode(false)
  }, [leaveMedia])

  const dismissCallError = useCallback(() => {
    declinedEndsAt.current = callEndsAtRef.current
    setCallError('')
    void window.circleAPI?.setCallMode(false)
  }, [])

  const setLiveView = useCallback((on: boolean) => {
    if (!allowLiveRef.current) return
    const next = { on, at: Date.now() }
    ownLive.current = next
    setAttributes({ [LIVE_VIEW]: `${on ? 'on' : 'off'}:${next.at}` })
    handlers.current.refresh()
  }, [setAttributes])

  const toggleMute = useCallback(() => {
    const audio = tracksRef.current.find((track) => track.kind === Track.Kind.Audio)
    if (!audio) return
    const next = !audio.isMuted
    setMuted(next)
    void (next ? audio.mute() : audio.unmute()).catch(() => undefined)
  }, [])

  const toggleCamera = useCallback(() => {
    const video = tracksRef.current.find((track) => track.kind === Track.Kind.Video)
    if (!video) return
    const off = !video.isMuted
    setCameraOn(!off)
    // LiveKit stops the camera on mute and restarts it on unmute with a new track.
    void (off ? video.mute() : video.unmute()).then(syncLocalStream).catch(() => undefined)
  }, [syncLocalStream])

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
    liveView,
    setLiveView,
    startCall,
    joinCall,
    leaveCall,
    dismissCallError,
    toggleMute,
    toggleCamera,
  }
}
