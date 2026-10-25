export {}

type VoicePhase = 'idle' | 'speaking' | 'listening' | 'processing' | 'done'
type VoiceContext = { subject: string; goals: string[]; sites: string; notes: string }

declare global {
  interface Window {
    sessionAPI: {
      start(): Promise<{ token: string; agentId: string }>
      submitResponse(transcript: string): Promise<void>
      onPhase(cb: (phase: VoicePhase) => void): void
      onContextReady(cb: (ctx: VoiceContext) => void): void
      removeAllListeners(): void
    }
    circleAPI: {
      requestMediaAccess(): Promise<{ camera: boolean; microphone: boolean }>
      getCallToken(code: string, identity: string, name: string): Promise<{ url: string; token: string; room: string }>
      setCallMode(on: boolean): Promise<void>
      onFacetime(cb: () => void): () => void
    }
  }
}
