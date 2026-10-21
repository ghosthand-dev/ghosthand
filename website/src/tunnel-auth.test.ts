import { afterAll, beforeAll, expect, test } from 'vitest'
import { startTestRuntime } from './test-runtime.ts'
import crypto from 'node:crypto'
import dedent from 'string-dedent'

const DAY_MS = 86_400_000

let runtime: Awaited<ReturnType<typeof startTestRuntime>>
beforeAll(async () => { runtime = await startTestRuntime() })
afterAll(async () => { await runtime?.server.close() })

async function session() {
  const response = await runtime.worker.fetch('/__test/session', { method: 'POST' })
  expect(response.status).toBe(200)
  return await response.json() as { user: { id: string }; session: { id: string; token: string } }
}

async function connect(token: string) {
  const response = await runtime.worker.fetch('/tunnel/upstream', {
    headers: { upgrade: 'websocket', authorization: `Bearer ${token}`, 'user-agent': 'ghosthand/test (Studio)' },
  })
  expect(response.status).toBe(101)
  const socket = response.webSocket!
  socket.accept()
  return socket
}

async function oauth({ identity, clientId = crypto.randomUUID() }: { identity: Awaited<ReturnType<typeof session>>; clientId?: string }) {
  const redirectUri = 'http://127.0.0.1:8765/callback'
  await runtime.env.DB.prepare(dedent`
    INSERT OR IGNORE INTO oauth_client
      (id, client_id, redirect_uris, grant_types, response_types, token_endpoint_auth_method, skip_consent, scopes)
      VALUES (?, ?, ?, ?, ?, 'none', 1, ?)
  `).bind(
    clientId, clientId, JSON.stringify([redirectUri]), JSON.stringify(['authorization_code', 'refresh_token']),
    JSON.stringify(['code']), JSON.stringify(['openid', 'offline_access']),
  ).run()
  const resource = new URL('/mcp', runtime.baseUrl).href
  // Auth initialization seeds the real resource before the client-resource link.
  await runtime.worker.fetch('/api/auth/get-session')
  await runtime.env.DB.prepare('INSERT OR IGNORE INTO oauth_client_resource (id, client_id, resource_id) VALUES (?, ?, ?)')
    .bind(crypto.randomUUID(), clientId, resource).run()
  const verifier = crypto.randomBytes(32).toString('base64url')
  const query = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid offline_access',
    resource, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
  })
  const authorize = await runtime.worker.fetch(`/api/auth/oauth2/authorize?${query}`, {
    headers: { authorization: `Bearer ${identity.session.token}` }, redirect: 'manual',
  })
  expect(authorize.status, await authorize.clone().text()).toBe(200)
  const { url } = await authorize.json() as { url: string }
  const code = new URL(url).searchParams.get('code')!
  expect(code).toBeTruthy()
  const response = await runtime.worker.fetch('/api/auth/oauth2/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri, client_id: clientId }),
  })
  expect(response.status, await response.clone().text()).toBe(200)
  return { clientId, ...await response.json() as { access_token: string; refresh_token: string } }
}

async function mcp(token: string) {
  return runtime.worker.fetch('/mcp', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
  })
}

test('standard sign-out removes the connected Mac, including after hibernation', async () => {
  const identity = await session()
  const socket = await connect(identity.session.token)
  await runtime.worker.evictDurableObject('GHOSTHAND_HUB', { name: identity.user.id, webSockets: 'hibernate' })
  const signedOut = await runtime.worker.fetch('/api/auth/sign-out', {
    method: 'POST', headers: { authorization: `Bearer ${identity.session.token}`, 'content-type': 'application/json' }, body: '{}',
  })
  expect(signedOut.status).toBe(200)
  const hub = runtime.env.GHOSTHAND_HUB.get(runtime.env.GHOSTHAND_HUB.idFromName(identity.user.id))
  expect(await hub.macs()).toEqual([])
  socket.close()
})

