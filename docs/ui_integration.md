# WYD!! UI integration handoff

## Purpose

This file is the implementation handoff for future AI agents that will connect the WYD!! prototype to a backend and add production application logic. It records the UI's current flows, role rules, state transitions, persistence, permissions, data contracts, and integration boundaries so those agents can implement the underlying systems without reverse-engineering the interface.

This document must be updated whenever a feature is added, removed, renamed, or behaviorally changed. Existing sections should be corrected when behavior changes so the file remains a description of the current product rather than a historical changelog.

## Current UI inventory

The prototype is implemented primarily in `src/renderer/src/App.tsx`. It uses hardcoded people, focus statistics, screen-share content, and demo events. These are visual contracts for later integrations, not production data sources.

### Component organization

- `src/renderer/src/App.tsx` — application state, timers, event orchestration, and screen routing.
- `src/renderer/src/components/ui/` — `Icon`, `Shell`.
- `src/renderer/src/components/onboarding/` — entry, first-run introduction, and goal-setup screens.
- `src/renderer/src/components/session/` — break, summary, and session sidebar components.
- `src/renderer/src/components/overlays/` — persistent dock and dock notification UI.
- `src/renderer/src/data/people.ts` — shared prototype participant data and its `Person` type.

New UI should be placed in the closest functional directory and reuse shared primitives and data types where practical. Keep backend calls and cross-screen orchestration above presentational components.

## Demo-only and prototype-only inventory

The items below exist to demonstrate intended product behavior. Future agents must not treat their hardcoded values, local state, or trigger controls as production implementations.

### Entirely demo-only components and controls

#### Demo menu

- The complete Demo menu is a development/test surface.
- Its off-task, check-in, Pomodoro completion, corner-selection, and End session actions simulate system or backend events.
- It must be hidden or removed from production participant builds.

#### Mock shared screen

- The calculus problem shown in the teammate check-in is hardcoded.
- It is not a captured window or screen stream.
- Production screen sharing must use an explicitly selected `desktopCapturer` source and a real media stream.

#### Prototype media tiles

- All initials-based webcam tiles are placeholders.
- The colors, names, join sequence, observer tiles, and staggered timing are hardcoded.
- The animated studying duck is a designed empty-call/reflection state, but its current trigger is simulated.

### Production-intended UI with demo-only data or logic

#### People and focus states

- `src/renderer/src/data/people.ts` contains hardcoded Maya, Jake, and Priya records.
- Their focused/drifting states are fixed prototype data.
- Production records must come from session membership and focus-state services.

#### Session entry and creation

- Create/join call `createSession`/`joinSession` against the DB (`src/renderer/src/db/useDb.ts`); the invite code is generated client-side (`makeInviteCode`) and passed as `code`. Offline (no DB connection) falls back to the local demo flow.
- Host/participant role comes from server membership in a DB session, and from Create/Join choice in the offline flow.

#### Pomodoro synchronization

- In a DB session the clock derives from the server (`components/spacetimedb.md#behavior`); host `set_pomodoro`/`start_session`/`take_break`.
- The local countdown, rounds and long breaks exist only in the offline demo flow.

#### Focus detection

- Camera-on labels, active-app concepts, phone activity, off-task state, and automatic call triggers are represented in the interface only.
- No production focus classifier or sustained two-minute off-task detector is connected.
- The Demo menu currently substitutes for those detector events.

#### Check-in invitations and calls

- Six-second invitations, 30-second countdowns, dragging, joining, leaving, and close-window behavior function in the renderer.
- Participant decisions are not networked between clients.
- The quiet chime is locally generated with `AudioContext`.
- The “people join” and “no one joins” outcomes are selected from the Demo menu rather than calculated from real responses.

#### Participant fatigue signal

- **I'm tired**, **Tired sent**, and the confirmation toast function locally.
- No event is sent to a host or backend.
- Production behavior must implement the `ParticipantFatigueSignal` contract below.

#### Goals and distraction capture

- Goal editing and check-off behavior function locally.
- Distraction capture is stored only in React memory.
- Neither survives reload nor syncs to another client.

