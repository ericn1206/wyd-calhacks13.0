import Anthropic from '@anthropic-ai/sdk'

export interface SessionContext {
  subject: string
  goals: string[]
  sites: string
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
Sites and apps they said they will use: ${sessionContext.sites || 'not specified'}
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

Be lenient about "productive" — if it plausibly relates to their subject, call it productive. A site or app they said they will use is productive.

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

function dialogueTurns(transcript: string): Array<{ role: 'user' | 'agent'; text: string }> {
  const turns: Array<{ role: 'user' | 'agent'; text: string }> = []
  for (const line of transcript.split('\n')) {
    const match = line.match(/^(User|Agent):\s*(.+)$/i)
    if (!match?.[2]) continue
    turns.push({
      role: match[1].toLowerCase() === 'user' ? 'user' : 'agent',
      text: match[2].trim()
    })
  }
  return turns
}

function looksLikeDialogue(value: string): boolean {
  return /\b(User|Agent):/i.test(value)
}

function isFiller(text: string): boolean {
  return /^(yeah|yep|yes|no|nah|wait|uh|um|okay|ok|totally|right|sure|hello|hey|hi)[.!]?$/i.test(text.trim())
}

/** Used when the model summary is missing. Pulls the user's own answers, never the agent lines. */
export function summarizeTranscript(transcript: string): SessionContext {
  const turns = dialogueTurns(transcript)
  let sites = ''
  const study: string[] = []
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]
    if (!turn) continue
    if (turn.role === 'agent' && /\b(sites?|apps?|tools?|websites?|pages?)\b/i.test(turn.text)) {
      const answer = turns.slice(i + 1).find(item => item.role === 'user' && !isFiller(item.text))
      if (answer) sites = answer.text
      continue
    }
    if (turn.role === 'user' && !isFiller(turn.text)) study.push(turn.text)
  }
  const studyLines = study.filter(line => line !== sites)
  return {
    subject: studyLines[0] || 'General study',
    goals: [],
    sites,
    notes: ''
  }
}

function cleanText(value: unknown, fallback: string, max: number): string {
  if (typeof value !== 'string') return fallback
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text || looksLikeDialogue(text) || text.length > max) return fallback
  return text
}

export async function extractSessionContext(transcript: string): Promise<SessionContext> {
  const local = summarizeTranscript(transcript)
  let text = ''
  try {
    const response = await getClient().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Summarize this focus-session interview. Lines starting with "User:" are the person. Lines starting with "Agent:" are the assistant. Use only what the user said.

${transcript}

Reply with ONLY this JSON object. Short plain text. Do not copy the dialogue and do not include the words User or Agent:
{"subject":"<a few words naming what the user is studying>","goals":["<what they want to finish>"],"sites":"<the user's own words for the websites, apps, or tools they plan to use>","notes":"<a deadline or other constraint, or empty>"}
If they never named a site, app, or tool, set sites to "".`
      }]
    })
    text = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
    const match = text.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(match?.[0] ?? '{}')
    const goals = Array.isArray(parsed.goals)
      ? parsed.goals
        .filter((goal: unknown): goal is string => typeof goal === 'string')
        .map((goal: string) => goal.replace(/\s+/g, ' ').trim())
        .filter((goal: string) => goal && !looksLikeDialogue(goal) && !isFiller(goal))
        .slice(0, 3)
      : []
    return {
      subject: cleanText(parsed.subject, local.subject, 80),
      goals,
      sites: cleanText(parsed.sites, local.sites, 200),
      notes: cleanText(parsed.notes, '', 200)
    }
  } catch (err) {
    console.error('Session summary failed', err)
    return local
  }
}
