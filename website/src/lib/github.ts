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

async function grant(user: GithubUser, signal?: AbortSignal): Promise<void> {
  // Sends an invite the user accepts on GitHub; a no-op for a current collaborator.
  await github(`/repos/${DAEMON_REPO}/collaborators/${encodeURIComponent(user.login)}`, { method: 'PUT', body: { permission: 'pull' }, signal })
}

type Invitation = { id: number; invitee: GithubUser | null }

/** Removes the collaborator and any pending invite of this GitHub account. */
export async function revokeGithubUser(user: GithubUser, signal?: AbortSignal): Promise<void> {
  await github(`/repos/${DAEMON_REPO}/collaborators/${encodeURIComponent(user.login)}`, { method: 'DELETE', signal })
  const invitations = await githubList<Invitation>(`/repos/${DAEMON_REPO}/invitations`, signal)
  for (const invitation of invitations.filter((i) => i.invitee?.id === user.id)) {
    await github(`/repos/${DAEMON_REPO}/invitations/${invitation.id}`, { method: 'DELETE', signal })
  }
}

/** Grants or revokes the org's requested account to match its plan. */
export async function syncSourceAccess(orgId: string, signal?: AbortSignal): Promise<void> {
  const org = await getDb().query.org.findFirst({ where: { orgId }, with: { subscriptions: true, sourceAccess: true } })
  const request = org?.sourceAccess
  if (!org || !request) return
  const user = { id: request.githubUserId, login: request.githubLogin }
  if (entitlementFor({ subscriptions: org.subscriptions, now: new Date() }).sourceAccess) {
    await grant(user, signal)
    trackEvent('source_access_granted', { org_id: orgId })
  } else {
    await revokeGithubUser(user, signal)
    trackEvent('source_access_revoked', { org_id: orgId })
  }
}

/**
 * Daily drift fix: every requested account of a Pro org has access or an invite, and no
 * outside collaborator or invite is left without one. Org members are never touched.
 */
export async function reconcileSourceAccess(signal?: AbortSignal): Promise<{ granted: number; revoked: number }> {
  const requests = await getDb().query.sourceAccess.findMany({ with: { org: { with: { subscriptions: true } } } })
  const now = new Date()
  const wanted = new Map(
    requests
      .filter((r) => r.org && entitlementFor({ subscriptions: r.org.subscriptions, now }).sourceAccess)
      .map((r) => [r.githubUserId, { id: r.githubUserId, login: r.githubLogin }]),
  )
  const collaborators = await githubList<GithubUser>(`/repos/${DAEMON_REPO}/collaborators?affiliation=outside`, signal)
  const invitations = await githubList<Invitation>(`/repos/${DAEMON_REPO}/invitations`, signal)
  const present = new Set([...collaborators.map((c) => c.id), ...invitations.flatMap((i) => (i.invitee ? [i.invitee.id] : []))])

  let revoked = 0
  for (const collaborator of collaborators.filter((c) => !wanted.has(c.id))) {
    await github(`/repos/${DAEMON_REPO}/collaborators/${encodeURIComponent(collaborator.login)}`, { method: 'DELETE', signal })
    console.log(`source access: removed collaborator ${collaborator.login}`)
    revoked++
  }
  for (const invitation of invitations.filter((i) => !i.invitee || !wanted.has(i.invitee.id))) {
    await github(`/repos/${DAEMON_REPO}/invitations/${invitation.id}`, { method: 'DELETE', signal })
    console.log(`source access: deleted invitation ${invitation.id} for ${invitation.invitee?.login ?? 'unknown'}`)
    revoked++
  }
  let granted = 0
  for (const user of wanted.values()) {
    if (present.has(user.id)) continue
    await grant(user, signal)
    console.log(`source access: invited ${user.login}`)
    granted++
  }
  return { granted, revoked }
}

/** Saves the org's GitHub account, revoking the previous one when it changed. */
export async function requestSourceAccess({ orgId, user, signal }: { orgId: string; user: GithubUser; signal?: AbortSignal }): Promise<void> {
  const db = getDb()
  const previous = await db.query.sourceAccess.findFirst({ where: { orgId } })
  if (previous && previous.githubUserId !== user.id) {
    await revokeGithubUser({ id: previous.githubUserId, login: previous.githubLogin }, signal)
  }
  await db.insert(schema.sourceAccess)
    .values({ orgId, githubUserId: user.id, githubLogin: user.login })
    .onConflictDoUpdate({
      target: schema.sourceAccess.orgId,
      set: { githubUserId: user.id, githubLogin: user.login, requestedAt: new Date() },
    })
  trackEvent('source_access_requested', { org_id: orgId })
  await syncSourceAccess(orgId, signal)
}

/** Dashboard "Remove": revokes access and forgets the account. */
export async function removeSourceAccess({ orgId, signal }: { orgId: string; signal?: AbortSignal }): Promise<void> {
  const db = getDb()
  const previous = await db.query.sourceAccess.findFirst({ where: { orgId } })
  if (!previous) return
  await revokeGithubUser({ id: previous.githubUserId, login: previous.githubLogin }, signal)
  await db.delete(schema.sourceAccess).where(orm.eq(schema.sourceAccess.orgId, orgId))
  trackEvent('source_access_revoked', { org_id: orgId })
}
