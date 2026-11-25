// /admin/fleet: every host of this environment with its slots as a memory map, the problems,
// contention, recent leases and customers. Server-rendered from loadFleetView() (cloud/admin.ts),
// the same value GET /api/cloud-admin/view returns. Design: docs/cloud-fleet-admin-mockup.html.

import type { CSSProperties, ReactNode } from 'react'
import { Head, Link } from 'spiceflow/react'
import {
  DEFAULT_RESERVE_BYTES, DEFAULT_VM_MEMORY_BYTES, ORG_COLORS, formatDisk, formatDuration, formatGiB, shortPhoneId, toGiB,
  type FleetHost, type FleetPhone, type FleetProblem, type FleetView, type LeaseEvent,
} from '../cloud/admin-view.ts'
import { cn } from '../lib/utils.ts'
import { RefreshButton } from './account-client.tsx'

const SECOND_MS = 1_000
/** Width of one 2 GiB slot cell in the memory map. */
const CELL_PX = 14
const CELL_GAP_PX = 3
/** Memory bar turns amber above this share of RAM. */
const MEMORY_WARN_SHARE = 0.9
const HOST_COLUMNS = 'grid-cols-[210px_1fr_112px_86px_64px_72px_84px_52px]'
const LABEL = 'text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground'

type Fleet = FleetView & { ok: boolean; problems: FleetProblem[] }

const orgStyle = (color: number): CSSProperties => ({ backgroundColor: ORG_COLORS[color] })

export function FleetPage({ fleet }: { fleet: Fleet }) {
  const loadedAt = new Date(fleet.at).toISOString().slice(11, 19)
  return (
    <div className='min-h-screen bg-background text-[13px] text-foreground antialiased'>
      <Head>
        <Head.Title>Cloud fleet</Head.Title>
        <Head.Meta name='robots' content='noindex' />
      </Head>
      <nav className='border-b border-border'>
        <div className='mx-auto flex h-12 max-w-[1360px] items-center gap-3 px-8'>
          <Link href='/dashboard' className='font-semibold tracking-tight'>ghosthand</Link>
          <span className='text-muted-foreground/50'>/</span>
          <span className='text-muted-foreground'>Admin</span>
          <span className='text-muted-foreground/50'>/</span>
          <span className='font-medium'>Cloud fleet</span>
          <span className='rounded border border-border px-1.5 font-mono text-[10.5px] text-muted-foreground'>{fleet.environment}</span>
          <div className='ml-auto flex items-center gap-3 text-xs text-muted-foreground'>
            <span className='flex items-center gap-1.5'>
              <span className={cn('size-1.5 rounded-full', fleet.ok ? 'bg-emerald-500' : 'bg-amber-500')} />
              Live status at {loadedAt} UTC
            </span>
            <RefreshButton />
          </div>
        </div>
      </nav>

      <main className='mx-auto flex max-w-[1360px] flex-col gap-7 px-8 py-7'>
        <Totals fleet={fleet} />
        <Problems problems={fleet.problems} />
        <Hosts fleet={fleet} />
        <section className='grid grid-cols-3 gap-6'>
          <Panel title='Contention'><Contention fleet={fleet} /></Panel>
          <Panel title='Recent leases'><RecentLeases events={fleet.leases} at={fleet.at} /></Panel>
          <Panel title='Customers'><Customers fleet={fleet} /></Panel>
        </section>
      </main>
    </div>
  )
}

function Totals({ fleet }: { fleet: Fleet }) {
  const { totals, problems } = fleet
  const critical = problems.some((p) => p.severity === 'critical')
  const cell = (label: string, value: ReactNode) => (
    <div className='px-5 py-3.5'>
      <p className={LABEL}>{label}</p>
      <p className='mt-1 text-xl font-medium tracking-tight tabular-nums'>{value}</p>
    </div>
  )
  return (
    <section className='grid grid-cols-6 divide-x divide-border rounded-lg border border-border'>
      <div className='px-5 py-3.5'>
        <p className={LABEL}>Status</p>
        <p className='mt-1 flex items-center gap-2 text-[15px] font-medium'>
          <span className={cn('size-2 rounded-full', !problems.length && 'bg-emerald-500', critical && 'bg-red-500', problems.length && !critical && 'bg-amber-500')} />
          {problems.length ? `${problems.length} ${problems.length === 1 ? 'problem' : 'problems'}` : 'All good'}
        </p>
      </div>
      {cell('Slots in use', <>{totals.used}<span className='text-muted-foreground'> / {totals.slots}</span></>)}
      {cell('Leased', totals.leased)}
      {cell('In transition', totals.transitions)}
      {cell('Hosts online', <>{totals.online}<span className='text-muted-foreground'> / {totals.hosts}</span></>)}
      {cell('Phones sold', totals.sold)}
    </section>
  )
}

