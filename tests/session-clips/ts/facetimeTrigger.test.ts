import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { requestClip, stopFacetimeTrigger } from '../../../src/main/facetimeTrigger'

describe('requestClip', () => {
  it('returns false when tracking is off (no detector process)', () => {
    stopFacetimeTrigger()
    assert.equal(requestClip('/tmp/never-written.mp4'), false)
  })
})
