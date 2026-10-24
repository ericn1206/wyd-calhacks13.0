import Anthropic from '@anthropic-ai/sdk'

export interface SessionContext {
  subject: string
  goals: string[]
  notes: string
}

export interface JudgmentResult {
  category: 'productive' | 'distracted' | 'neutral'
  reason: string
}

let _client: Anthropic | null = null
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return _client
}

export async function judgeActivity(
  appName: string,
  windowTitle: string,
  url: string | undefined,
  recentHistory: Array<{ appName: string; url?: string; windowTitle: string }>,
  sessionContext: SessionContext
): Promise<JudgmentResult> {
  const historyText = recentHistory.length > 0
    ? recentHistory.slice(-5).map(h =>
        `- ${h.appName}${h.url ? ` (${h.url})` : h.windowTitle ? ` — "${h.windowTitle}"` : ''}`
      ).join('\n')
    : '(session just started)'

  const prompt = `You are a focus monitor for a study session. The user told you at the start:

Subject: ${sessionContext.subject}
Goals: ${sessionContext.goals.length > 0 ? sessionContext.goals.join(', ') : 'not specified'}
${sessionContext.notes ? `Context: ${sessionContext.notes}` : ''}

Current activity:
- App: ${appName}
- Window title: ${windowTitle}${url ? `\n- URL: ${url}` : ''}

Recent app switches:
${historyText}

Classify the CURRENT activity as one of:
- "productive": directly helps their stated subject/goals (even loosely — a search engine could be productive if they're researching)
- "distracted": clearly off-task (social media, entertainment, gaming, unrelated browsing)
- "neutral": system tasks, ambiguous, or unclear

Be lenient about "productive" — if it plausibly relates to their subject, call it productive.

Reply ONLY with valid JSON (no other text): {"category":"productive"|"distracted"|"neutral","reason":"<8 words max>"}`

  try {
    const response = await getClient().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 80,
      messages: [{ role: 'user', content: prompt }]
    })

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
    const match = text.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(match?.[0] ?? '{}')
    const category = ['productive', 'distracted', 'neutral'].includes(parsed.category)
      ? parsed.category as JudgmentResult['category']
      : 'neutral'
    return { category, reason: parsed.reason ?? appName }
  } catch {
    return { category: 'neutral', reason: appName }
  }
}

export async function extractSessionContext(transcript: string): Promise<SessionContext> {
  const response = await getClient().messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `Extract study session context from this response to "What are you working on today?":

"${transcript}"

Reply ONLY with valid JSON:
{"subject":"<what they're studying, concise>","goals":["<goal1>","<goal2>"],"notes":"<any other context like allowed tools, exam deadline, etc>"}`
    }]
  })

  const text = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
  try {
    const match = text.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(match?.[0] ?? '{}')
    return {
      subject: parsed.subject ?? 'General study',
      goals: Array.isArray(parsed.goals) ? parsed.goals : [],
      notes: parsed.notes ?? ''
    }
  } catch {
    return { subject: transcript.slice(0, 80), goals: [], notes: '' }
  }
}
