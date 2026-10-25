import { videoName } from './plan.ts'

/** What the worker knows about a session's compilation. `waiting` = nothing yet (session still running, or no clips). */
export type CompileState =
  | { state: 'waiting' }
  | { state: 'rendering' }
  | { state: 'ready'; clipCount: number }
  | { state: 'failed'; error: string }

export type StatusLookup = (sessionId: bigint) => CompileState

/** JSON the page polls. `video` is a path on this server. */
export function statusJson(sessionId: bigint, s: CompileState) {
  return s.state === 'ready'
    ? { state: s.state, clipCount: s.clipCount, video: `/compilations/${videoName(sessionId, s.clipCount)}` }
    : s.state === 'failed'
      ? { state: s.state, error: s.error }
      : { state: s.state }
}

/**
 * The shareable link for a session: shows progress and switches to the video by itself when it is ready.
 * Static HTML: the session id is the only thing interpolated, and it is digits (checked by the route).
 */
export function sessionPage(sessionId: bigint): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Session highlights</title>
<style>
  :root { --bg: #f6f6f8; --fg: #1c1c22; --muted: #62626e; --card: #fff; --accent: #5b6cf0; }
  @media (prefers-color-scheme: dark) { :root { --bg: #14141a; --fg: #ececf1; --muted: #9a9aa8; --card: #1e1e26; --accent: #8c98ff; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, -apple-system, sans-serif; }
  main { width: 100%; max-width: 560px; background: var(--card); border-radius: 16px; padding: 24px; box-shadow: 0 2px 16px rgba(0,0,0,.12); }
  h1 { margin: 0 0 4px; font-size: 20px; }
  p { margin: 0 0 16px; color: var(--muted); }
  video { width: 100%; border-radius: 10px; background: #000; display: none; }
  .spin { width: 28px; height: 28px; border: 3px solid var(--muted); border-top-color: var(--accent); border-radius: 50%; animation: s 0.9s linear infinite; margin-bottom: 12px; }
  @keyframes s { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
  a { color: var(--accent); }
</style>
</head>
<body>
<main>
  <div class="spin" id="spin" aria-hidden="true"></div>
  <h1 id="title">Session highlights</h1>
  <p id="msg" role="status">Checking…</p>
  <video id="video" controls playsinline></video>
  <p id="dl" hidden><a id="link" download>Download</a></p>
</main>
<script>
  var id = ${JSON.stringify(sessionId.toString())};
  var el = function (n) { return document.getElementById(n); };
  var shown = '';
  function show(s) {
    if (s.state === 'ready') {
      el('spin').style.display = 'none';
      el('title').textContent = 'Your session highlights';
      el('msg').textContent = s.clipCount + (s.clipCount === 1 ? ' moment' : ' moments') + ' from the session.';
      if (shown !== s.video) {
        shown = s.video;
        el('video').src = s.video;
        el('video').style.display = 'block';
        el('link').href = s.video;
        el('dl').hidden = false;
      }
      return;
    }
    el('video').style.display = 'none';
    el('dl').hidden = true;
    el('spin').style.display = 'block';
    el('msg').textContent =
      s.state === 'rendering' ? 'Putting your clips together…'
      : s.state === 'failed' ? 'Could not build the video yet (' + s.error + '). Trying again soon.'
      : 'Waiting for the session to end. This page updates by itself.';
  }
  function poll() {
    fetch('/session/' + id + '/status', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(show)
      .catch(function () { el('msg').textContent = 'Cannot reach the video server. Retrying…'; })
      .then(function () { setTimeout(poll, 3000); });
  }
  poll();
</script>
</body>
</html>
`
}
