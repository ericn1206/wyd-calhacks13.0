import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { clipInfo, type DbSnapshot } from '../../../src/renderer/src/db/useDb'

const tables = (over: Partial<DbSnapshot['tables']> = {}): DbSnapshot['tables'] => ({
  sessions: [], members: [], goals: [], statuses: [], contexts: [], scores: [], calls: [], callParticipants: [], alerts: [], summaries: [], awards: [], compilations: [], settings: [], users: [],
  ...over
})
const base = (url: string) => ({ key: 'clip_page_base_url', valueJson: JSON.stringify(url) })
const comp = (sessionId: number, status: string) => ({ sessionId, status: { tag: status }, clipCount: 2, url: 'x' })

describe('summary screen clip link (clipInfo)', () => {
  it('has no link until the compiler has published its address', () => {
    assert.deepEqual(clipInfo(tables(), 45), { clipLink: null, clipState: 'waiting' })
  })

  it('builds <base>/session/<id> from the app setting, before any compilation exists', () => {
    const t = tables({ settings: [base('http://192.168.1.20:8787')] })
    assert.deepEqual(clipInfo(t, 45), { clipLink: 'http://192.168.1.20:8787/session/45', clipState: 'waiting' })
  })

  it("follows the compiler's state for this session only", () => {
    const settings = [base('http://h:1')]
    assert.equal(clipInfo(tables({ settings, compilations: [comp(45, 'Rendering')] }), 45).clipState, 'rendering')
    assert.equal(clipInfo(tables({ settings, compilations: [comp(45, 'Ready')] }), 45).clipState, 'ready')
    assert.equal(clipInfo(tables({ settings, compilations: [comp(45, 'Failed')] }), 45).clipState, 'failed')
    assert.equal(clipInfo(tables({ settings, compilations: [comp(46, 'Ready')] }), 45).clipState, 'waiting')
  })

  it('ignores unrelated settings, an empty address and unreadable values', () => {
    assert.equal(clipInfo(tables({ settings: [{ key: 'call_cooldown_secs', valueJson: '600' }] }), 1).clipLink, null)
    assert.equal(clipInfo(tables({ settings: [base('')] }), 1).clipLink, null)
    assert.equal(clipInfo(tables({ settings: [{ key: 'clip_page_base_url', valueJson: '{not json' }] }), 1).clipLink, null)
    assert.equal(clipInfo(tables({ settings: [{ key: 'clip_page_base_url', valueJson: '42' }] }), 1).clipLink, null)
  })
})
