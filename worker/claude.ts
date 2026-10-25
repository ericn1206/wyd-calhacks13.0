const GEMINI_MODEL = 'gemini-3.5-flash-lite'
export const MODEL = GEMINI_MODEL

// One short call that must answer with a single JSON object. Returns null if
// the model refused or didn't produce parseable JSON.
export async function askJson(system: string, user: string): Promise<Record<string, unknown> | null> {
  const key = process.env.GEMINI_API_KEY?.trim()
  if (!key) throw new Error('GEMINI_API_KEY is not set')

  const prompt = `${system}\n\n${user}`
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1024, temperature: 0, responseMimeType: 'application/json' },
      }),
      signal: AbortSignal.timeout(20000),
    }
  )

  const body = await response.json().catch(() => null) as {
    error?: { message?: string }
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  } | null
  if (!response.ok) throw new Error(body?.error?.message || `Gemini request failed (${response.status})`)

  const text = body?.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('').trim() ?? ''
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0])
  } catch {
    return null
  }
}