#### First-run introduction and preferences

- First-run completion in local storage is functional.
- Check-in corner persistence through the Electron preference bridge is functional.
- Account-level preference synchronization is not implemented.

#### Private summary

- In a DB session, stats come from `my_session_summaries`. Trend text and rhythm chart stay hardcoded; the offline flow is all hardcoded.
- Goal completion counts are derived from current local checkbox state.
- Production statistics must be computed from authoritative session records.

#### Electron desktop behavior

- The Electron shell, preload bridge, permissions, preference file, build configuration, and native window APIs are implemented.
- The dock, notifications and check-in windows render in a separate transparent, click-through, always-on-top Electron window covering the main window's display work area (`src/renderer/src/overlay/OverlayApp.tsx`, loaded as `index.html?overlay=1`). It exists only while the focus screen is showing. The main window keeps the timer, goals, role, Demo menu and modals, and syncs to the overlay through the bridge in `src/renderer/src/overlay/bridge.ts`.
- Remaining integration work: multi-display placement, active-application monitoring, and real screen streams.

### Demo code removal rule

When replacing a demo implementation:

1. Preserve the documented visible states and role restrictions unless product requirements change.
2. Replace hardcoded data at the component boundary rather than embedding backend calls in presentational components.
3. Keep Demo menu triggers available only behind a development flag if they remain useful for testing.
4. Update this section to remove items that have become production-backed.

### Shared application shell

#### Brand

- Displays the WYD!! mark.
- Reloads the application when selected.

#### Step progress

- Appears during entry, introduction, and goal setup.
- Shows the user's position in the three-stage setup flow.
- It is setup progress, not Pomodoro progress.

#### Page shell

- Provides the shared background, navigation, centered content region, and footer.
- Used by entry, introduction, goals, break, and summary pages.
- The focus page uses a separate fixed desktop workspace.

### Page 1: session entry

The opening card has two modes.

#### Join a session

- Accepts an existing session code.
- Requires a non-empty code before continuing.
- Shows a group preview without online/offline or social-presence claims.
- Assigns the current user the **participant** role.
- Passes through the first-run introduction gate before goal setup.

#### Create a session

- Accepts a session name.
- Requires a non-empty name before continuing.
- Displays the generated invite code and a copy-to-clipboard action.
- Carries the custom session name into the focus workspace.
- Assigns the current user the **host** role.
- Passes through the first-run introduction gate before goal setup.

### Page 2: first-run introduction

- Appears only when `wyd:tutorial-complete` is not `"true"`.
- Uses one popup rather than a slide sequence.
- Explains timed focus, tracking controls, and short accountability check-ins.
- **Got it, set my goals** persists completion and opens goal setup.
- Returning users skip this page.
- This is product education, not legal consent. Any required consent flow must be implemented separately.

### Page 3: goal setup

- Requires at least two non-empty goals.
- Supports a third optional goal.
- Shows guidance encouraging specific, achievable tasks.
- Starts the focus workspace after validation.
- In the participant prototype, entering focus also starts a locally simulated synchronized timer.
- In production, goals should be participant-owned session records and the timer must come from authoritative host events.

### Focus session desktop workspace

- Fixed, non-scrolling desktop layout.
- Does not use a website-style top navigation bar.
- Shows session identity and the user's Host/Participant role in the workspace sidebar.
- Uses the persistent dock's Leave action instead of a duplicated page-header action.
- Splits the workspace between Pomodoro/task information and goal/team cards.
- Compacts based on viewport height.
- Electron enforces a `1000 × 700` minimum window size.

#### Shared Pomodoro display

- Shows the current round out of four.
- Shows completed/current round indicators.
- Shows the countdown and circular progress.
- Displays the user's first active goal as the current task.
- Supports 15-, 25-, and 45-minute focus lengths for hosts.
- Completes into a five-minute break after rounds one through three.
- Completes into a 20-minute long break after round four.

#### Host Pomodoro panel

