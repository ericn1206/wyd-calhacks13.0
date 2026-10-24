const CARTESIA_VERSION = '2026-08-14'

export interface AgentCredentials {
  token: string
  agentId: string
}

export async function createAgentSession(): Promise<AgentCredentials> {
  const apiKey = process.env.CARTESIA_API_KEY?.trim()
  const agentId = process.env.CARTESIA_AGENT_ID?.trim()
  if (!apiKey || !agentId) {
    throw new Error('CARTESIA_API_KEY and CARTESIA_AGENT_ID must be set in .env')
  }

  const response = await fetch('https://api.cartesia.ai/access-token', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Cartesia-Version': CARTESIA_VERSION,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ grants: { agent: true }, expires_in: 600 })
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Cartesia rejected the voice agent (${response.status}). ${detail.slice(0, 180)}`)
  }

  const body = (await response.json()) as { token?: string }
  if (!body.token) throw new Error('Cartesia did not return an access token')
  return { token: body.token, agentId }
}
