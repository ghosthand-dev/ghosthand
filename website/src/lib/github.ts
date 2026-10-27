// Read-only access to the private daemon repo for Pro orgs.
//
//   dashboard "Request access" {GitHub username} ──> source_access row (GitHub user id)
//   Stripe webhook / request / daily cron ──> syncSourceAccess ──GITHUB_TOKEN──> collaborators API
//
// Postgres holds the desired state (Pro org + requested account), GitHub the actual one, so
// every sync is safe to repeat. Only org-owned repos give read-only (`pull`) collaborators.
// GitHub invites by username only; the numeric user id survives renames.
// TODO: replace Tommy's fine-grained token with a GitHub App installation token if several
// people need to manage access. https://docs.github.com/en/apps

import { env } from 'cloudflare:workers'
import * as orm from 'drizzle-orm'
import * as schema from 'db/schema'
import { getDb } from '../db.ts'
import { entitlementFor } from './billing.ts'
import { trackEvent } from '../telemetry.ts'

export const DAEMON_REPO = 'ghosthand-dev/ghosthand-daemon'
export const DAEMON_REPO_URL = `https://github.com/${DAEMON_REPO}`
export const DAEMON_INVITATIONS_URL = `${DAEMON_REPO_URL}/invitations`
const GITHUB_API = 'https://api.github.com'
const PAGE_SIZE = 100
const HTTP_NOT_FOUND = 404

export type GithubUser = { id: number; login: string }

async function github(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<Response> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'ghosthand.dev',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
  })
  if (!response.ok && response.status !== HTTP_NOT_FOUND) {
    throw new Error(`GitHub ${init.method ?? 'GET'} ${path} failed: ${response.status} ${await response.text()}`)
  }
  return response
}

async function githubList<T>(path: string, signal?: AbortSignal): Promise<T[]> {
  const all: T[] = []
  for (let page = 1; ; page++) {
    const separator = path.includes('?') ? '&' : '?'
    const batch = await (await github(`${path}${separator}per_page=${PAGE_SIZE}&page=${page}`, { signal })).json<T[]>()
    all.push(...batch)
    if (batch.length < PAGE_SIZE) return all
  }
}

/** The account behind a username, or null when it does not exist. */
export async function findGithubUser(login: string, signal?: AbortSignal): Promise<GithubUser | null> {
  const response = await github(`/users/${encodeURIComponent(login)}`, { signal })
  if (response.status === HTTP_NOT_FOUND) return null
  const user = await response.json<GithubUser>()
  return { id: user.id, login: user.login }
}

/** The current login of an account id: a renamed login can belong to someone else now. */
async function currentLogin(githubUserId: number, signal?: AbortSignal): Promise<string | null> {
  const response = await github(`/user/${githubUserId}`, { signal })
  if (response.status === HTTP_NOT_FOUND) return null
  return (await response.json<GithubUser>()).login
}

type Invitation = { id: number; invitee: GithubUser | null }

async function grant(githubUserId: number, signal?: AbortSignal): Promise<void> {
  const login = await currentLogin(githubUserId, signal)
  if (!login) throw new Error(`GitHub account ${githubUserId} no longer exists`)
  // Sends an invite the user accepts on GitHub; a no-op for a current collaborator.
  const response = await github(`/repos/${DAEMON_REPO}/collaborators/${encodeURIComponent(login)}`, { method: 'PUT', body: { permission: 'pull' }, signal })
  if (response.status === HTTP_NOT_FOUND) throw new Error(`cannot invite ${login} to ${DAEMON_REPO}: 404`)
}

/** Removes the collaborator and any pending invite of this GitHub account. */
async function revoke(githubUserId: number, signal?: AbortSignal): Promise<void> {
  const login = await currentLogin(githubUserId, signal)
  if (login) await github(`/repos/${DAEMON_REPO}/collaborators/${encodeURIComponent(login)}`, { method: 'DELETE', signal })
  const invitations = await githubList<Invitation>(`/repos/${DAEMON_REPO}/invitations`, signal)
  for (const invitation of invitations.filter((i) => i.invitee?.id === githubUserId)) {
    await github(`/repos/${DAEMON_REPO}/invitations/${invitation.id}`, { method: 'DELETE', signal })
  }
}

