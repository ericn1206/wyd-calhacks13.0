import { extractSessionContext, SessionContext, summarizeTranscript } from './claudeJudge'

export type OnboardingPhase = 'idle' | 'speaking' | 'listening' | 'processing' | 'done'

export class SessionManager {
  private context: SessionContext | null = null
  private phase: OnboardingPhase = 'idle'

  private onPhaseChange: ((phase: OnboardingPhase) => void) | null = null
  private onContextReady: ((ctx: SessionContext) => void) | null = null

  onPhase(cb: (phase: OnboardingPhase) => void): void {
    this.onPhaseChange = cb
  }

  onReady(cb: (ctx: SessionContext) => void): void {
    this.onContextReady = cb
  }

  private setPhase(phase: OnboardingPhase): void {
    this.phase = phase
    this.onPhaseChange?.(phase)
  }

  beginListening(): void {
    this.setPhase('listening')
  }

  async handleUserResponse(transcript: string): Promise<SessionContext> {
    this.setPhase('processing')

    let context: SessionContext
    try {
      context = await extractSessionContext(transcript)
    } catch {
      context = summarizeTranscript(transcript)
    }
    this.context = context
    this.setPhase('done')
    this.onContextReady?.(context)
    return context
  }

  getContext(): SessionContext | null {
    return this.context
  }

  isOnboarded(): boolean {
    return this.context !== null
  }
}
