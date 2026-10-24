import Anthropic from '@anthropic-ai/sdk'

// Fallback judge per claude.md (primary is the small model on Inferentia).
export const MODEL = 'claude-haiku-5-5'

let client: Anthropic | null = null

// One short call that must answer with a single JSON object. Returns null if
// the model refused or didn't produce parseable JSON.
export async function askJson(system: string, user: string): Promise<Record<string, unknown> | null> {
  client ??= new Anthropic()
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    messages: [{ role: 'user', content: user }],
    // Classification doesn't need deep thinking. `output_config` isn't in
    // SDK 0.27's types, but the SDK sends the body through unchanged.
    ...({ output_config: { effort: 'low' } } as object)
  })

  const text = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? ''
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0])
  } catch {
    return null
  }
}
