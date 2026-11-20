// Private, loopback and link-local addresses (same rules as packages/browser/src/address.ts; the proxy runs in its
// own container and has no dependencies, so the few lines are kept here as well).
import { isIP } from "node:net"

const V4_PRIVATE: readonly [number, number][] = [
  [0x00000000, 8], // 0.0.0.0/8
  [0x0a000000, 8], // 10.0.0.0/8
  [0x64400000, 10], // 100.64.0.0/10 (carrier-grade NAT)
  [0x7f000000, 8], // 127.0.0.0/8
  [0xa9fe0000, 16], // 169.254.0.0/16 (link-local, cloud metadata)
  [0xac100000, 12], // 172.16.0.0/12
  [0xc0a80000, 16], // 192.168.0.0/16
]

function v4(ip: string): number {
  return ip.split(".").reduce((n, part) => (n << 8) + Number(part), 0) >>> 0
}

/** True for loopback, private, link-local, carrier-grade NAT and unspecified addresses (IPv4 and IPv6). */
export function isPrivateAddress(raw: string): boolean {
  const ip = raw.replace(/^\[|\]$/g, "").toLowerCase()
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip)
  if (mapped) return isPrivateAddress(mapped[1]!)
  if (isIP(ip) === 4) return V4_PRIVATE.some(([net, bits]) => (v4(ip) & (bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0)) >>> 0 === net)
  if (isIP(ip) === 6) return ip === "::" || ip === "::1" || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip)
  return false
}