- Visible only after **Create a session**.
- Selects focus duration.
- Starts the shared Pomodoro.
- Pauses or resumes the shared Pomodoro.
- Stops and resets the timer.
- Shows that the host controls synchronized participant timers.
- Exposes the same Start/Pause/Resume and Stop/Reset actions in the dock.
- The Demo menu exposes manual Pomodoro completion only to hosts.

#### Participant Pomodoro panel

- Visible only after **Join a session**.
- Read-only with respect to the shared timer.
- Identifies the session host.
- Shows synchronization state and the focus/break schedule.
- Does not expose duration, start, pause, resume, stop, reset, or manual completion controls.
- Participants can still use personal distraction capture.

#### Focus promise

- Reminds the user to give the selected task uninterrupted attention until the timer rings.
- Informational only; no persistence is currently implemented.

#### Distraction capture

- Accepts a thought or task that comes to mind during focus.
- Saves on the Save action or Enter key.
- Shows a count of locally saved items.
- Currently stored only in React memory and cleared on reload.
- Production storage should be private to the participant unless the product explicitly adds sharing.

#### Goals card

- Lists the participant's active session goals.
- Allows each goal to be checked or unchecked.
- Updates completion counts used by the break and summary screens.

#### Studying-with-you card

- Lists the hardcoded study group.
- Shows focus state only: focused or drifting.
- Does not show online/offline presence.
- Focus state dots must be backed by focus-session signals, not general social availability.

### Break page

- Opens after Pomodoro completion or when a host chooses Take a break.
- Counts down a five-minute short break or 20-minute long break.
- Lets the user review and check off goals.
- Returns to a reset focus timer.
- Clears the participant's tired signal for the next round.

### Private summary page

- Opens from End session, Leave, or the Pomodoro completion modal.
- Shows on-task percentage and focused minutes (real in a DB session, hardcoded offline).
- Shows live goal-completion counts.
- Displays a hardcoded focus-rhythm chart.
- Is explicitly private to the participant.
- **Done** reloads the application.
- Production statistics must be calculated from session records and must distinguish focused, off-task, and break time.

## Persistent focus dock

The dock is a fixed desktop overlay representation. In the browser prototype it remains inside the page; Electron APIs provide native always-on-top and positioning capabilities.

### Reveal and hide behavior

- Hidden by default.
- Reveals when the pointer enters the top 40 pixels of the screen.
- Remains visible while hovered.
- Hides 600 ms after the pointer leaves the top edge and dock.
- Uses one 200 ms slide transition.
- Is pinned open during incoming and active check-ins.

### Shared dock content

- Live Pomodoro countdown and progress ring.
- Current Pomodoro round.
- Personal focus status.
- Teammate avatars with focus-state dots.
- Camera-on disclosure.
- Current-goal checkbox.
- Leave session.

### Host dock controls

- Start or resume the Pomodoro.
- Pause the Pomodoro for everyone.
- Stop and reset the Pomodoro.
- Take a break.
- These actions operate on the same timer as the full host panel.

### Participant dock controls

- No shared-timer controls.
- **I'm tired** sends a fatigue signal without interrupting the Pomodoro.
- Changes to **Tired sent** after activation.
- A toast confirms that the host was notified.

### Leave session

- Available to hosts and participants.
- Stops the local prototype timer.
- Closes incoming and active check-ins.
- Clears pinned dock state.
- Opens the private summary.
- Production host departure requires either room termination or host transfer.

## Notifications below the dock

### Gentle nudge

- Provides a brief reset message when a recent group check-in means another call should not immediately occur.
- Can be dismissed.

### Incoming self check-in

- The off-task user does not receive a warning, toast, or countdown before teammates appear.
- Teammates still receive their six-second opportunity to join.
- The off-task user's dock remains hidden normally during that silent join window.
- When the join window ends, the selected self-check-in scenario opens automatically and pins the dock.
- The off-task user cannot skip the resulting check-in.

### Incoming teammate check-in

- Appears when a teammate is detected off task.
- Shows a six-second countdown.
- Offers **Join** as the only action.
- If the user does nothing, the invitation is automatically skipped.
- Starting this demo first clears any previous invitation, active check-in, countdown, closed-video state, and window position.
- The shared-screen window is never rendered during the invitation phase; it opens only after a valid Join action.