test('MCP checks grant revocation, disabled clients and ended sessions against Better Auth', async () => {
  const identity = await session()
  const grant = await oauth({ identity })
  expect((await mcp(grant.access_token)).status).toBe(200)
  await runtime.env.DB.prepare('UPDATE oauth_client SET disabled = 1 WHERE client_id = ?').bind(grant.clientId).run()
  const disabled = await mcp(grant.access_token)
  expect(disabled.status).toBe(401)
  expect(disabled.headers.get('www-authenticate')).toContain('oauth-protected-resource')
  await runtime.env.DB.prepare('UPDATE oauth_client SET disabled = 0 WHERE client_id = ?').bind(grant.clientId).run()
  expect((await mcp(grant.access_token)).status).toBe(200)
  const revoked = await runtime.worker.fetch('/api/auth/oauth2/revoke', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: grant.clientId, token: grant.refresh_token, token_type_hint: 'refresh_token' }),
  })
  expect(revoked.status, await revoked.clone().text()).toBe(200)
  expect((await mcp(grant.access_token)).status).toBe(401)

  const next = await oauth({ identity })
  expect((await mcp(next.access_token)).status).toBe(200)
  const revokeAccess = await runtime.worker.fetch('/api/auth/oauth2/revoke', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: next.clientId, token: next.access_token, token_type_hint: 'access_token' }),
  })
  expect(revokeAccess.status).toBe(200)
  expect((await mcp(next.access_token)).status).toBe(401)

  const final = await oauth({ identity })
  expect((await mcp(final.access_token)).status).toBe(200)
  const otherResponse = await runtime.worker.fetch(`/__test/session?userId=${identity.user.id}`, { method: 'POST' })
  const other = await otherResponse.json() as Awaited<ReturnType<typeof session>>
  const sibling = await oauth({ identity: other, clientId: final.clientId })
  await runtime.worker.fetch('/api/cli/logout', { method: 'POST', headers: { authorization: `Bearer ${identity.session.token}` } })
  expect((await mcp(final.access_token)).status).toBe(401)
  const refreshed = await runtime.worker.fetch('/api/auth/oauth2/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: final.clientId, refresh_token: final.refresh_token }),
  })
  expect(refreshed.status).toBe(400)
  expect(await refreshed.json()).toMatchObject({ error: 'invalid_grant' })
  expect((await mcp(sibling.access_token)).status).toBe(200)
})

test('session deadline alarms survive hibernation and honor renewed sessions', async () => {
  const identity = await session()
  const socket = await connect(identity.session.token)
  const renewedExpiry = Date.now() + DAY_MS
  await runtime.env.DB.prepare('UPDATE session SET expires_at = ? WHERE id = ?').bind(renewedExpiry, identity.session.id).run()
  await runtime.worker.evictDurableObject('GHOSTHAND_HUB', { name: identity.user.id, webSockets: 'hibernate' })
  const renewed = await runtime.worker.fetch(`/__test/expire?org=${identity.user.id}`)
  expect(await renewed.json()).toMatchObject({ deadline: renewedExpiry, macs: [{ sessionId: identity.session.id, online: true }] })
  await runtime.env.DB.prepare('UPDATE session SET expires_at = ? WHERE id = ?').bind(Date.now() - 1, identity.session.id).run()
  const expired = await runtime.worker.fetch(`/__test/expire?org=${identity.user.id}`)
  expect(await expired.json()).toEqual({ deadline: null, macs: [] })
  const reconnect = await runtime.worker.fetch('/tunnel/upstream', {
    headers: { upgrade: 'websocket', authorization: `Bearer ${identity.session.token}` },
  })
  expect(reconnect.status).toBe(401)
  socket.close()
})

test('a concurrent connect cannot restore a signed-out session', async () => {
  const identity = await session()
  const [connection, revoked] = await Promise.all([
    runtime.worker.fetch('/tunnel/upstream', { headers: { upgrade: 'websocket', authorization: `Bearer ${identity.session.token}` } }),
    runtime.worker.fetch('/api/auth/sign-out', {
      method: 'POST', headers: { authorization: `Bearer ${identity.session.token}`, 'content-type': 'application/json' }, body: '{}',
    }),
  ])
  expect(revoked.status).toBe(200)
  expect([101, 401]).toContain(connection.status)
  const hub = runtime.env.GHOSTHAND_HUB.get(runtime.env.GHOSTHAND_HUB.idFromName(identity.user.id))
  expect(await hub.macs()).toEqual([])
  if (connection.webSocket) { connection.webSocket.accept(); connection.webSocket.close() }
})

