import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { dueSessions, isVideoName, orderClips, staleVideos, videoName, type DueArgs, type PlanClip } from '../../../worker/compile/plan'

const clip = (id: number, sessionId: number, momentAtMs: number, chunkCount = 2): PlanClip => ({ id: BigInt(id), sessionId: BigInt(sessionId), momentAtMs: BigInt(momentAtMs), chunkCount })

describe('orderClips', () => {
  it('orders by off-task moment, not by upload order', () => {
    const out = orderClips([clip(1, 1, 300), clip(2, 1, 100), clip(3, 1, 200)])
    assert.deepEqual(out.map(c => c.id), [2n, 3n, 1n])
  })

  it('breaks ties by clip id and leaves the input alone', () => {
    const input = [clip(5, 1, 100), clip(4, 1, 100)]
    assert.deepEqual(orderClips(input).map(c => c.id), [4n, 5n])
    assert.deepEqual(input.map(c => c.id), [5n, 4n])
  })
})

describe('dueSessions', () => {
  const base = (over: Partial<DueArgs> = {}): DueArgs => ({
    sessionIds: [1n],
    clips: [clip(10, 1, 100), clip(11, 1, 200)],
    chunksHeld: new Map([[10n, 2], [11n, 2]]),
    lastActivityMs: new Map([[1n, 1_000]]),
    failedAtMs: new Map(),
    rendering: new Set(),
    now: 100_000,
    quietMs: 30_000,
    retryMs: 60_000,
    ...over
  })

  it('renders a session whose clips are all here and that has been quiet', () => {
    assert.deepEqual(dueSessions(base()), [1n])
  })

  it('waits while the session or a clip changed less than quietMs ago (late clips)', () => {
    assert.deepEqual(dueSessions(base({ lastActivityMs: new Map([[1n, 80_000]]) })), [])
    assert.deepEqual(dueSessions(base({ lastActivityMs: new Map([[1n, 70_000]]) })), [1n])
  })

  it('treats a session with no recorded activity as long quiet (worker restart)', () => {
    assert.deepEqual(dueSessions(base({ lastActivityMs: new Map() })), [1n])
  })

  it('waits until every chunk of every clip has arrived', () => {
    assert.deepEqual(dueSessions(base({ chunksHeld: new Map([[10n, 2], [11n, 1]]) })), [])
    assert.deepEqual(dueSessions(base({ chunksHeld: new Map([[10n, 2]]) })), [])
  })

  it('skips sessions without clips and sessions already rendering', () => {
    assert.deepEqual(dueSessions(base({ clips: [] })), [])
    assert.deepEqual(dueSessions(base({ rendering: new Set([1n]) })), [])
  })

  it('backs off after a failure and retries later', () => {
    assert.deepEqual(dueSessions(base({ failedAtMs: new Map([[1n, 90_000]]) })), [])
    assert.deepEqual(dueSessions(base({ failedAtMs: new Map([[1n, 30_000]]) })), [1n])
  })

  it('handles several sessions independently', () => {
    const out = dueSessions(base({
      sessionIds: [1n, 2n],
      clips: [clip(10, 1, 1), clip(20, 2, 1)],
      chunksHeld: new Map([[10n, 2], [20n, 1]])
    }))
    assert.deepEqual(out, [1n])
  })
})

describe('video names', () => {
  it('encodes session and clip count, so a re-render gets a new URL', () => {
    assert.equal(videoName(7n, 3), 'session-7-3.mp4')
    assert.notEqual(videoName(7n, 3), videoName(7n, 4))
  })

  it('accepts only names the compiler writes', () => {
    assert.ok(isVideoName('session-7-3.mp4'))
    for (const bad of ['../session-7-3.mp4', 'session-7-3.mp4.part.mp4', 'session-a-3.mp4', 'session-7-3.mp4/x', 'x.mp4', '', 'session-7-3.webm']) {
      assert.equal(isVideoName(bad), false, bad)
    }
  })

  it('finds older renders of the same session only', () => {
    const files = ['session-7-2.mp4', 'session-7-3.mp4', 'session-70-1.mp4', 'session-8-3.mp4', 'notes.txt']
    assert.deepEqual(staleVideos(files, 7n, 'session-7-3.mp4'), ['session-7-2.mp4'])
  })
})