function Problems({ problems }: { problems: FleetProblem[] }) {
  return (
    <section className='flex flex-col gap-2.5'>
      <div className='flex items-baseline justify-between'>
        <h2 className='text-[15px] font-semibold tracking-tight text-pretty'>Problems</h2>
        <span className='font-mono text-[11px] text-muted-foreground'>same list at GET /api/cloud-admin/view → problems[]</span>
      </div>
      <div className='divide-y divide-border rounded-lg border border-border text-xs'>
        {problems.length ? problems.map((problem, i) => (
          <div key={i} className='grid grid-cols-[72px_170px_1fr] items-center gap-3 px-4 py-2'>
            <span
              className={cn(
                'w-fit rounded border px-1.5 font-mono text-[10px]',
                problem.severity === 'critical' ? 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400' : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
              )}
            >
              {problem.severity}
            </span>
            <span className='font-mono text-[11px] text-muted-foreground'>{problem.code}</span>
            <span>{problem.detail}</span>
          </div>
        )) : <p className='px-4 py-2 text-muted-foreground'>No problems.</p>}
      </div>
    </section>
  )
}

function Hosts({ fleet }: { fleet: Fleet }) {
  const legend = (swatch: ReactNode, label: string) => <span className='flex items-center gap-1.5'>{swatch}{label}</span>
  return (
    <section className='flex flex-col gap-2.5'>
      <div className='flex items-baseline justify-between'>
        <h2 className='text-[15px] font-semibold tracking-tight text-pretty'>Hosts</h2>
        <div className='flex items-center gap-4 text-[11px] text-muted-foreground'>
          {legend(<span className='fleet-reserve h-3 w-4 rounded-[2px] border border-border' />, 'macOS reserve')}
          {legend(<span className='h-3 w-2 rounded-[2px]' style={orgStyle(0)} />, 'leased')}
          {legend(<span className='fleet-idle h-3 w-2 rounded-[2px]' style={orgStyle(0)} />, 'unleased')}
          {legend(<span className='h-3 w-2 rounded-[2px] opacity-50' style={orgStyle(0)} />, 'starting / stopping')}
          {legend(<span className='h-3 w-2 rounded-[2px] border border-dashed border-muted-foreground/40' />, 'free slot')}
        </div>
      </div>
      <div className='rounded-lg border border-border'>
        <div className={cn('grid gap-x-5 border-b border-border px-4 py-2', HOST_COLUMNS, LABEL)}>
          <span>Host</span><span>Slots</span><span>Memory</span><span>Pressure</span><span>CPU</span><span>Disk free</span><span>Cached</span><span className='text-right'>Tunnel</span>
        </div>
        <div className='divide-y divide-border'>
          {fleet.hosts.length
            ? fleet.hosts.map((host) => <HostRow key={host.slug} host={host} at={fleet.at} full={fleet.contention.full.includes(host.slug)} />)
            : <p className='px-4 py-3 text-muted-foreground'>No hosts in {fleet.environment}. Add one with scripts/cloud-host.ts add.</p>}
        </div>
      </div>
    </section>
  )
}