/** The GitHub account ids requested by any org, and those of them with a Pro org. */
async function requestedAccounts(): Promise<{ managed: Set<number>; wanted: Set<number> }> {
  const requests = await getDb().query.sourceAccess.findMany({ with: { org: { with: { subscriptions: true } } } })
  const now = new Date()
  const wanted = requests.filter((r) => r.org && entitlementFor({ subscriptions: r.org.subscriptions, now }).sourceAccess)
  return { managed: new Set(requests.map((r) => r.githubUserId)), wanted: new Set(wanted.map((r) => r.githubUserId)) }
}

/**
 * Grants or revokes one GitHub account. Several orgs can request the same account, so it
 * keeps access while any of them is Pro.
 */
async function syncGithubAccount(githubUserId: number, signal?: AbortSignal): Promise<'granted' | 'revoked'> {
  const { wanted } = await requestedAccounts()
  if (wanted.has(githubUserId)) {
    await grant(githubUserId, signal)
    return 'granted'
  }
  await revoke(githubUserId, signal)
  return 'revoked'
}

/** Grants or revokes the org's requested account to match the plans that request it. */
export async function syncSourceAccess(orgId: string, signal?: AbortSignal): Promise<void> {
  const request = await getDb().query.sourceAccess.findFirst({ where: { orgId } })
  if (!request) return
  const result = await syncGithubAccount(request.githubUserId, signal)
  trackEvent(result === 'granted' ? 'source_access_granted' : 'source_access_revoked', { org_id: orgId })
}

/**
 * Daily drift fix for the accounts orgs requested: each one of a Pro org has access or an
 * invite, the others have neither. Collaborators nobody requested (added by hand) and org
 * members are never touched.
 */
export async function reconcileSourceAccess(signal?: AbortSignal): Promise<{ granted: number; revoked: number }> {
  const { managed, wanted } = await requestedAccounts()
  const collaborators = await githubList<GithubUser>(`/repos/${DAEMON_REPO}/collaborators?affiliation=outside`, signal)
  const invitations = await githubList<Invitation>(`/repos/${DAEMON_REPO}/invitations`, signal)
  const present = new Set([...collaborators.map((c) => c.id), ...invitations.flatMap((i) => (i.invitee ? [i.invitee.id] : []))])

  let revoked = 0
  for (const id of present) {
    if (!managed.has(id) || wanted.has(id)) continue
    await revoke(id, signal)
    console.log(`source access: revoked GitHub account ${id}`)
    revoked++
  }
  let granted = 0
  for (const id of wanted) {
    if (present.has(id)) continue
    await grant(id, signal)
    console.log(`source access: invited GitHub account ${id}`)
    granted++
  }
  return { granted, revoked }
}

/** Saves the org's GitHub account; the previous one loses access unless another Pro org wants it. */
export async function requestSourceAccess({ orgId, user, signal }: { orgId: string; user: GithubUser; signal?: AbortSignal }): Promise<void> {
  const db = getDb()
  const previous = await db.query.sourceAccess.findFirst({ where: { orgId } })
  await db.insert(schema.sourceAccess)
    .values({ orgId, githubUserId: user.id, githubLogin: user.login })
    .onConflictDoUpdate({
      target: schema.sourceAccess.orgId,
      set: { githubUserId: user.id, githubLogin: user.login, requestedAt: new Date() },
    })
  trackEvent('source_access_requested', { org_id: orgId })
  if (previous && previous.githubUserId !== user.id) await syncGithubAccount(previous.githubUserId, signal)
  await syncSourceAccess(orgId, signal)
}

/** Dashboard "Remove": forgets the account; it loses access unless another Pro org wants it. */
export async function removeSourceAccess({ orgId, signal }: { orgId: string; signal?: AbortSignal }): Promise<void> {
  const db = getDb()
  const [removed] = await db.delete(schema.sourceAccess).where(orm.eq(schema.sourceAccess.orgId, orgId)).returning()
  if (!removed) return
  await syncGithubAccount(removed.githubUserId, signal)
  trackEvent('source_access_revoked', { org_id: orgId })
}
