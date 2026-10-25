import { useEffect, useRef, useState } from 'react'

const CARTESIA_VERSION = '2026-08-14'
const SAMPLE_RATE = 16000
const SILENCE_BEFORE_END_MS = 2500

/** True when the agent is still waiting on the user, even if the line has no question mark. */
function expectsReply(text: string): boolean {
  const t = text.trim()
  if (!t || t.includes('?')) return Boolean(t)
  return (
    /\b(what|which|where|how|who|when|why)\s+(do|does|did|are|is|should|would|can|could|will|about)\b/i.test(t) ||
    /\b(what|which)\s+(sites?|apps?|tools?|pages?|subjects?|topics?)\b/i.test(t) ||
    /\b(tell me|let me know)\b/i.test(t)
  )
}

export interface AgentCredentials {
  token: string
  agentId: string
}

type CallStatus = 'connecting' | 'listening' | 'speaking'

export interface TranscriptTurn {
  id: number
  role: 'user' | 'assistant'
  text: string
  live: boolean
}

export function useCartesiaCall(
  creds: AgentCredentials | null,
  stream: MediaStream | null,
  onUserTranscript: (text: string) => void,
  onSettled: () => void
): { status: CallStatus; error: string; transcript: TranscriptTurn[] } {
  const [status, setStatus] = useState<CallStatus>('connecting')
  const [error, setError] = useState('')
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([])
  const onTranscriptRef = useRef(onUserTranscript)
  const onSettledRef = useRef(onSettled)
  onTranscriptRef.current = onUserTranscript
  onSettledRef.current = onSettled

  useEffect(() => {
    if (!creds || !stream) return

    let closed = false
    let ready = false
    let submitted = false
    let userTurns = 0
    let closeWhenQuiet = false
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    let nextTurnId = 0
    let liveUserId = 0
    let liveAgentId = 0
    let agentText = ''
    const lines: string[] = []
    const turns: TranscriptTurn[] = []

    const publishTranscript = () => {
      if (!closed) setTranscript(turns.map(turn => ({ ...turn })))
    }

    const startTurn = (role: 'user' | 'assistant'): number => {
      const id = ++nextTurnId
      turns.push({ id, role, text: '', live: true })
      publishTranscript()
      return id
    }
    const playback = { next: 0, sources: [] as AudioBufferSourceNode[] }
    const audioCtx = new AudioContext()
    void audioCtx.resume()

    const ws = new WebSocket(
      `wss://api.cartesia.ai/v1/agents/websocket/${encodeURIComponent(creds.agentId)}` +
        `?cartesia_version=${CARTESIA_VERSION}&access_token=${encodeURIComponent(creds.token)}`
    )

    const clearWrapUp = () => {
      if (settleTimer) {
        clearTimeout(settleTimer)
        settleTimer = null
      }
    }

    const finishInterview = () => {
      if (submitted || closed || userTurns === 0) return
      submitted = true
      closeWhenQuiet = false
      clearWrapUp()
      onTranscriptRef.current(lines.join('\n'))
      onSettledRef.current()
    }

    const armWrapUp = () => {
      clearWrapUp()
      if (!closeWhenQuiet || submitted || closed || playback.sources.length > 0) return
      settleTimer = setTimeout(finishInterview, SILENCE_BEFORE_END_MS)
    }

    const stopPlayback = () => {
      for (const source of playback.sources) {
        try { source.stop() } catch { /* already stopped */ }
      }
      playback.sources = []
      playback.next = 0
      if (!closed) setStatus('listening')
    }

    const playPcm = (pcm: Int16Array) => {
      if (pcm.length === 0) return
      clearWrapUp()
      const buffer = audioCtx.createBuffer(1, pcm.length, SAMPLE_RATE)
      const channel = buffer.getChannelData(0)
      for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 32768
      const source = audioCtx.createBufferSource()
      source.buffer = buffer
      source.connect(audioCtx.destination)
      const startAt = Math.max(audioCtx.currentTime + 0.02, playback.next)
      source.start(startAt)
      playback.next = startAt + buffer.duration
      playback.sources.push(source)
      setStatus('speaking')
      source.onended = () => {
        playback.sources = playback.sources.filter(item => item !== source)
        if (playback.sources.length === 0 && !closed) {
          setStatus('listening')
          armWrapUp()
        }
      }
    }

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'session_create',
        audio: {
          input_format: 'pcm_16000',
          output_delivery: 'speaking_pace',
          continuous_input: true
        }
      }))
    }

    ws.onmessage = event => {
      let message: {
        type?: string
        audio?: string
        role?: string
        text?: string
        message?: string
        fatal?: boolean
        interrupted?: boolean
      }
      try {
        message = JSON.parse(String(event.data))
      } catch {
        return
      }

      if (message.type === 'session_ready') {
        ready = true
        if (!closed) setStatus('listening')
        return
      }
      if (message.type === 'audio_output' && message.audio) {
        try {
          playPcm(base64ToInt16(message.audio))
        } catch (err) {
          console.error('Failed to play agent audio', err)
        }
        return
      }
      if (message.type === 'audio_output_clear') {
        closeWhenQuiet = false
        clearWrapUp()
        stopPlayback()
        return
      }
      if (message.type === 'turn_started') {
        closeWhenQuiet = false
        clearWrapUp()
        if (message.role === 'assistant') {
          liveAgentId = startTurn('assistant')
          agentText = ''
          if (!closed) setStatus('speaking')
        } else if (message.role === 'user') {
          liveUserId = startTurn('user')
          if (!closed) setStatus('listening')
        }
        return
      }
      if (message.type === 'turn_output_text_delta' && message.role === 'assistant' && message.text) {
        if (!liveAgentId) {
          liveAgentId = startTurn('assistant')
          agentText = ''
        }
        agentText += message.text
        const row = turns.find(turn => turn.id === liveAgentId)
        if (row) row.text = agentText
        publishTranscript()
        return
      }
      if (message.type === 'turn_ended' && message.role === 'user') {
        closeWhenQuiet = false
        clearWrapUp()
        const text = message.text?.trim() ?? ''
        const row = turns.find(turn => turn.id === liveUserId)
        if (text) {
          userTurns += 1
          lines.push(`User: ${text}`)
          if (row) {
            row.text = text
            row.live = false
          } else {
            turns.push({ id: ++nextTurnId, role: 'user', text, live: false })
          }
        } else if (row) {
          turns.splice(turns.indexOf(row), 1)
        }
        liveUserId = 0
        publishTranscript()
        if (!closed) setStatus('listening')
        return
      }
      if (message.type === 'turn_ended' && message.role === 'assistant') {
        const text = (message.text?.trim() || agentText.trim())
        const row = turns.find(turn => turn.id === liveAgentId)
        if (text) {
          lines.push(`Agent: ${text}`)
          if (row) {
            row.text = text
            row.live = false
          } else {
            turns.push({ id: ++nextTurnId, role: 'assistant', text, live: false })
          }
        } else if (row) {
          turns.splice(turns.indexOf(row), 1)
        }
        liveAgentId = 0
        agentText = ''
        publishTranscript()
        closeWhenQuiet = !submitted && userTurns > 0 && Boolean(text) && !expectsReply(text)
        if (!closed && playback.sources.length === 0) setStatus('listening')
        armWrapUp()
        return
      }
      if (message.type === 'error') {
        setError(message.message || 'The voice agent hit an error')
        if (message.fatal) ws.close()
      }
    }

    ws.onerror = () => {
      if (!closed) setError('Could not connect to the Cartesia voice agent')
    }
    ws.onclose = () => {
      if (!closed && !ready) setError(prev => prev || 'The voice agent disconnected before it started')
    }

    let stopCapture: () => void = () => undefined
    void startMicCapture(audioCtx, stream, pcm => {
      if (!ready || closed || ws.readyState !== WebSocket.OPEN) return
      try {
        ws.send(JSON.stringify({ type: 'audio_input', audio: int16ToBase64(pcm) }))
      } catch (err) {
        console.error('Failed to send microphone audio', err)
      }
    }).then(stop => {
      if (closed) stop()
      else stopCapture = stop
    }).catch(err => {
      console.error('Microphone capture failed', err)
      if (!closed) setError('Could not capture the microphone for the voice agent')
    })

    return () => {
      closed = true
      if (settleTimer) clearTimeout(settleTimer)
      stopPlayback()
      stopCapture()
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, 'session completed')
      }
      void audioCtx.close()
    }
  }, [creds, stream])

  return { status, error, transcript }
}

