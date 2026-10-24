import { askJson } from './claude.ts'
import { STATUSES } from './types.ts'
import type { FocusEvent, Judgment, Status } from './types.ts'

const WINDOW_MS = 2 * 60 * 1000

const SYSTEM = `You judge whether a student in a group focus session is on task.

You get their study topic, the Pomodoro phase, and the last ~2 minutes of signals, one line per sample:
- the active app and window title, with a rule-based category ("unknown" means the rules couldn't tell)
- webcam signals computed on their laptop: eyes, posture, looking away, phone visible
- whether their phone is in use

Pick one status for the window as a whole:
- "on_task": working on the topic, or on something that plausibly supports it — docs, notes, a lecture or tutorial on the topic, a study-group chat, background music while working.
- "off_task": most of the window is spent on something unrelated to the topic (social feeds, entertainment video, unrelated chat, phone use), or the person clearly isn't working (eyes closed or looking away for most of it).
- "break": only when the phase is a scheduled break. Never use it during a work block.

A short switch (under ~30 seconds) inside otherwise focused work is still on_task. Use the window title to tell study content from entertainment on sites like YouTube, Reddit, or Discord.

confidence is how sure you are, from 0 to 1. Go below 0.6 when the evidence is mixed or the title doesn't settle it.

reason is at most 8 words, factual and friendly — it may be shown to the group, so never shame. Example: "Watching music videos for 2 minutes".

Reply with only this JSON object: {"status": "on_task" | "off_task" | "break", "confidence": number, "reason": string}`

function describe(e: FocusEvent): string {
  const s = e.signals
  const time = e.time.slice(11, 19)
  const phone = s.phoneInUse ? 'in use' : s.phoneVisible ? 'visible' : 'no'
  return `${time} ${e.activity.app} — "${e.activity.title}" [${e.activity.category}] | ` +
    `eyes:${s.eyes} posture:${s.posture} lookingAway:${s.lookingAway ? 'yes' : 'no'} phone:${phone}`
}

export async function judge(
  topic: string,
  events: FocusEvent[],
  phase: 'work' | 'break' = 'work'
): Promise<Judgment> {
  const latest = events.length ? Date.parse(events[events.length - 1].time) : 0
  const recent = events.filter(e => latest - Date.parse(e.time) <= WINDOW_MS)

  const user = `Study topic: ${topic}
Pomodoro phase: ${phase === 'break' ? 'scheduled 5-minute break' : 'work block'}

Last 2 minutes:
${recent.map(describe).join('\n') || '(no samples)'}`

  try {
    const out = await askJson(SYSTEM, user)
    const status = STATUSES.includes(out?.status as Status) ? (out!.status as Status) : null
    const confidence = Number(out?.confidence)
    if (!status || !(confidence >= 0 && confidence <= 1)) throw new Error(`bad reply: ${JSON.stringify(out)}`)
    return { status, confidence, reason: String(out!.reason ?? '').slice(0, 80) }
  } catch (err) {
    console.error('[judge]', err instanceof Error ? err.message : err)
    // confidence 0 < 0.6, so smoothing treats this as neutral
    return { status: 'on_task', confidence: 0, reason: 'Judge unavailable' }
  }
}
