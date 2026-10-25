import assert from 'node:assert/strict'
import type { NetworkInterfaceInfo } from 'node:os'
import { describe, it } from 'node:test'
import { lanAddress } from '../../../worker/compile/network'

const v4 = (address: string, internal = false): NetworkInterfaceInfo => ({ address, netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal, cidr: null })
const v6 = (address: string): NetworkInterfaceInfo => ({ address, netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', mac: '00:00:00:00:00:00', internal: false, cidr: null, scopeid: 0 })

describe('lanAddress', () => {
  it('picks the Wi-Fi/Ethernet address', () => {
    assert.equal(lanAddress({ lo0: [v4('127.0.0.1', true)], en0: [v4('192.168.1.20')] }), '192.168.1.20')
  })

  it('prefers en0 over a VPN tunnel, whatever the order', () => {
    assert.equal(lanAddress({ utun4: [v4('10.136.128.7')], en0: [v4('192.168.1.20')] }), '192.168.1.20')
    assert.equal(lanAddress({ en0: [v4('192.168.1.20')], utun4: [v4('10.136.128.7')] }), '192.168.1.20')
  })

  it('prefers a real interface over virtual ones (docker, bridge) even if it is not en*', () => {
    assert.equal(lanAddress({ bridge100: [v4('192.168.64.1')], eth0: [v4('172.16.0.5')] }), '172.16.0.5')
  })

  it('falls back to a tunnel when nothing else exists', () => {
    assert.equal(lanAddress({ lo0: [v4('127.0.0.1', true)], utun4: [v4('10.136.128.7')] }), '10.136.128.7')
  })

  it('ignores loopback, IPv6 and link-local (169.254) addresses', () => {
    assert.equal(lanAddress({ lo0: [v4('127.0.0.1', true)], en0: [v6('fe80::1'), v4('169.254.10.3')], en1: [v4('192.168.1.9')] }), '192.168.1.9')
  })

  it('returns undefined when there is no network', () => {
    assert.equal(lanAddress({ lo0: [v4('127.0.0.1', true)] }), undefined)
    assert.equal(lanAddress({}), undefined)
  })

  it('uses en0 before en1', () => {
    assert.equal(lanAddress({ en1: [v4('10.0.0.2')], en0: [v4('10.0.0.1')] }), '10.0.0.1')
  })
})
