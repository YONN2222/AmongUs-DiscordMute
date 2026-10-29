const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i
const HEXTET = /^[0-9a-f]{1,4}$/

// One IPv6 subscriber usually owns a whole /64, so keying by full address would let it rotate freely.
export function limiterKey(ip: string): string {
  if (!ip.includes(':')) return ip
  const address = ip.toLowerCase().split('%')[0] ?? ''
  const mapped = IPV4_MAPPED.exec(address)
  if (mapped?.[1]) return mapped[1]

  const halves = address.split('::')
  if (halves.length > 2) return ip
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves[1] ? halves[1].split(':') : []
  const missing = 8 - head.length - tail.length
  if (missing < 0) return ip
  const groups = halves.length === 2 ? [...head, ...Array<string>(missing).fill('0'), ...tail] : head
  const prefix = groups.slice(0, 4)
  if (prefix.length < 4 || !prefix.every((group) => HEXTET.test(group))) return ip
  return `${prefix.map((group) => Number.parseInt(group, 16).toString(16)).join(':')}::/64`
}
