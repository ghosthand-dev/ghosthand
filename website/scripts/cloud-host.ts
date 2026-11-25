// Manages the Macs that run cloud iPhones, through the admin routes (src/cloud/admin.ts).
//
//   source <(ghosthand tunnel url --new-token)   # GHOSTHAND_URL, GHOSTHAND_TOKEN (your API key)
//   bun scripts/cloud-host.ts list
//   bun scripts/cloud-host.ts add mint --address 10.77.0.1:7400 --slots 4
//   bun scripts/cloud-host.ts drain mint      # no new starts there
//   bun scripts/cloud-host.ts enable mint
//   bun scripts/cloud-host.ts remove mint     # refused while it runs or holds a phone
//   bun scripts/cloud-host.ts recover cph_... # its host is gone: restart from R2
//   bun scripts/cloud-host.ts phones          # every phone's state, host and versions
//
// GHOSTHAND_TOKEN is the operator's normal API key; the route checks the user is in CLOUD_ADMINS.
// The origin of GHOSTHAND_URL picks the site (default https://ghosthand.dev; the preview fleet
// is https://preview.ghosthand.dev). Each site manages only the hosts of its own environment.
import { parseArgs } from 'node:util'

const REQUEST_TIMEOUT_MS = 30_000
const USAGE = 'usage: bun scripts/cloud-host.ts list | add <slug> --address <ip:port> --slots <n> | drain <slug> | enable <slug> | remove <slug> | recover <phone> | phones'

type HostStatus = 'active' | 'draining'
type HostView = { slug: string; address: string; slots: number; status: HostStatus; online: boolean; lastSeenAt: number | null; running: number; cached: number }

const { values, positionals } = parseArgs({
  options: { address: { type: 'string' }, slots: { type: 'string' } },
  allowPositionals: true,
})
const [command, target] = positionals
// The tunnel URL is https://ghosthand.dev/macs/<mac>: only its origin matters here.
const site = new URL(process.env.GHOSTHAND_URL ?? 'https://ghosthand.dev').origin
const token = process.env.GHOSTHAND_TOKEN
if (!token || !command) {
  console.error(token ? USAGE : 'GHOSTHAND_TOKEN is missing: run `source <(ghosthand tunnel url --new-token)` first')
  process.exit(1)
}

async function call<T>(method: string, path: string, body?: object): Promise<T> {
  console.log(`${method} ${site}/api/cloud-admin${path}`)
  const response = await fetch(`${site}/api/cloud-admin${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const text = await response.text()
  if (!response.ok) {
    console.error(`failed: ${response.status} ${text}`)
    process.exit(1)
  }
  return JSON.parse(text) as T
}

function printHosts(hosts: HostView[]): void {
  if (!hosts.length) return console.log('no hosts')
  for (const h of hosts) {
    const seen = h.lastSeenAt ? new Date(h.lastSeenAt).toISOString() : 'never'
    console.log(`${h.slug}  ${h.address}  ${h.running}/${h.slots} running, ${h.cached} cached  ${h.online ? 'online' : 'offline'}${h.status === 'draining' ? '  [draining]' : ''}  last seen ${seen}`)
  }
}

async function setStatus(slug: string, status: HostStatus): Promise<void> {
  const { hosts } = await call<{ hosts: HostView[] }>('GET', '/hosts')
  const host = hosts.find((h) => h.slug === slug)
  if (!host) {
    console.error(`no host ${slug}; hosts: ${hosts.map((h) => h.slug).join(', ') || 'none'}`)
    process.exit(1)
  }
  printHosts((await call<{ hosts: HostView[] }>('PUT', `/hosts/${slug}`, { address: host.address, slots: host.slots, status })).hosts)
}

switch (command) {
  case 'list':
    printHosts((await call<{ hosts: HostView[] }>('GET', '/hosts')).hosts)
    break
  case 'add': {
    const slots = Number(values.slots)
    if (!target || !values.address || !Number.isInteger(slots)) {
      console.error(USAGE)
      process.exit(1)
    }
    printHosts((await call<{ hosts: HostView[] }>('PUT', `/hosts/${target}`, { address: values.address, slots, status: 'active' })).hosts)
    break
  }
  case 'drain':
  case 'enable':
    if (!target) {
      console.error(USAGE)
      process.exit(1)
    }
    await setStatus(target, command === 'enable' ? 'active' : 'draining')
    break
  case 'remove':
    if (!target) {
      console.error(USAGE)
      process.exit(1)
    }
    await call('DELETE', `/hosts/${target}`)
    console.log(`removed ${target}`)
    break
  case 'recover': {
    if (!target) {
      console.error(USAGE)
      process.exit(1)
    }
    const { version } = await call<{ version: number }>('POST', `/phones/${target}/recover`)
    console.log(`${target} restarts from its R2 version ${version} on its next acquire`)
    break
  }
  case 'phones':
    console.log(JSON.stringify(await call('GET', '/phones'), null, 2))
    break
  default:
    console.error(USAGE)
    process.exit(1)
}
