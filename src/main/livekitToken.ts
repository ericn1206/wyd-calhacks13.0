import { createHmac } from 'crypto'

const TOKEN_TTL_S = 6 * 60 * 60

export interface CallToken {
  url: string
  token: string
  room: string
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url')
}

function cleanCode(value: unknown): string {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
}

function cleanName(value: unknown): string {
  return String(value ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24)
}

/**
 * Mint a LiveKit access token for one circle. Signed here with HS256 so the
 * API secret never reaches the renderer. (livekit-server-sdk needs Node 19+,
 * and Electron 28 ships Node 18.)
 */
export function createCallToken(code: unknown, identity: unknown, name: unknown): CallToken {
  const url = process.env['LIVEKIT_URL']?.trim()
  const key = process.env['LIVEKIT_API_KEY']?.trim()
  const secret = process.env['LIVEKIT_API_SECRET']?.trim()
  if (!url || !key || !secret) {
    throw new Error('LiveKit is not set up. Add LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET to .env.')
  }

  const sessionCode = cleanCode(code)
  const id = String(identity ?? '').slice(0, 64)
  if (sessionCode.length < 4 || !id) throw new Error('Enter a session code of at least 4 characters.')

  const room = `lockin-${sessionCode}`
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = {
    iss: key,
    sub: id,
    name: cleanName(name) || 'Friend',
    nbf: now - 10,
    exp: now + TOKEN_TTL_S,
    video: {
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: true,
    },
  }

  const body = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`
  const signature = createHmac('sha256', secret).update(body).digest('base64url')
  return { url, token: `${body}.${signature}`, room }
}
