import { describe, expect, it } from 'vitest'
import { limiterKey } from '../../server/telemetry/client-key'

describe('limiterKey', () => {
  it('keeps IPv4 addresses unchanged', () => {
    expect(limiterKey('203.0.113.7')).toBe('203.0.113.7')
  })

  it('reduces IPv6 addresses to their /64 prefix', () => {
    expect(limiterKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64')
    expect(limiterKey('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64')
  })

  it('maps every address of one /64 to the same key', () => {
    expect(limiterKey('2001:0DB8:0001:0002:0:0:0:1')).toBe(limiterKey('2001:db8:1:2:ffff::'))
  })

  it('keeps different /64 prefixes apart', () => {
    expect(limiterKey('2001:db8:1:2::1')).not.toBe(limiterKey('2001:db8:1:3::1'))
  })

  it('expands compressed prefixes', () => {
    expect(limiterKey('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(limiterKey('::1')).toBe('0:0:0:0::/64')
    expect(limiterKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64')
  })

  it('treats IPv4-mapped IPv6 as IPv4', () => {
    expect(limiterKey('::ffff:203.0.113.7')).toBe('203.0.113.7')
  })

  it('passes unparseable values through', () => {
    expect(limiterKey('unknown')).toBe('unknown')
    expect(limiterKey('1::2::3')).toBe('1::2::3')
  })
})
