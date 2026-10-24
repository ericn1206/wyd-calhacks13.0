import { exec } from 'child_process'

// Placeholder: uses macOS `say` command.
// Replace with Cartesia API when ready:
//   POST https://api.cartesia.ai/tts/bytes
//   Headers: { 'X-API-Key': process.env.CARTESIA_API_KEY, 'Cartesia-Version': '2024-06-10' }
//   Body: { model_id: 'sonic-english', transcript, voice: { mode: 'id', id: process.env.CARTESIA_VOICE_ID }, output_format: { container: 'wav', encoding: 'pcm_s16le', sample_rate: 22050 } }
//   Then: writeFileSync('/tmp/attentionmaxx_tts.wav', Buffer.from(await response.arrayBuffer()))
//         exec('afplay /tmp/attentionmaxx_tts.wav')

export function speak(text: string): Promise<void> {
  return new Promise(resolve => {
    exec(`say "${text.replace(/"/g, '\\"')}"`, () => resolve())
  })
}