function HostRow({ host, at, full }: { host: FleetHost; at: number; full: boolean }) {
  const down = !host.report
  const offline = down || !host.online
  const machine = host.report?.machine
  const used = machine?.usedBytes
  const dash = <span className='text-muted-foreground'>–</span>
  const seen = host.lastSeenAt === null ? 'never seen' : `seen ${formatDuration(at - host.lastSeenAt)} ago`
  const holds = host.placed.length + host.cached.filter((p) => p.version > p.savedVersion).length
  return (
    <div className={cn('grid items-center gap-x-5 px-4 py-3', HOST_COLUMNS, full && 'bg-amber-500/5')}>
      <div className='flex flex-col'>
        <div className='flex items-center gap-1.5'>
          <span className={cn('size-2 rounded-full', offline ? 'bg-red-500' : host.status === 'draining' ? 'bg-muted-foreground/50' : full ? 'bg-amber-500' : 'bg-emerald-500')} />
          <span className='font-medium'>{host.slug}</span>
          {offline ? <Tag tone='bad'>{down ? 'down' : `offline ${host.lastSeenAt === null ? '' : formatDuration(at - host.lastSeenAt)}`}</Tag> : null}
          {full ? <Tag tone='warn'>full</Tag> : null}
          {host.status === 'draining' ? <Tag>draining</Tag> : null}
        </div>
        <p className='font-mono text-[10.5px] text-muted-foreground'>{host.address}{machine ? ` · ${formatGiB(machine.memoryBytes)}` : ''}</p>
        <p className='font-mono text-[10.5px] text-muted-foreground/70'>
          {host.report ? host.report.bundleVersion : 'bundle ?'} · {machine?.uptimeS !== undefined ? `up ${formatDuration(machine.uptimeS * SECOND_MS)}` : seen}
        </p>
      </div>
      {down ? (
        <div className='text-[11.5px] text-muted-foreground'>
          <span className='font-mono text-red-600 dark:text-red-400'>{host.error}</span>
          {holds ? <> · holds the newest copy of {holds} {holds === 1 ? 'phone' : 'phones'}. Wait for it, or run <code className='rounded bg-muted px-1 font-mono'>cloud-host.ts recover &lt;phone&gt;</code></> : null}
        </div>
      ) : <MemoryMap host={host} at={at} />}
      <div className='flex flex-col gap-1'>
        {machine && used !== undefined ? (
          <>
            <span className='font-mono text-[11px]'>{toGiB(used)} / {formatGiB(machine.memoryBytes)}</span>
            <div className='h-1 w-full rounded-full bg-muted'>
              <div
                className={cn('h-1 rounded-full', used / machine.memoryBytes > MEMORY_WARN_SHARE ? 'bg-amber-500' : 'bg-foreground/80')}
                style={{ width: `${Math.min(100, Math.round((used / machine.memoryBytes) * 100))}%` }}
              />
            </div>
          </>
        ) : dash}
      </div>
      <div className='font-mono text-[11px]'>
        {machine ? (
          <>
            <span className={cn(machine.pressure === 'warning' && 'text-amber-700 dark:text-amber-400', machine.pressure === 'critical' && 'text-red-600 dark:text-red-400')}>{machine.pressure}</span>
            <br />
            <span className='text-muted-foreground'>swap {machine.swapUsedBytes === undefined ? '–' : formatGiB(machine.swapUsedBytes)}</span>
          </>
        ) : dash}
      </div>
      <div className='font-mono text-[11px]'>{machine?.load1 !== undefined ? `${machine.load1.toFixed(1)}/${machine.cores}` : dash}</div>
      <div className='font-mono text-[11px]'>{host.report ? formatDisk(host.report.freeDiskBytes) : dash}</div>
      <div className='flex flex-wrap items-center gap-1'>
        {host.cached.length ? host.cached.map((phone) => (
          <i
            key={phone.phoneId}
            title={`${phone.email ?? phone.orgId} · ${phone.name} · v${phone.version}${phone.version > phone.savedVersion ? ', not in R2 yet' : ''}`}
            className={cn('size-2 rounded-full', phone.version > phone.savedVersion && 'ring-2 ring-red-500/30')}
            style={orgStyle(phone.color)}
          />
        )) : dash}
      </div>
      <div className={cn('text-right font-mono text-[11px]', down ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>{down ? 'down' : `${host.ms} ms`}</div>
    </div>
  )
}

/** The macOS reserve, one cell per slot colored by org, free slots dashed, measured use under it. */
function MemoryMap({ host, at }: { host: FleetHost; at: number }) {
  const vm = host.report?.vmMemoryBytes ?? DEFAULT_VM_MEMORY_BYTES
  const reserve = host.report?.reserveBytes ?? DEFAULT_RESERVE_BYTES
  const reserveCells = reserve / vm
  return (
    <div className='flex flex-col gap-1'>
      <div className='flex flex-wrap items-center gap-[3px]'>
        <div
          className='fleet-reserve h-7 shrink-0 rounded-[2px] border border-border'
          style={{ width: reserveCells * CELL_PX + (reserveCells - 1) * CELL_GAP_PX }}
          title={`macOS ${formatGiB(reserve)}`}
        />
        {host.placed.map((phone) => <PhoneCell key={phone.phoneId} phone={phone} at={at} />)}
        {Array.from({ length: Math.max(0, host.free) }, (_, i) => (
          <div key={i} className='h-7 w-[14px] rounded-[2px] border border-dashed border-muted-foreground/40' />
        ))}
      </div>
      <p className='font-mono text-[10.5px] text-muted-foreground'>
        {host.placed.length}/{host.slots} slots · {formatGiB(vm)} each
        {host.footprintBytes !== null ? ` · VMs use ${formatGiB(host.footprintBytes)}` : ''}
      </p>
    </div>
  )
}

function PhoneCell({ phone, at }: { phone: FleetPhone; at: number }) {
  const moving = phone.state !== 'running'
  const row = (label: string, value: ReactNode) => <><dt className='text-muted-foreground'>{label}</dt><dd className='min-w-0 break-words'>{value}</dd></>
  return (
    <div className='group relative'>
      <div
        tabIndex={0}
        className={cn('h-7 w-[14px] rounded-[2px] outline-none focus-visible:ring-2 focus-visible:ring-ring', !moving && !phone.lease && 'fleet-idle', moving && 'animate-pulse opacity-50')}
        style={orgStyle(phone.color)}
      />
      <div className='pointer-events-none absolute top-full left-0 z-10 mt-1.5 hidden w-64 rounded-lg border border-border bg-popover p-3 text-xs text-popover-foreground shadow-lg group-hover:block group-has-focus-visible:block'>
        <div className='flex items-center gap-2'>
          <span className='size-2 shrink-0 rounded-full' style={orgStyle(phone.color)} />
          <span className='truncate font-medium'>{phone.email ?? phone.orgId}</span>
        </div>
        <dl className='mt-2 grid grid-cols-[56px_1fr] gap-y-1 text-[11px]'>
          {row('Phone', <>{phone.name} <span className='font-mono text-muted-foreground'>{shortPhoneId(phone.phoneId)}</span></>)}
          {row('State', moving ? `${phone.state} for ${formatDuration(at - phone.stateChangedAt)}${phone.report ? ` (host: ${phone.report.state})` : ''}` : phone.report?.state ?? 'not in the report')}
          {phone.lease
            ? <>
                {row('Lease', <><span className='font-mono'>cloud:{phone.lease.n}</span> · used {formatDuration(at - phone.lease.lastUsedAt)} ago</>)}
                {row('Reason', <span className='text-muted-foreground'>{phone.lease.label ? `${phone.lease.label}: ` : ''}{phone.lease.reason}</span>)}
              </>
            : phone.idleSince !== null ? row('Lease', `none, idle ${formatDuration(at - phone.idleSince)}`) : null}
          {row('Memory', <span className='font-mono'>{phone.report?.footprintBytes !== undefined ? formatGiB(phone.report.footprintBytes) : '–'}</span>)}
          {phone.report?.error ? row('Error', <span className='text-red-600 dark:text-red-400'>{phone.report.error}</span>) : null}
        </dl>
      </div>
    </div>
  )
}

function Contention({ fleet }: { fleet: Fleet }) {
  const { full, transitions, idle } = fleet.contention
  const at = fleet.at
  if (!full.length && !transitions.length && !idle.length) return <p className='px-4 py-3 text-muted-foreground'>Nothing waits: no host is full and no phone is moving.</p>
  return (
    <div className='divide-y divide-border'>
      {full.map((slug) => (
        <ContentionRow key={slug} title={<>{slug} is full</>} side={<span className='text-amber-700 dark:text-amber-400'>full</span>}>
          A stored phone starts here only after an idle one passes its grace time.
        </ContentionRow>
      ))}
      {transitions.map((phone) => (
        <ContentionRow key={phone.phoneId} phone={phone} title={<PhoneTitle phone={phone} />} side={formatDuration(at - phone.stateChangedAt)}>
          {phone.state === 'starting' ? 'Starting' : 'Stopping'} on {phone.host}{phone.report ? `: the host says ${phone.report.state}` : ''}{phone.report?.error ? ` (${phone.report.error})` : ''}.
        </ContentionRow>
      ))}
      {idle.map((phone) => {
        const wait = phone.evictableAt! - at
        return (
          <ContentionRow
            key={phone.phoneId}
            phone={phone}
            title={<PhoneTitle phone={phone} />}
            side={<span className={cn(wait <= 0 && 'text-amber-700 dark:text-amber-400')}>{wait <= 0 ? 'stoppable now' : `stoppable in ${formatDuration(wait)}`}</span>}
          >
            Running on {phone.host} with no lease for {formatDuration(at - phone.idleSince!)}.
          </ContentionRow>
        )
      })}
    </div>
  )
}

function ContentionRow({ phone, title, side, children }: { phone?: FleetPhone; title: ReactNode; side: ReactNode; children: ReactNode }) {
  return (
    <div className='flex items-start gap-3 px-4 py-3'>
      <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', !phone && 'bg-amber-500')} style={phone ? orgStyle(phone.color) : undefined} />
      <div className='flex min-w-0 flex-1 flex-col'>
        <p className='truncate font-medium'>{title}</p>
        <p className='text-xs text-muted-foreground'>{children}</p>
      </div>
      <span className='shrink-0 font-mono text-[11px] text-muted-foreground'>{side}</span>
    </div>
  )
}

function PhoneTitle({ phone }: { phone: FleetPhone }) {
  return <>{phone.email ?? phone.orgId} <span className='font-mono text-[11px] font-normal text-muted-foreground'>{shortPhoneId(phone.phoneId)}</span></>
}

const EVENT_TAGS: Record<LeaseEvent['kind'], string> = {
  acquired: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  ended: 'bg-muted text-muted-foreground',
  expired: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
}

function RecentLeases({ events, at }: { events: LeaseEvent[]; at: number }) {
  if (!events.length) return <p className='px-4 py-3 text-muted-foreground'>No leases yet.</p>
  return (
    <table className='w-full text-xs'>
      <tbody className='divide-y divide-border'>
        {events.map((event) => (
          <tr key={`${event.n}-${event.kind}`}>
            <td className='w-16 py-2 pl-4 font-mono text-[11px] text-muted-foreground'>{formatDuration(at - event.at)} ago</td>
            <td className='w-20'><span className={cn('rounded px-1.5 py-0.5 font-mono text-[10px]', EVENT_TAGS[event.kind])}>{event.kind}</span></td>
            <td className='pr-4 text-muted-foreground'>
              <i className='mr-1.5 inline-block size-1.5 rounded-full bg-muted-foreground/40 align-middle' style={event.color === null ? undefined : orgStyle(event.color)} />
              cloud:{event.n}
              {event.kind === 'acquired' && event.host ? ` on ${event.host}` : ''}
              {event.heldMs !== null ? ` after ${formatDuration(event.heldMs)}` : ''}
              {' · '}&ldquo;{event.reason}&rdquo;
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Customers({ fleet }: { fleet: Fleet }) {
  if (!fleet.customers.length) return <p className='px-4 py-3 text-muted-foreground'>No cloud phone sold yet.</p>
  return (
    <table className='w-full text-xs'>
      <thead>
        <tr className={LABEL}>
          <th className='px-4 py-2.5 text-left font-medium'>Account</th>
          <th className='text-right font-medium'>Phones</th>
          <th className='text-right font-medium'>Running</th>
          <th className='px-4 text-right font-medium'>Leased</th>
        </tr>
      </thead>
      <tbody className='divide-y divide-border font-mono'>
        {fleet.customers.map((customer) => (
          <tr key={customer.orgId}>
            <td className='px-4 py-2.5 font-sans'>
              <span className='flex items-center gap-2'>
                <span className='size-2 shrink-0 rounded-full' style={orgStyle(customer.color)} />
                <span className='truncate'>{customer.emails[0] ?? customer.orgId}</span>
                {customer.emails.length > 1 ? <span className='text-muted-foreground'>+{customer.emails.length - 1}</span> : null}
              </span>
            </td>
            <td className='text-right'>{customer.phones}</td>
            <td className='text-right'>{customer.running}</td>
            <td className='px-4 text-right'>{customer.leased}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className='flex min-w-0 flex-col gap-2.5'>
      <h2 className='text-[15px] font-semibold tracking-tight text-pretty'>{title}</h2>
      <div className='rounded-lg border border-border'>{children}</div>
    </div>
  )
}

function Tag({ tone, children }: { tone?: 'bad' | 'warn'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'rounded border px-1 text-[10px] font-medium',
        !tone && 'border-border bg-muted text-muted-foreground',
        tone === 'warn' && 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
        tone === 'bad' && 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400',
      )}
    >
      {children}
    </span>
  )
}