### Tired confirmation

- Confirms that a participant fatigue signal was sent to the host.
- Does not stop or pause the Pomodoro.
- Auto-dismisses after four seconds and can also be dismissed manually.

## Check-in experiences

All active check-ins last 30 seconds. They do not dim or block the desktop, and the dock remains visible for the entire check-in.

### Current user off task: people join

- Available through the Demo menu.
- Teammate video windows appear below the dock.
- Each window occupies 20% of viewport width and 20% of viewport height.
- Participants join in a staggered 650 ms sequence.
- New windows enter from the right and push the row left.
- Each individual video can be closed.
- Closed slots stay fixed so remaining videos do not resize.
- Closing the final teammate video transitions to the duck reflection window for the remaining check-in time.
- A separate 30-second timer appears below the dock.

### Current user off task: no one joins

- Available through the Demo menu.
- Opens a centered draggable glass reflection window.
- Shows an animated duck studying at a desk.
- Displays: “No one is here to keep you accountable. Use this time to reflect on your productivity so far.”
- Includes the remaining time and progress bar.
- Cannot be dismissed by the off-task user.

### Teammate off task

- Requires the current user to select Join within three seconds.
- Opens a centered draggable glass window.
- Shows the off-task teammate's shared screen.
- Shows the off-task teammate's webcam as picture-in-picture.
- Shows the other checking-in teammates as observer video tiles.
- Includes a 30-second countdown and progress bar.
- Provides a visible Leave action that closes the check-in only for the current user.

### Return-to-goal prompt

- Appears after the current user's check-in ends.
- Restates the current goal.
- **Let's go** dismisses the prompt and clears the user's off-task state.

## Pomodoro completion modal

- Opens when the timer reaches zero or the host uses the Demo completion action.
- Reports the completed focus duration.
- Offers End session or the appropriate break.
- Uses a five-minute break normally and a 20-minute break after the fourth round.

## Demo menu

- Triggers current-user off-task with no participants.
- Triggers current-user off-task with participants.
- Triggers teammate off-task.
- Lets users configure the check-in origin corner.
- Lets hosts finish the Pomodoro.
- Ends the session.
- Demo actions simulate backend/system events and should not be exposed as production participant controls.

## Electron desktop surfaces

The Electron shell is defined in `electron/main.cjs` and `electron/preload.cjs`.

- Loads the Vite renderer with context isolation, sandboxing, and Node integration disabled.
- Requests camera and microphone permissions.
- Supports display-capture requests.
- Exposes narrow preload APIs for saved preferences, display discovery, always-on-top, click-through, and moving native windows to a corner.
- Persists the selected check-in corner in Electron preferences.
- Packages macOS, Windows, and Linux builds through Electron Builder.

## First-run introduction

The former privacy/consent screen is now a single product-introduction popup shown before a user starts their first session. It briefly explains timed focus, tracking controls, and group check-ins before goal setup.

## Entry flow

Both opening actions use the same first-run gate:

1. **Join a session** validates that the session code is non-empty.
2. **Create a session** validates that the session name is non-empty.
3. The app reads `localStorage["wyd:tutorial-complete"]`.
4. If the value is `"true"`, the user goes directly to goal setup.
5. Otherwise, the introduction popup opens.

The current implementation lives in `src/App.tsx`:

- `beginSessionSetup()` performs the first-run check.
- `finishTutorial()` persists completion and opens goal setup.

## Popup content

The single popup introduces three core ideas:

1. **Focus with intention** — choose a goal and use Pomodoro rounds with breaks.
2. **Stay aware of your focus** — view the current goal and focus status in the dock.
3. **Get a gentle check-in** — friends can join a short 30-second reset if someone drifts.

The **Got it, set my goals** action marks the introduction complete and advances to goal setup.

## Persistence contract

Key:

```text
wyd:tutorial-complete
```

Completed value:

```text
true
```

To reset the tutorial during development:

```js
localStorage.removeItem('wyd:tutorial-complete')
```

