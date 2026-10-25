import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { groupClips, JOINER_KEY_PREFIX, MAX_JOINERS_PER_CLIP, type JoinPlanClip } from '../../../worker/compile/plan'
import { JOINER_KEY_PREFIX as UPLOAD_PREFIX } from '../../../src/main/clipUpload'

let nextId = 1n
/** A clip of `member`, first frame `startS` seconds after t0, `secs` long. */
function clip(member: number, startS: number, secs: number, joiner = false): JoinPlanClip {
  const id = nextId++
  return {
    id,
    sessionId: 1n,
    clipKey: `${joiner ? JOINER_KEY_PREFIX : ''}key-${id}`,
    memberId: BigInt(member),
    momentAtMs: BigInt((startS + (joiner ? 0 : 10)) * 1000),
    startedAtMs: BigInt(startS * 1000),
    durationMs: secs * 1000,
    chunkCount: 1
  }
}

describe('groupClips', () => {
  it('the uploader and the compiler agree on the key prefix', () => {
    assert.equal(UPLOAD_PREFIX, JOINER_KEY_PREFIX)
  })

  it('without joiner clips it is exactly the old order: by moment, then id', () => {
    const late = clip(1, 100, 30)
    const early = clip(2, 0, 30)
    const { groups, orphans } = groupClips([late, early])
    assert.deepEqual(groups.map(g => g.base.id), [early.id, late.id])
    assert.deepEqual(groups.map(g => g.joiners), [[], []])
    assert.deepEqual(orphans, [])
  })

  it('attaches a teammate who joined to the check-in it overlaps', () => {
    const drifter = clip(1, 0, 30)
    const joiner = clip(2, 13, 20, true) // joined 3 s after the moment (moment = 10 s)
    const { groups, orphans } = groupClips([joiner, drifter])
    assert.equal(groups.length, 1)
    assert.deepEqual(groups[0].joiners.map(c => c.id), [joiner.id])
    assert.deepEqual(orphans, [])
  })

  it('picks the check-in with the longest overlap when there are several', () => {
    const first = clip(1, 0, 30)
    const second = clip(3, 200, 30)
    const joiner = clip(2, 205, 20, true)
    const { groups } = groupClips([first, second, joiner])
    assert.deepEqual(groups.map(g => g.joiners.length), [0, 1])
  })

  it('never attaches a clip to its own member\'s check-in', () => {
    const drifter = clip(1, 0, 30)
    const own = clip(1, 13, 20, true)
    const { groups, orphans } = groupClips([drifter, own])
    assert.deepEqual(groups[0].joiners, [])
    assert.deepEqual(orphans.map(c => c.id), [own.id])
  })

  it('leaves out a joiner clip that barely touches the check-in or belongs to none', () => {
    const drifter = clip(1, 0, 30)
    const barely = clip(2, 28, 20, true) // 2 s of overlap, under the 3 s minimum
    const elsewhere = clip(3, 500, 20, true)
    const { groups, orphans } = groupClips([drifter, barely, elsewhere])
    assert.deepEqual(groups[0].joiners, [])
    assert.deepEqual(orphans.map(c => c.id).sort(), [barely.id, elsewhere.id].sort())
  })

  it('a session with only teammate clips has nothing to show', () => {
    const only = clip(2, 0, 20, true)
    const { groups, orphans } = groupClips([only])
    assert.deepEqual(groups, [])
    assert.deepEqual(orphans, [only])
  })

  it('keeps the strongest overlaps when more teammates joined than fit, the rest are orphans', () => {
    const drifter = clip(1, 0, 30)
    const joiners = Array.from({ length: MAX_JOINERS_PER_CLIP + 1 }, (_, i) => clip(10 + i, 10 + i, 20, true))
    const { groups, orphans } = groupClips([drifter, ...joiners])
    assert.equal(groups[0].joiners.length, MAX_JOINERS_PER_CLIP)
    assert.equal(orphans.length, 1)
    assert.equal(orphans[0].id, joiners.at(-1)!.id) // joined last, shortest overlap
  })

  it('counts every clip once: bases + attached + orphans = all clips', () => {
    const clips = [clip(1, 0, 30), clip(2, 12, 20, true), clip(3, 600, 20, true), clip(4, 300, 30)]
    const { groups, orphans } = groupClips(clips)
    assert.equal(groups.length + groups.reduce((n, g) => n + g.joiners.length, 0) + orphans.length, clips.length)
  })
})
