import { speak } from './cartesiaTTS'
import { extractSessionContext, SessionContext } from './claudeJudge'

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

  async startOnboarding(): Promise<void> {
    this.setPhase('speaking')
    await speak("Hey! Before we lock in — what are you working on today? Tell me your subject and what you're trying to get done.")
    this.setPhase('listening')
  }

  async handleUserResponse(transcript: string): Promise<SessionContext> {
    this.setPhase('processing')

    const context = await extractSessionContext(transcript)
    this.context = context

    const goals = context.goals.length > 0 ? `Your goals: ${context.goals.join(' and ')}.` : ''
    const confirm = `Got it! Locked in for ${context.subject}. ${goals} Let's go.`

    this.setPhase('speaking')
    await speak(confirm)
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
