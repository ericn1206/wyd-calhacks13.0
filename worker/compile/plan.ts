// Pure decisions for the clip compiler (no I/O): which ended session to render now, in what order, under what file name.

export interface PlanClip {
  id: bigint
  sessionId: bigint
  momentAtMs: bigint
  chunkCount: number
}

/** Chronological: by the off-task moment, ties by clip id. */
export function orderClips<T extends PlanClip>(clips: readonly T[]): T[] {
  return [...clips].sort((a, b) => (a.momentAtMs < b.momentAtMs ? -1 : a.momentAtMs > b.momentAtMs ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export interface DueArgs {
  /** Ended sessions that still need a compilation (worker_ended_sessions). */
  sessionIds: readonly bigint[]
  clips: readonly PlanClip[]
  /** Chunks of each clip the worker holds so far. */
  chunksHeld: ReadonlyMap<bigint, number>
  /** Local time of the last change seen for a session (session ended, clip added); missing = long ago. */
  lastActivityMs: ReadonlyMap<bigint, number>
  /** Local time a render of the session last failed. */
  failedAtMs: ReadonlyMap<bigint, number>
  rendering: ReadonlySet<bigint>
  now: number
  /** Wait this long after the last change: clips triggered in the last 20 s of a session finish uploading after it ended. */
  quietMs: number
  retryMs: number
}

/** Sessions to render now: every clip fully received, nothing new for `quietMs`, not rendering, not failed recently. */
export function dueSessions(a: DueArgs): bigint[] {
  return a.sessionIds.filter(id => {
    const clips = a.clips.filter(c => c.sessionId === id)
    if (clips.length === 0 || a.rendering.has(id)) return false
    if (!clips.every(c => (a.chunksHeld.get(c.id) ?? 0) >= c.chunkCount)) return false
    if (a.now - (a.lastActivityMs.get(id) ?? 0) < a.quietMs) return false
    const failed = a.failedAtMs.get(id)
    return failed === undefined || a.now - failed >= a.retryMs
  })
}

export interface CompilationRow {
  sessionId: bigint
  status: string
  clipCount: number
}

/**
 * Sessions the database calls Ready whose video file is not in this compiler's folder (it was moved to another
 * machine, the folder was wiped, ...): they need rendering again.
 */
export function missingVideos(rows: readonly CompilationRow[], exists: (fileName: string) => boolean): bigint[] {
  return rows.filter(r => r.status === 'Ready' && r.clipCount > 0 && !exists(videoName(r.sessionId, r.clipCount))).map(r => r.sessionId)
}

/** File name of a session's video; the clip count in the name makes a re-render (late clip) a new URL. */
export const videoName = (sessionId: bigint, clipCount: number) => `session-${sessionId}-${clipCount}.mp4`

export const isVideoName = (name: string) => /^session-\d+-\d+\.mp4$/.test(name)

/** Other videos of the same session (older renders), to delete once a newer one is Ready. */
export const staleVideos = (files: readonly string[], sessionId: bigint, keep: string) =>
  files.filter(f => isVideoName(f) && f !== keep && f.startsWith(`session-${sessionId}-`))

/** `clip_key` prefix of a teammate's webcam-only clip (written by `src/main/clipUpload.ts`); duplicated because that file imports electron. */
export const JOINER_KEY_PREFIX = 'join-'
/** A joiner clip must overlap the drifter's clip at least this long to be attached to it. */
export const MIN_JOIN_OVERLAP_MS = 3000
/** Insets that fit along the bottom-left of the frame without touching the drifter's own inset. */
export const MAX_JOINERS_PER_CLIP = 4

export interface JoinPlanClip extends PlanClip {
  clipKey: string
  memberId: bigint
  startedAtMs: bigint
  durationMs: number
}

export interface ClipGroup<T> {
  /** The drifter's clip: one segment of the video. */
  base: T
  /** Teammates who joined that check-in, strongest overlap first. */
  joiners: T[]
}

const overlapMs = (a: JoinPlanClip, b: JoinPlanClip): number => {
  const start = a.startedAtMs > b.startedAtMs ? a.startedAtMs : b.startedAtMs
  const aEnd = a.startedAtMs + BigInt(a.durationMs)
  const bEnd = b.startedAtMs + BigInt(b.durationMs)
  return Number((aEnd < bEnd ? aEnd : bEnd) - start)
}

/**
 * Segments of the video: every clip without the `join-` key prefix, in `orderClips` order, each with the joiner
 * clips (other members) that overlap it most. A joiner clip with no drifter clip to attach to (overlap under
 * `MIN_JOIN_OVERLAP_MS`, same member, or beyond `MAX_JOINERS_PER_CLIP`) is an orphan and is left out.
 */
export function groupClips<T extends JoinPlanClip>(clips: readonly T[]): { groups: ClipGroup<T>[]; orphans: T[] } {
  const isJoiner = (c: T) => c.clipKey.startsWith(JOINER_KEY_PREFIX)
  const groups: ClipGroup<T>[] = orderClips(clips.filter(c => !isJoiner(c))).map(base => ({ base, joiners: [] }))
  const scored = new Map<ClipGroup<T>, { clip: T; overlap: number }[]>(groups.map(g => [g, []]))
  const orphans: T[] = []
  for (const joiner of orderClips(clips.filter(isJoiner))) {
    let best: { group: ClipGroup<T>; overlap: number } | undefined
    for (const group of groups) {
      if (group.base.memberId === joiner.memberId) continue
      const overlap = overlapMs(group.base, joiner)
      if (overlap >= MIN_JOIN_OVERLAP_MS && (!best || overlap > best.overlap)) best = { group, overlap }
    }
    if (best) scored.get(best.group)!.push({ clip: joiner, overlap: best.overlap })
    else orphans.push(joiner)
  }
  for (const group of groups) {
    const list = scored.get(group)!.sort((a, b) => b.overlap - a.overlap)
    group.joiners = list.slice(0, MAX_JOINERS_PER_CLIP).map(x => x.clip)
    orphans.push(...list.slice(MAX_JOINERS_PER_CLIP).map(x => x.clip))
  }
  return { groups, orphans }
}
