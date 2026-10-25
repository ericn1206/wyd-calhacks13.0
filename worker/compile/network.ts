import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os'

/** Interface names that are not the real network: VPN tunnels, bridges, virtual machines, peer-to-peer. */
const VIRTUAL = /^(utun|ppp|tun|tap|ipsec|gif|stf|awdl|llw|bridge|vmnet|vboxnet|docker|veth|lo)/

/**
 * This laptop's address on the local network, for links teammates can open. Wi-Fi/Ethernet (en0, en1, ...) wins over
 * anything else; VPN tunnels and virtual interfaces are used only if nothing else exists. Undefined = no network.
 */
export function lanAddress(interfaces: Record<string, NetworkInterfaceInfo[] | undefined> = networkInterfaces()): string | undefined {
  const rank = (name: string) => (/^en\d+$/.test(name) ? 0 : VIRTUAL.test(name) ? 2 : 1)
  const found = Object.entries(interfaces)
    .flatMap(([name, list]) => (list ?? []).filter(i => i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')).map(i => ({ name, address: i.address })))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
  return found[0]?.address
}