function downsampleTo16k(input: Float32Array, sampleRate: number): Int16Array {
  const ratio = sampleRate / SAMPLE_RATE
  const length = Math.max(0, Math.floor(input.length / ratio))
  const out = new Int16Array(length)
  for (let i = 0; i < length; i++) {
    const index = i * ratio
    const left = Math.floor(index)
    const right = Math.min(left + 1, input.length - 1)
    const sample = input[left] * (1 - (index - left)) + input[right] * (index - left)
    const clamped = Math.max(-1, Math.min(1, sample))
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
  }
  return out
}

function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

async function startMicCapture(
  audioCtx: AudioContext,
  stream: MediaStream,
  onPcm: (pcm: Int16Array) => void
): Promise<() => void> {
  const worklet = `
    class PcmCapture extends AudioWorkletProcessor {
      process(inputs) {
        const channel = inputs[0] && inputs[0][0]
        if (channel) this.port.postMessage(channel.slice(0))
        return true
      }
    }
    registerProcessor('pcm-capture', PcmCapture)
  `
  const url = URL.createObjectURL(new Blob([worklet], { type: 'application/javascript' }))
  try {
    await audioCtx.audioWorklet.addModule(url)
  } finally {
    URL.revokeObjectURL(url)
  }
  const source = audioCtx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(audioCtx, 'pcm-capture')
  node.port.onmessage = (event: MessageEvent<Float32Array>) => {
    const pcm = downsampleTo16k(event.data, audioCtx.sampleRate)
    if (pcm.length > 0) onPcm(pcm)
  }
  source.connect(node)
  return () => {
    node.port.onmessage = null
    node.disconnect()
    source.disconnect()
  }
}

function base64ToInt16(value: string): Int16Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length - (binary.length % 2))
  for (let i = 0; i < bytes.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Int16Array(bytes.buffer)
}
