const GEMINI_MODEL = 'gemini-3.5-flash-lite'

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

async function askGemini(prompt: string, maxTokens: number): Promise<string> {
  const key = process.env.GEMINI_API_KEY?.trim()
  if (!key) throw new Error('GEMINI_API_KEY is not set')
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0, responseMimeType: 'application/json' },
      }),
      signal: AbortSignal.timeout(20000),
    }
  )
  const body = await response.json().catch(() => null) as {
    error?: { message?: string }
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  } | null
  if (!response.ok) throw new Error(body?.error?.message || `Gemini request failed (${response.status})`)
  const text = body?.candidates?.[0]?.content?.parts?.map(part => part.text ?? '').join('').trim() ?? ''
  if (!text) throw new Error('Gemini returned no text')
  return text
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
- "productive": directly related to their stated subject/goals, or a tool/site they said they will use
- "distracted": clearly off-task — different subject, social media, entertainment, gaming, news, travel, shopping, nature/recreation sites, or any browsing unrelated to their goal
- "neutral": OS/system tasks (Finder, Settings, Terminal with no context), or genuinely ambiguous

Do NOT be lenient. If the content is about a topic other than their stated subject, it is "distracted". A search engine is productive only if the query is about their subject. A government or travel site is distracted if their goal is studying a different subject.

Reply ONLY with valid JSON (no other text): {"category":"productive"|"distracted"|"neutral","reason":"<8 words max>"}`

  try {
    const text = await askGemini(prompt, 80)
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

function stripFillers(value: string): string {
  return value
    .replace(/\b(?:um+|uh+|er+|ah+|hmm+|mm+)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.])/g, '$1')
    .replace(/^[,.\s]+|[,.\s]+$/g, '')
    .trim()
}

/** "Um, I'm going to uh, I'm going to study some chemistry" → "Study chemistry". */
export function condenseUtterance(raw: string): string {
  const words = stripFillers(raw)
    .replace(/[,.!?;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
  let changed = true
  while (changed) {
    changed = false
    for (let len = Math.min(8, Math.floor(words.length / 2)); len >= 2; len--) {
      for (let i = 0; i + len * 2 <= words.length; i++) {
        const a = words.slice(i, i + len).join(' ').toLowerCase()
        const b = words.slice(i + len, i + len * 2).join(' ').toLowerCase()
        if (a !== b) continue
        words.splice(i, len)
        changed = true
        break
      }
      if (changed) break
    }
  }
  let text = words.join(' ')
  for (let i = 0; i < 4; i++) {
    const next = text
      .replace(/^(?:so|well|okay|ok|yeah|yep|yes)\s+/i, '')
      .replace(/^i(?:'m|m| am)\s+(?:going to|gonna|trying to|planning to|about to)\s+/i, '')
      .replace(/^i(?:'m|m| am)\s+studying\s+/i, 'study ')
      .replace(/^i(?:'m|m| am)\s+working on\s+/i, 'work on ')
      .replace(/^i(?:'m|m| am)\s+reading\s+/i, 'read ')
      .replace(/^i(?:'m|m| am)\s+writing\s+/i, 'write ')
      .replace(/^i(?:'m|m| am)\s+reviewing\s+/i, 'review ')
      .replace(/^i(?:'m|m| am)\s+finishing\s+/i, 'finish ')
      .replace(/^i(?:'m|m| am)\s+practicing\s+/i, 'practice ')
      .replace(/^i(?:'m|m| am)\s+doing\s+/i, 'do ')
      .replace(/^i\s+(?:want|need|have|plan|hope)\s+to\s+/i, '')
      .replace(/^i\s+(?:wanna|gotta)\s+/i, '')
      .replace(/^(?:i(?:'ll| will)|gonna|let me)\s+/i, '')
      .replace(/^[,.\s]+/, '')
      .trim()
    if (next === text) break
    text = next
  }
  text = text.replace(/\bsome\s+(?!of\b)/i, '').replace(/\s+/g, ' ').trim()
  if (!text || isFiller(text)) return ''
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function taskPhrase(value: unknown, fallback: string, max: number): string {
  const condensed = typeof value === 'string' ? condenseUtterance(value) : ''
  if (condensed && !looksLikeDialogue(condensed) && condensed.length <= max) return condensed
  return fallback
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
  const goals: string[] = []
  for (const line of study.filter(line => line !== sites)) {
    const phrase = condenseUtterance(line)
    if (phrase && !goals.some(goal => goal.toLowerCase() === phrase.toLowerCase())) goals.push(phrase)
  }
  return {
    subject: goals[0] || 'General study',
    goals: goals.slice(0, 3),
    sites: stripFillers(sites),
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
    text = await askGemini(`Summarize this focus-session interview. Lines starting with "User:" are the person. Lines starting with "Agent:" are the assistant. Use only what the user said.

${transcript}

Reply with ONLY this JSON object. Each subject and goal is a short task title (2–6 words), like "Study chemistry". Never copy filler (um, uh) or "I'm going to". Do not include the words User or Agent:
{"subject":"<short task title>","goals":["<short task title>"],"sites":"<the user's own words for the websites, apps, or tools they plan to use>","notes":"<a deadline or other constraint, or empty>"}
If they never named a site, app, or tool, set sites to "".`, 300)
    const match = text.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(match?.[0] ?? '{}')
    const goals = Array.isArray(parsed.goals)
      ? parsed.goals
        .map((goal: unknown) => taskPhrase(goal, '', 80))
        .filter((goal: string) => goal && !isFiller(goal))
        .filter((goal: string, index: number, all: string[]) => all.findIndex(item => item.toLowerCase() === goal.toLowerCase()) === index)
        .slice(0, 3)
      : []
    return {
      subject: taskPhrase(parsed.subject, local.subject, 80),
      goals: goals.length ? goals : local.goals,
      sites: cleanText(typeof parsed.sites === 'string' ? stripFillers(parsed.sites) : parsed.sites, local.sites, 200),
      notes: cleanText(typeof parsed.notes === 'string' ? stripFillers(parsed.notes) : parsed.notes, '', 200)
    }
  } catch (err) {
    console.error('Session summary failed', err)
    return local
  }
}
