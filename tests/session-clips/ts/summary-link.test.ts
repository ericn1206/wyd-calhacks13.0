import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { clipInfo, type DbSnapshot } from '../../../src/renderer/src/db/useDb'

const tables = (over: Partial<DbSnapshot['tables']> = {}): DbSnapshot['tables'] => ({
  sessions: [], members: [], goals: [], statuses: [], contexts: [], scores: [], calls: [], callParticipants: [], alerts: [], summaries: [], awards: [], compilations: [], settings: [], users: [],
  ...over
})
const base = (url: string) => ({ key: 'clip_page_base_url', valueJson: JSON.stringify(url) })
const comp = (sessionId: number, status: string, url: string | null = '/compilations/session-45-2.mp4') => ({ sessionId, status: { tag: status }, clipCount: 2, url })

describe('summary screen clip link (clipInfo)', () => {
  it('builds the video address from the current base plus the stored path, so a changed address never stales it', () => {
    const row = comp(45, 'Ready')
    assert.equal(clipInfo(tables({ settings: [base('http://192.168.1.20:8787')], compilations: [row] }), 45).clipVideo, 'http://192.168.1.20:8787/compilations/session-45-2.mp4')
    assert.equal(clipInfo(tables({ settings: [base('http://10.0.0.7:8787')], compilations: [row] }), 45).clipVideo, 'http://10.0.0.7:8787/compilations/session-45-2.mp4')
  })

  it('keeps a full address written by an older compiler, gives none before Ready or without a base', () => {
    assert.equal(clipInfo(tables({ settings: [base('http://new:1')], compilations: [comp(45, 'Ready', 'http://old-host:8787/compilations/session-45-2.mp4')] }), 45).clipVideo, 'http://old-host:8787/compilations/session-45-2.mp4')
    assert.equal(clipInfo(tables({ settings: [base('http://h:1')], compilations: [comp(45, 'Rendering')] }), 45).clipVideo, null)
    assert.equal(clipInfo(tables({ compilations: [comp(45, 'Ready')] }), 45).clipVideo, null)
    assert.equal(clipInfo(tables({ settings: [base('http://h:1')], compilations: [comp(45, 'Ready', null)] }), 45).clipVideo, null)
  })

  it('has no link until the compiler has published its address', () => {
    assert.deepEqual(clipInfo(tables(), 45), { clipLink: null, clipState: 'waiting', clipVideo: null })
  })

  it('builds <base>/session/<id> from the app setting, before any compilation exists', () => {
    const t = tables({ settings: [base('http://192.168.1.20:8787')] })
    assert.deepEqual(clipInfo(t, 45), { clipLink: 'http://192.168.1.20:8787/session/45', clipState: 'waiting', clipVideo: null })
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
