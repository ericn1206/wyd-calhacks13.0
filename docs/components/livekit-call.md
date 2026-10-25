# LiveKit check-in call

## Purpose
Live 30 s group check-in when someone drifts: the drifter's camera, mic and screen; teammates join by invite. One LiveKit room per session code.

## Files
| File | Role |
|---|---|
| `src/main/livekitToken.ts` | `createCallToken(code, identity, name)`: HS256 JWT signed with `LIVEKIT_API_SECRET` |
| `src/main/index.ts`, `src/preload/index.ts` | IPC `call:token`, `window:call-mode`, `wyd:window:capture-hidden`, `wyd:media:request`; `circleAPI`; `publishFacetime()` sends `facetime:start` to the overlay |
| `src/renderer/src/useCircleCall.ts` | Room connect/retry, peers, call state (participant attributes), publish/unpublish, screen share, `autoJoin`, `callFrom`, `screenShare`, `declineCall` |
| `src/renderer/src/overlay/LiveCheckIn.tsx` | Overlay check-in: trigger → own call (+ screen share) or duck window; teammates' calls → 3 s Join invite; share window for joiners |
| `src/renderer/src/overlay/OverlayApp.tsx`, `components/overlays/FocusDock.tsx` | Invite toast under the dock, duck window (+ Resume), mock check-ins for the Demo menu |

## Inputs / Outputs
Room name, identity, token grants, attributes (`callEndsAt`, `inCall`): `../architecture/contracts.md#livekit-room`. IPC: `../architecture/contracts.md`. Trigger: `../components/vision.md` (`face time`).

## Behavior
| Case | Result |
|---|---|
| My detector prints `face time`, teammates in the room | `startCall({ shareScreen: true })`: camera + mic + the front-most non-WYD window, i.e. the app they drifted to (no picker; `setDisplayMediaRequestHandler` skips our windows by `getMediaSourceId()`; whole screen only if no window is found) |
| No session room, or alone in it | Duck reflection window (no camera), 30 s, **Resume** ends it early |
| A teammate's call starts | Invite under the dock: "`<name>` drifted off task · Join", 3 s (`INVITE_SECONDS`); no click → `declineCall()` |
| Press **Join** on an invite | Also `recordJoinClip()`: the detector records this laptop's webcam for the drifter's session clip (`../architecture/contracts.md#session-clips`) |
| Joined a call with a screen share | Share window: screen big, sharer's webcam bottom-right, others + me bottom-left, countdown, Leave, progress bar |
| Call length | `CALL_DURATION_MS` 30 s, same end time for everyone (copied into each joiner's `callEndsAt`) |
| While sharing | Our windows are never the shared source, so the overlay's camera tiles can't appear (macOS 15+ ScreenCaptureKit ignores `setContentProtection`, which is still set as a fallback) |

## Run & test
1. Each laptop: `.env` `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (`../architecture/stack.md`); Screen Recording allowed for Electron.
2. Two laptops, or `npm run dev:two`: same session, host presses Start, one goes off task ~20 s → the other gets the invite → Join → sees the drifter's screen.
Credential check without the app: `POST <https URL>/twirp/livekit.RoomService/ListRooms` with a `roomList` token → 200.

## Gotchas & don'ts
- Don't add `livekit-server-sdk` to main: needs Node 19+, Electron 28 = Node 18.
- Never send `LIVEKIT_API_SECRET` to the renderer; tokens come only from `call:token`.
- `Room({ adaptiveStream: false, dynacast: false })` is required: tiles render raw `MediaStream`s.
- `app.configureHostResolver({ enableBuiltInResolver: false })` (main): Chromium's own DNS failed on `*.turn.livekit.cloud` / `*.host.livekit.cloud` with a VPN up.
- Electron 28 can log `BUNDLE group contains a codec collision for payload_type='96'`; if remote video stays black, pin `publishTrack(track, { videoCodec: 'vp8', backupCodec: false, red: false })`.
- Without Screen Recording permission the call runs camera-only (screen share fails silently, logged).
- Not linked to the DB `group_call` / `CallIncoming` flow; the trigger is the local detector.
