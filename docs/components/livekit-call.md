# LiveKit check-in call

## Purpose
Session presence (who's in the circle) and the short group video check-in. Works on any network; no LAN discovery.

## Files
| File | Role |
|---|---|
| `src/main/livekitToken.ts` | `createCallToken(code, identity, name)`: HS256 JWT signed with `LIVEKIT_API_SECRET` |
| `src/main/index.ts` | IPC `call:token`, `media:request-access`, `window:call-mode` |
| `src/renderer/src/useCircleCall.ts` | Room connect/retry, peers, call state, publish/unpublish, mute/camera |
| `src/renderer/src/VideoCall.tsx` | Full-screen call overlay, countdown, tiles |
| `src/renderer/src/App.tsx` | Lobby (name + code), circle bar, auto-call on local `alert` (5 min cooldown) |

## Inputs / Outputs
Room name, identity, token grants, participant attributes: `../architecture/contracts.md#livekit-room`. IPC: `../architecture/contracts.md#desktop-ipc-srcpreloadindexts`.

## Run & test
1. Each laptop: `.env` with `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (`../architecture/stack.md`).
2. `npm run dev` on both, same session code → each name appears in the other's circle bar.
3. "Call circle" → both join automatically; call ends after 90 s (`CALL_DURATION_MS`).
Credential check without the app: `POST <https URL>/twirp/livekit.RoomService/ListRooms` with a `roomList` token → 200.

## Current state
- Call trigger is the desktop's local alert or the button, not the DB `CallIncoming` alert.
- Leaving keeps `callEndsAt`, so "Rejoin call" works until it expires.

## Gotchas & don'ts
- Don't add `livekit-server-sdk` to main: needs Node 19+, Electron 28 = Node 18.
- Never send `LIVEKIT_API_SECRET` to the renderer; tokens come only from `call:token`.
- `Room({ adaptiveStream: false })` is required: tiles render raw `MediaStream`s, and adaptiveStream pauses video not attached through LiveKit.
- Camera off/on stops and restarts the camera track (new `MediaStreamTrack`); `syncLocalStream()` rebuilds the local preview.
- A remote with camera off shows a black tile, not their initial: hiding the `<video>` would also cut their audio.
- A failed camera/mic open marks that call declined so attribute updates don't retry in a loop; "Call circle"/"Rejoin" clears it.
