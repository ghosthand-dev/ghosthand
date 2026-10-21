// Schema of the ghosthand.dev D1 database.
//
//   user ──< session, account, device_code          (better-auth: Google login, CLI device flow)
//   user ──< apikey                                  (tokens for scripts: HTTP API through the Mac tunnel)
//   user ──< oauth_consent, oauth_*_token >── oauth_client   (remote MCP OAuth; jwks signs tokens)
//   user ──< org_member >── org ──< stripe_customer  one per (org, Stripe account)
//                               ──< subscription     mirrored from Stripe webhooks
//
// Identity (sessions, OAuth tokens) belongs to the user; plans, the trial and the Macs'
// hub belong to the org. Every user gets a personal org at signup with org_id = user.id.
// Code must still resolve the org through org_member, never use a user id as an org id.
//
// Every Stripe row stores its Stripe account id, so a later move to another Stripe
// account keeps old subscriptions working next to new ones.

import { defineRelations } from 'drizzle-orm'
import * as s from 'drizzle-orm/sqlite-core'
import { ulid } from 'ulid'

function createdAt() {
  return s.integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date())
}

function updatedAt() {
  return s.integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date())
}

// ── better-auth ─────────────────────────────────────────────────────

export const user = s.sqliteTable('user', {
  id: s.text('id').primaryKey().$defaultFn(() => ulid()),
  name: s.text('name').notNull(),
  email: s.text('email').notNull().unique(),
  emailVerified: s.integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: s.text('image'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const session = s.sqliteTable('session', {
  id: s.text('id').primaryKey().$defaultFn(() => ulid()),
  userId: s.text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  token: s.text('token').notNull().unique(),
  expiresAt: s.integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  ipAddress: s.text('ip_address'),
  userAgent: s.text('user_agent'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  s.index('session_user_id_idx').on(table.userId),
])

export const account = s.sqliteTable('account', {
  id: s.text('id').primaryKey().$defaultFn(() => ulid()),
  userId: s.text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accountId: s.text('account_id').notNull(),
  providerId: s.text('provider_id').notNull(),
  accessToken: s.text('access_token'),
  refreshToken: s.text('refresh_token'),
  accessTokenExpiresAt: s.integer('access_token_expires_at', { mode: 'timestamp_ms' }),
  refreshTokenExpiresAt: s.integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
  scope: s.text('scope'),
  idToken: s.text('id_token'),
  password: s.text('password'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  s.index('account_user_id_idx').on(table.userId),
])

export const verification = s.sqliteTable('verification', {
  id: s.text('id').primaryKey().$defaultFn(() => ulid()),
  identifier: s.text('identifier').notNull(),
  value: s.text('value').notNull(),
  expiresAt: s.integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  s.index('verification_identifier_idx').on(table.identifier),
])

/** better-auth deviceAuthorization plugin: the daemon's login. */
export const deviceCode = s.sqliteTable('device_code', {
  id: s.text('id').primaryKey().$defaultFn(() => ulid()),
  deviceCode: s.text('device_code').notNull().unique(),
  userCode: s.text('user_code').notNull().unique(),
  userId: s.text('user_id').references(() => user.id, { onDelete: 'cascade' }),
  expiresAt: s.integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  status: s.text('status', { enum: ['pending', 'approved', 'denied', 'expired'] }).notNull().default('pending'),
  lastPolledAt: s.integer('last_polled_at', { mode: 'timestamp_ms' }),
  pollingInterval: s.integer('polling_interval', { mode: 'number' }),
  clientId: s.text('client_id'),
  scope: s.text('scope'),
}, (table) => [
  s.index('device_code_user_id_idx').on(table.userId),
])

/** better-auth api-key plugin: tokens for scripts that call the HTTP API through the Mac tunnel. */
export const apikey = s.sqliteTable('apikey', {
  id: s.text('id').primaryKey().$defaultFn(() => ulid()),
  configId: s.text('config_id').notNull().default('default'),
  name: s.text('name'),
  /** First characters of the token, to recognise it in a list. */
  start: s.text('start'),
  /** The owner: a user id. */
  referenceId: s.text('reference_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  prefix: s.text('prefix'),
  /** SHA-256 of the token. */
  key: s.text('key').notNull(),
  refillInterval: s.integer('refill_interval', { mode: 'number' }),
  refillAmount: s.integer('refill_amount', { mode: 'number' }),
  lastRefillAt: s.integer('last_refill_at', { mode: 'timestamp_ms' }),
  enabled: s.integer('enabled', { mode: 'boolean' }).default(true),
  rateLimitEnabled: s.integer('rate_limit_enabled', { mode: 'boolean' }).default(true),
  rateLimitTimeWindow: s.integer('rate_limit_time_window', { mode: 'number' }),
  rateLimitMax: s.integer('rate_limit_max', { mode: 'number' }),
  requestCount: s.integer('request_count', { mode: 'number' }).default(0),
  remaining: s.integer('remaining', { mode: 'number' }),
  lastRequest: s.integer('last_request', { mode: 'timestamp_ms' }),
  expiresAt: s.integer('expires_at', { mode: 'timestamp_ms' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  permissions: s.text('permissions'),
  metadata: s.text('metadata'),
}, (table) => [
  s.index('apikey_config_id_idx').on(table.configId),
  s.index('apikey_reference_id_idx').on(table.referenceId),
  s.index('apikey_key_idx').on(table.key),
])

// ── remote MCP OAuth (@better-auth/mcp + cimd) ─────────────────────
// Fields copy @better-auth/oauth-provider 1.7. onDelete too, except user_id and refresh_id
// cascade so deleting a user or refresh token cleans up. client_id stays NO ACTION: a CIMD
// client is one shared row (client_id is its metadata URL), CASCADE would drop every user's
// tokens. oauth_client.user_id stays NO ACTION: rebuilding oauth_client in a migration fires
// its cascade on oauth_client_resource. string[] fields are JSON text: D1 rejects array binds.

/** Signing keys left from the former JWT token provider. */
export const jwks = s.sqliteTable('jwks', {
  id: s.text('id').primaryKey().$defaultFn(() => ulid()),
  publicKey: s.text('public_key').notNull(),
  privateKey: s.text('private_key').notNull(),
  createdAt: createdAt(),
  expiresAt: s.integer('expires_at', { mode: 'timestamp_ms' }),
  alg: s.text('alg'),
  crv: s.text('crv'),
})

export const oauthClient = s.sqliteTable('oauth_client', {
  id: s.text('id').primaryKey().$defaultFn(() => ulid()),
  clientId: s.text('client_id').notNull().unique(),
  clientSecret: s.text('client_secret'),
  /** "cimd" when CIMD fetched it; NULL for admin or DCR clients. */
  clientDiscoveryId: s.text('client_discovery_id'),
  disabled: s.integer('disabled', { mode: 'boolean' }).default(false),
  skipConsent: s.integer('skip_consent', { mode: 'boolean' }),
  enableEndSession: s.integer('enable_end_session', { mode: 'boolean' }),
  subjectType: s.text('subject_type'),
  scopes: s.text('scopes', { mode: 'json' }).$type<string[]>(),
  clientCredentialsScopes: s.text('client_credentials_scopes', { mode: 'json' }).$type<string[]>(),
  userId: s.text('user_id').references(() => user.id),
  createdAt: s.integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
  updatedAt: s.integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
  name: s.text('name'),
  uri: s.text('uri'),
  icon: s.text('icon'),
  contacts: s.text('contacts', { mode: 'json' }).$type<string[]>(),
  tos: s.text('tos'),
  policy: s.text('policy'),
  softwareId: s.text('software_id'),
  softwareVersion: s.text('software_version'),
  softwareStatement: s.text('software_statement'),
  redirectUris: s.text('redirect_uris', { mode: 'json' }).$type<string[]>().notNull(),
  postLogoutRedirectUris: s.text('post_logout_redirect_uris', { mode: 'json' }).$type<string[]>(),
  backchannelLogoutUri: s.text('backchannel_logout_uri'),
  backchannelLogoutSessionRequired: s.integer('backchannel_logout_session_required', { mode: 'boolean' }),
  tokenEndpointAuthMethod: s.text('token_endpoint_auth_method'),
  applicationType: s.text('application_type'),
  jwks: s.text('jwks'),
  jwksUri: s.text('jwks_uri'),
  grantTypes: s.text('grant_types', { mode: 'json' }).$type<string[]>(),
  responseTypes: s.text('response_types', { mode: 'json' }).$type<string[]>(),
  requirePKCE: s.integer('require_pkce', { mode: 'boolean' }),
  dpopBoundAccessTokens: s.integer('dpop_bound_access_tokens', { mode: 'boolean' }).default(false),
  referenceId: s.text('reference_id'),
  metadata: s.text('metadata', { mode: 'json' }),
}, (table) => [
  s.index('oauth_client_user_id_idx').on(table.userId),
])

/** The MCP URL as a token audience (RFC 8707 resource). */
export const oauthResource = s.sqliteTable('oauth_resource', {
  id: s.text('id').primaryKey().$defaultFn(() => ulid()),
  identifier: s.text('identifier').notNull().unique(),
  name: s.text('name').notNull(),
  accessTokenTtl: s.integer('access_token_ttl', { mode: 'number' }),
  refreshTokenTtl: s.integer('refresh_token_ttl', { mode: 'number' }),
  signingAlgorithm: s.text('signing_algorithm'),
  signingKeyId: s.text('signing_key_id'),
  allowedScopes: s.text('allowed_scopes', { mode: 'json' }).$type<string[]>(),
  customClaims: s.text('custom_claims', { mode: 'json' }),
  dpopBoundAccessTokensRequired: s.integer('dpop_bound_access_tokens_required', { mode: 'boolean' }).default(false),
  disabled: s.integer('disabled', { mode: 'boolean' }).default(false),
  createdAt: s.integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
  updatedAt: s.integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
  policyVersion: s.integer('policy_version', { mode: 'number' }).default(1),
  metadata: s.text('metadata', { mode: 'json' }),
})

export const oauthClientResource = s.sqliteTable('oauth_client_resource', {
  id: s.text('id').primaryKey().$defaultFn(() => ulid()),
  clientId: s.text('client_id').notNull().references(() => oauthClient.clientId, { onDelete: 'cascade' }),
  resourceId: s.text('resource_id').notNull().references(() => oauthResource.identifier, { onDelete: 'cascade' }),
  metadata: s.text('metadata', { mode: 'json' }),
  createdAt: s.integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
}, (table) => [
  s.index('oauth_client_resource_client_id_idx').on(table.clientId),
  s.index('oauth_client_resource_resource_id_idx').on(table.resourceId),
  s.uniqueIndex('oauth_client_resource_client_id_resource_id_unique').on(table.clientId, table.resourceId),
])

export const oauthRefreshToken = s.sqliteTable('oauth_refresh_token', {
  id: s.text('id').primaryKey().$defaultFn(() => ulid()),
  token: s.text('token').notNull().unique(),
  clientId: s.text('client_id').notNull().references(() => oauthClient.clientId),
  sessionId: s.text('session_id').references(() => session.id, { onDelete: 'set null' }),
  userId: s.text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  referenceId: s.text('reference_id'),
  authorizationCodeId: s.text('authorization_code_id'),
  resources: s.text('resources', { mode: 'json' }).$type<string[]>(),
  requestedUserInfoClaims: s.text('requested_user_info_claims', { mode: 'json' }).$type<string[]>(),
  expiresAt: s.integer('expires_at', { mode: 'timestamp_ms' }),
  createdAt: s.integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
  revoked: s.integer('revoked', { mode: 'timestamp_ms' }),
  rotatedAt: s.integer('rotated_at', { mode: 'timestamp_ms' }),
  rotationReplayResponse: s.text('rotation_replay_response'),
  rotationReplayExpiresAt: s.integer('rotation_replay_expires_at', { mode: 'timestamp_ms' }),
  authTime: s.integer('auth_time', { mode: 'timestamp_ms' }),
  confirmation: s.text('confirmation', { mode: 'json' }),
  scopes: s.text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
}, (table) => [
  s.index('oauth_refresh_token_client_id_idx').on(table.clientId),
  s.index('oauth_refresh_token_session_id_idx').on(table.sessionId),
  s.index('oauth_refresh_token_user_id_idx').on(table.userId),
  s.index('oauth_refresh_token_authorization_code_id_idx').on(table.authorizationCodeId),
])

/** Revocable MCP access tokens, checked against current grants and sessions. */
export const oauthAccessToken = s.sqliteTable('oauth_access_token', {
  id: s.text('id').primaryKey().$defaultFn(() => ulid()),
  token: s.text('token').unique(),
  clientId: s.text('client_id').notNull().references(() => oauthClient.clientId),
  sessionId: s.text('session_id').references(() => session.id, { onDelete: 'set null' }),
  userId: s.text('user_id').references(() => user.id, { onDelete: 'cascade' }),
  referenceId: s.text('reference_id'),
  authorizationCodeId: s.text('authorization_code_id'),
  resources: s.text('resources', { mode: 'json' }).$type<string[]>(),
  requestedUserInfoClaims: s.text('requested_user_info_claims', { mode: 'json' }).$type<string[]>(),
  refreshId: s.text('refresh_id').references(() => oauthRefreshToken.id, { onDelete: 'cascade' }),
  expiresAt: s.integer('expires_at', { mode: 'timestamp_ms' }),
  createdAt: s.integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
  revoked: s.integer('revoked', { mode: 'timestamp_ms' }),
  confirmation: s.text('confirmation', { mode: 'json' }),
  scopes: s.text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
}, (table) => [
  s.index('oauth_access_token_client_id_idx').on(table.clientId),
  s.index('oauth_access_token_session_id_idx').on(table.sessionId),
  s.index('oauth_access_token_user_id_idx').on(table.userId),
  s.index('oauth_access_token_authorization_code_id_idx').on(table.authorizationCodeId),
  s.index('oauth_access_token_refresh_id_idx').on(table.refreshId),
])

export const oauthConsent = s.sqliteTable('oauth_consent', {
  id: s.text('id').primaryKey().$defaultFn(() => ulid()),
  clientId: s.text('client_id').notNull().references(() => oauthClient.clientId),
  userId: s.text('user_id').references(() => user.id, { onDelete: 'cascade' }),
  referenceId: s.text('reference_id'),
  resources: s.text('resources', { mode: 'json' }).$type<string[]>(),
  requestedUserInfoClaims: s.text('requested_user_info_claims', { mode: 'json' }).$type<string[]>(),
  scopes: s.text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
  createdAt: s.integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
  updatedAt: s.integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
}, (table) => [
  s.index('oauth_consent_client_id_idx').on(table.clientId),
  s.index('oauth_consent_user_id_idx').on(table.userId),
])

/** Single-use private_key_jwt assertion ids (replay guard). */
export const oauthClientAssertion = s.sqliteTable('oauth_client_assertion', {
  id: s.text('id').primaryKey(),
  expiresAt: s.integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
})

// ── orgs ────────────────────────────────────────────────────────────

/** Owns the plan, the trial (from createdAt) and the hub of Macs. Personal: org_id = user.id. */
export const org = s.sqliteTable('org', {
  orgId: s.text('org_id').primaryKey().$defaultFn(() => ulid()),
  name: s.text('name').notNull(),
  kind: s.text('kind', { enum: ['personal', 'team'] }).notNull().default('personal'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const orgMember = s.sqliteTable('org_member', {
  orgMemberId: s.text('org_member_id').primaryKey().$defaultFn(() => ulid()),
  orgId: s.text('org_id').notNull().references(() => org.orgId, { onDelete: 'cascade' }),
  userId: s.text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  role: s.text('role', { enum: ['admin', 'member'] }).notNull().default('member'),
  createdAt: createdAt(),
}, (table) => [
  s.index('org_member_org_id_idx').on(table.orgId),
  s.index('org_member_user_id_idx').on(table.userId),
  s.uniqueIndex('org_member_org_id_user_id_unique').on(table.orgId, table.userId),
])

// ── Stripe ──────────────────────────────────────────────────────────

/** One Stripe customer per (org, Stripe account). The only place customer ids live. */
export const stripeCustomer = s.sqliteTable('stripe_customer', {
  stripeCustomerId: s.text('stripe_customer_id').primaryKey(),
  orgId: s.text('org_id').notNull().references(() => org.orgId, { onDelete: 'cascade' }),
  stripeAccountId: s.text('stripe_account_id').notNull(),
  createdAt: createdAt(),
}, (table) => [
  s.uniqueIndex('stripe_customer_org_account_unique').on(table.orgId, table.stripeAccountId),
])

/** Mirror of a Stripe subscription, upserted by the webhook. */
export const subscription = s.sqliteTable('subscription', {
  subscriptionId: s.text('subscription_id').primaryKey(),
  orgId: s.text('org_id').notNull().references(() => org.orgId, { onDelete: 'cascade' }),
  stripeAccountId: s.text('stripe_account_id').notNull(),
  stripeCustomerId: s.text('stripe_customer_id').notNull(),
  priceId: s.text('price_id').notNull(),
  productId: s.text('product_id').notNull(),
  /** Stripe status: active, past_due, canceled, incomplete, unpaid, ... */
  status: s.text('status').notNull(),
  currentPeriodEnd: s.integer('current_period_end', { mode: 'timestamp_ms' }),
  cancelAtPeriodEnd: s.integer('cancel_at_period_end', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  s.index('subscription_org_id_idx').on(table.orgId),
])

export const relations = defineRelations(
  {
    user, session, account, verification, deviceCode, apikey,
    jwks, oauthClient, oauthResource, oauthClientResource, oauthRefreshToken, oauthAccessToken, oauthConsent, oauthClientAssertion,
    org, orgMember, stripeCustomer, subscription,
  },
  (r) => ({
    user: {
      sessions: r.many.session(),
      accounts: r.many.account(),
      deviceCodes: r.many.deviceCode(),
      apikeys: r.many.apikey(),
      oauthClients: r.many.oauthClient(),
      oauthRefreshTokens: r.many.oauthRefreshToken(),
      oauthAccessTokens: r.many.oauthAccessToken(),
      oauthConsents: r.many.oauthConsent(),
      memberships: r.many.orgMember(),
    },
    session: {
      user: r.one.user({ from: r.session.userId, to: r.user.id }),
      oauthRefreshTokens: r.many.oauthRefreshToken(),
      oauthAccessTokens: r.many.oauthAccessToken(),
    },
    account: {
      user: r.one.user({ from: r.account.userId, to: r.user.id }),
    },
    deviceCode: {
      user: r.one.user({ from: r.deviceCode.userId, to: r.user.id }),
    },
    apikey: {
      user: r.one.user({ from: r.apikey.referenceId, to: r.user.id }),
    },
    oauthClient: {
      user: r.one.user({ from: r.oauthClient.userId, to: r.user.id }),
      resources: r.many.oauthResource({
        from: r.oauthClient.clientId.through(r.oauthClientResource.clientId),
        to: r.oauthResource.identifier.through(r.oauthClientResource.resourceId),
      }),
      refreshTokens: r.many.oauthRefreshToken(),
      accessTokens: r.many.oauthAccessToken(),
      consents: r.many.oauthConsent(),
    },
    oauthResource: {
      clients: r.many.oauthClient({
        from: r.oauthResource.identifier.through(r.oauthClientResource.resourceId),
        to: r.oauthClient.clientId.through(r.oauthClientResource.clientId),
      }),
    },
    oauthClientResource: {
      client: r.one.oauthClient({ from: r.oauthClientResource.clientId, to: r.oauthClient.clientId }),
      resource: r.one.oauthResource({ from: r.oauthClientResource.resourceId, to: r.oauthResource.identifier }),
    },
    oauthRefreshToken: {
      client: r.one.oauthClient({ from: r.oauthRefreshToken.clientId, to: r.oauthClient.clientId }),
      user: r.one.user({ from: r.oauthRefreshToken.userId, to: r.user.id }),
      session: r.one.session({ from: r.oauthRefreshToken.sessionId, to: r.session.id }),
      accessTokens: r.many.oauthAccessToken(),
    },
    oauthAccessToken: {
      client: r.one.oauthClient({ from: r.oauthAccessToken.clientId, to: r.oauthClient.clientId }),
      user: r.one.user({ from: r.oauthAccessToken.userId, to: r.user.id }),
      session: r.one.session({ from: r.oauthAccessToken.sessionId, to: r.session.id }),
      refreshToken: r.one.oauthRefreshToken({ from: r.oauthAccessToken.refreshId, to: r.oauthRefreshToken.id }),
    },
    oauthConsent: {
      client: r.one.oauthClient({ from: r.oauthConsent.clientId, to: r.oauthClient.clientId }),
      user: r.one.user({ from: r.oauthConsent.userId, to: r.user.id }),
    },
    org: {
      members: r.many.orgMember(),
      stripeCustomers: r.many.stripeCustomer(),
      subscriptions: r.many.subscription(),
    },
    orgMember: {
      org: r.one.org({ from: r.orgMember.orgId, to: r.org.orgId }),
      user: r.one.user({ from: r.orgMember.userId, to: r.user.id }),
    },
    stripeCustomer: {
      org: r.one.org({ from: r.stripeCustomer.orgId, to: r.org.orgId }),
    },
    subscription: {
      org: r.one.org({ from: r.subscription.orgId, to: r.org.orgId }),
    },
  }),
)