test('cached session data cannot reconnect or call the API after revocation', async () => {
  const identity = await session()
  const current = await runtime.worker.fetch('/api/auth/get-session', { headers: { authorization: `Bearer ${identity.session.token}` } })
  const cookie = current.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ')
  expect(cookie).toContain('session_data=')
  const headers = { cookie, authorization: `Bearer ${identity.session.token}` }
  expect((await runtime.worker.fetch('/macs', { headers })).status).toBe(200)
  const revoked = await runtime.worker.fetch('/api/auth/sign-out', {
    method: 'POST', headers: { authorization: `Bearer ${identity.session.token}`, 'content-type': 'application/json' }, body: '{}',
  })
  expect(revoked.status).toBe(200)
  expect((await runtime.worker.fetch('/macs', { headers })).status).toBe(401)
  expect((await runtime.worker.fetch('/tunnel/upstream', { headers: { ...headers, upgrade: 'websocket' } })).status).toBe(401)
})

test('bulk session revocation closes every Mac session for that user', async () => {
  const identity = await session()
  const otherResponse = await runtime.worker.fetch(`/__test/session?userId=${identity.user.id}`, { method: 'POST' })
  const other = await otherResponse.json() as Awaited<ReturnType<typeof session>>
  const sockets = await Promise.all([connect(identity.session.token), connect(other.session.token)])
  const revoked = await runtime.worker.fetch('/api/auth/revoke-sessions', {
    method: 'POST', headers: { authorization: `Bearer ${identity.session.token}`, 'content-type': 'application/json' }, body: '{}',
  })
  expect(revoked.status).toBe(200)
  const hub = runtime.env.GHOSTHAND_HUB.get(runtime.env.GHOSTHAND_HUB.idFromName(identity.user.id))
  expect(await hub.macs()).toEqual([])
  sockets.forEach((socket) => socket.close())
})

test('dashboard sign-out retries hub cleanup after the session row is already gone', async () => {
  const mac = await session()
  const socket = await connect(mac.session.token)
  const browserResponse = await runtime.worker.fetch(`/__test/session?userId=${mac.user.id}`, { method: 'POST' })
  const browser = await browserResponse.json() as Awaited<ReturnType<typeof session>>
  // A failed delete.after RPC leaves this exact state: no row, but an open socket.
  await runtime.env.DB.prepare('DELETE FROM session WHERE id = ?').bind(mac.session.id).run()
  const response = await runtime.worker.fetch('/__test/sign-out-mac', {
    method: 'POST', headers: { authorization: `Bearer ${browser.session.token}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ sessionId: mac.session.id }), redirect: 'manual',
  })
  expect(response.headers.get('location')).toBe('/dashboard')
  const hub = runtime.env.GHOSTHAND_HUB.get(runtime.env.GHOSTHAND_HUB.idFromName(mac.user.id))
  expect(await hub.macs()).toEqual([])
  socket.close()
})

test('MCP requires its audience and an unexpired, session-bound access token', async () => {
  const identity = await session()
  const grant = await oauth({ identity })
  const original = await runtime.env.DB.prepare('SELECT resources FROM oauth_access_token WHERE client_id = ?').bind(grant.clientId).first<string>('resources')
  await runtime.env.DB.prepare('UPDATE oauth_access_token SET resources = NULL WHERE client_id = ?').bind(grant.clientId).run()
  expect((await mcp(grant.access_token)).status).toBe(401)
  await runtime.env.DB.prepare('UPDATE oauth_access_token SET resources = ? WHERE client_id = ?').bind(original, grant.clientId).run()
  expect((await mcp(grant.access_token)).status).toBe(200)
  await runtime.env.DB.prepare('UPDATE session SET expires_at = ? WHERE id = ?').bind(Date.now() - 1, identity.session.id).run()
  expect((await mcp(grant.access_token)).status).toBe(401)
  await runtime.env.DB.prepare('UPDATE session SET expires_at = ? WHERE id = ?').bind(Date.now() + DAY_MS, identity.session.id).run()
  expect((await mcp(grant.access_token)).status).toBe(200)
  await runtime.env.DB.prepare('UPDATE oauth_access_token SET session_id = NULL WHERE client_id = ?').bind(grant.clientId).run()
  expect((await mcp(grant.access_token)).status).toBe(401)
  await runtime.env.DB.prepare('UPDATE oauth_access_token SET session_id = ?, expires_at = ? WHERE client_id = ?')
    .bind(identity.session.id, Date.now() - 1, grant.clientId).run()
  expect((await mcp(grant.access_token)).status).toBe(401)
  const missing = await runtime.worker.fetch('/mcp', { method: 'POST', body: '{}' })
  expect(missing.status).toBe(401)
  expect(missing.headers.get('www-authenticate')).toContain('oauth-protected-resource')
})