Electron uses the renderer's persistent storage partition, so the same first-run behavior works in packaged desktop builds. Clearing application data causes the tutorial to appear again.

## Future integration hooks

- Replace local storage with an account-level onboarding flag when authentication is added.
- If legal consent is required, keep it separate from tutorial completion and store an explicit consent version and timestamp.
- Analytics may record popup views and completion, but should not include camera, active-app, or phone signal data.

## Pomodoro host permissions

The entry path determines the prototype role:

- **Create a session** makes the current user the host.
- **Join a session** makes the current user a participant.

Hosts see the duration selector and Start, Pause/Resume, Stop, and Finish Pomodoro controls. These actions are intended to publish a shared session-timer event so every participant remains synchronized.

The host also receives a compact control cluster in the overlay dock:

- live shared countdown
- current round out of four
- Start or Resume
- Pause
- Stop and reset

These dock controls invoke the same authoritative timer actions as the full host Pomodoro panel; they are not a separate timer. Participants see the live countdown and round but never receive these control buttons.

Participants see a read-only timer UI identifying the host, the planned focus/break schedule, and synchronization status. They do not receive session start, pause, stop, duration, or manual-completion controls. Personal features such as distraction capture remain available.

For a real multi-user integration, the host is the only client permitted to write timer state. Enforce this in the server/API authorization layer rather than relying only on hidden UI. Participants should subscribe to authoritative timer events containing:

```ts
type PomodoroTimerEvent = {
  sessionId: string
  phase: 'focus' | 'short-break' | 'long-break'
  durationSeconds: number
  remainingSeconds: number
  status: 'ready' | 'running' | 'paused' | 'complete'
  round: 1 | 2 | 3 | 4
  startedAt: string | null
  updatedByHostId: string
}
```

On reconnect, clients should request the latest authoritative timer state and derive remaining time from `startedAt` rather than trusting a locally decremented counter.

### Participant fatigue signal

During an active Pomodoro, participants cannot stop, pause, resume, finish, or start the shared session. Their dock replaces the host's **Take a break** action with a fixed-width **I’m tired** button.

Selecting it:

1. Keeps the shared Pomodoro running.
2. Changes the local control to **Tired sent**.
3. Shows a brief confirmation that the host was notified.
4. Publishes a fatigue signal for the host and other session logic.

The signal should be modeled separately from timer control:

```ts
type ParticipantFatigueSignal = {
  sessionId: string
  participantId: string
  pomodoroRound: 1 | 2 | 3 | 4
  signaledAt: string
  active: boolean
}
```

Only the participant may create or clear their own fatigue signal. The host may read aggregate and individual fatigue state but should not be allowed to fabricate it. Clear active fatigue signals when the shared session enters a break or begins a new focus round.

### Leaving a session from the dock

The overlay dock exposes a persistent **Leave** action to both hosts and participants.

In the current prototype it:

1. Stops the local countdown.
2. Closes any active or incoming check-in.
3. Dismisses completion dialogs.
4. Releases the dock's pinned state.
5. Opens the private session summary.

In production, a participant leave should publish a presence update and remove only that participant from the room. A host leave requires an explicit product policy: either end the room for everyone or transfer host ownership before disconnecting. The backend should make that decision authoritative and idempotent so reconnects or duplicate leave requests cannot corrupt session state.

### Presence is not a social status

The UI intentionally does not show online/offline labels, green availability dots, waiting-user counts, or other social-chat presence indicators. Session membership may be tracked by the backend for synchronization and cleanup, but it should not be presented as social availability.

Dots and labels shown beside teammates represent only focus state—focused, drifting, or off task—and must not be derived from websocket connectivity or general online presence.

### Desktop session framing

The focus-session desktop view is designed as a fixed, non-scrolling workspace. The timer, Pomodoro controls, goals, and teammate focus states resize and compact based on viewport height instead of extending the page.

The Electron window enforces a minimum content size of `1000 × 700` pixels. Integrations should preserve this minimum or introduce an equivalent compact layout before allowing a smaller native window. Modals, check-in windows, and the dock are fixed overlays and must not affect document flow or create page scrollbars.
