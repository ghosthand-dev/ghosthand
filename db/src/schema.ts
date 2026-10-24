// Schema of the ghosthand.dev Postgres database (PlanetScale, reached through Hyperdrive).
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
import * as p from 'drizzle-orm/pg-core'
import { ulid } from 'ulid'

function timestamp(name: string) {
  return p.timestamp(name, { withTimezone: true, mode: 'date' })
}

function createdAt() {
  return timestamp('created_at').notNull().$defaultFn(() => new Date())
}

function updatedAt() {
  return timestamp('updated_at').notNull().$defaultFn(() => new Date())
}

// ── better-auth ─────────────────────────────────────────────────────

export const user = p.pgTable('user', {
  id: p.text('id').primaryKey().$defaultFn(() => ulid()),
  name: p.text('name').notNull(),
  email: p.text('email').notNull().unique(),
  emailVerified: p.boolean('email_verified').notNull().default(false),
  image: p.text('image'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const session = p.pgTable('session', {
  id: p.text('id').primaryKey().$defaultFn(() => ulid()),
  userId: p.text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  token: p.text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  ipAddress: p.text('ip_address'),
  userAgent: p.text('user_agent'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  p.index('session_user_id_idx').on(table.userId),
])

export const account = p.pgTable('account', {
  id: p.text('id').primaryKey().$defaultFn(() => ulid()),
  userId: p.text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accountId: p.text('account_id').notNull(),
  providerId: p.text('provider_id').notNull(),
  accessToken: p.text('access_token'),
  refreshToken: p.text('refresh_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: p.text('scope'),
  idToken: p.text('id_token'),
  password: p.text('password'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  p.index('account_user_id_idx').on(table.userId),
])

export const verification = p.pgTable('verification', {
  id: p.text('id').primaryKey().$defaultFn(() => ulid()),
  identifier: p.text('identifier').notNull(),
  value: p.text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  p.index('verification_identifier_idx').on(table.identifier),
])

/** better-auth deviceAuthorization plugin: the daemon's login. */
export const deviceCode = p.pgTable('device_code', {
  id: p.text('id').primaryKey().$defaultFn(() => ulid()),
  deviceCode: p.text('device_code').notNull().unique(),
  userCode: p.text('user_code').notNull().unique(),
  userId: p.text('user_id').references(() => user.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
  status: p.text('status', { enum: ['pending', 'approved', 'denied', 'expired'] }).notNull().default('pending'),
  lastPolledAt: timestamp('last_polled_at'),
  pollingInterval: p.integer('polling_interval'),
  clientId: p.text('client_id'),
  scope: p.text('scope'),
}, (table) => [
  p.index('device_code_user_id_idx').on(table.userId),
])

/** better-auth api-key plugin: tokens for scripts that call the HTTP API through the Mac tunnel. */
export const apikey = p.pgTable('apikey', {
  id: p.text('id').primaryKey().$defaultFn(() => ulid()),
  configId: p.text('config_id').notNull().default('default'),
  name: p.text('name'),
  /** First characters of the token, to recognise it in a list. */
  start: p.text('start'),
  /** The owner: a user id. */
  referenceId: p.text('reference_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  prefix: p.text('prefix'),
  /** SHA-256 of the token. */
  key: p.text('key').notNull(),
  refillInterval: p.integer('refill_interval'),
  refillAmount: p.integer('refill_amount'),
  lastRefillAt: timestamp('last_refill_at'),
  enabled: p.boolean('enabled').default(true),
  rateLimitEnabled: p.boolean('rate_limit_enabled').default(true),
  rateLimitTimeWindow: p.integer('rate_limit_time_window'),
  rateLimitMax: p.integer('rate_limit_max'),
  requestCount: p.integer('request_count').default(0),
  remaining: p.integer('remaining'),
  lastRequest: timestamp('last_request'),
  expiresAt: timestamp('expires_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  permissions: p.text('permissions'),
  metadata: p.text('metadata'),
}, (table) => [
  p.index('apikey_config_id_idx').on(table.configId),
  p.index('apikey_reference_id_idx').on(table.referenceId),
  p.index('apikey_key_idx').on(table.key),
])

// ── remote MCP OAuth (@better-auth/mcp + cimd) ─────────────────────
// Fields copy @better-auth/oauth-provider 1.7. onDelete too, except user_id and refresh_id
// cascade so deleting a user or refresh token cleans up. client_id stays NO ACTION: a CIMD
// client is one shared row (client_id is its metadata URL), CASCADE would drop every user's
// tokens. oauth_client.user_id stays NO ACTION, as on D1 (where a rebuild would cascade).
// string[] fields are text[], json fields jsonb: the adapter leaves both to drizzle.

/** Signing keys left from the former JWT token provider. */
export const jwks = p.pgTable('jwks', {
  id: p.text('id').primaryKey().$defaultFn(() => ulid()),
  publicKey: p.text('public_key').notNull(),
  privateKey: p.text('private_key').notNull(),
  createdAt: createdAt(),
  expiresAt: timestamp('expires_at'),
  alg: p.text('alg'),
  crv: p.text('crv'),
})

export const oauthClient = p.pgTable('oauth_client', {
  id: p.text('id').primaryKey().$defaultFn(() => ulid()),
  clientId: p.text('client_id').notNull().unique(),
  clientSecret: p.text('client_secret'),
  /** "cimd" when CIMD fetched it; NULL for admin or DCR clients. */
  clientDiscoveryId: p.text('client_discovery_id'),
  disabled: p.boolean('disabled').default(false),
  skipConsent: p.boolean('skip_consent'),
  enableEndSession: p.boolean('enable_end_session'),
  subjectType: p.text('subject_type'),
  scopes: p.text('scopes').array(),
  clientCredentialsScopes: p.text('client_credentials_scopes').array(),
  userId: p.text('user_id').references(() => user.id),
  createdAt: timestamp('created_at').$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').$defaultFn(() => new Date()),
  name: p.text('name'),
  uri: p.text('uri'),
  icon: p.text('icon'),
  contacts: p.text('contacts').array(),
  tos: p.text('tos'),
  policy: p.text('policy'),
  softwareId: p.text('software_id'),
  softwareVersion: p.text('software_version'),
  softwareStatement: p.text('software_statement'),
  redirectUris: p.text('redirect_uris').array().notNull(),
  postLogoutRedirectUris: p.text('post_logout_redirect_uris').array(),
  backchannelLogoutUri: p.text('backchannel_logout_uri'),
  backchannelLogoutSessionRequired: p.boolean('backchannel_logout_session_required'),
  tokenEndpointAuthMethod: p.text('token_endpoint_auth_method'),
  applicationType: p.text('application_type'),
  jwks: p.text('jwks'),
  jwksUri: p.text('jwks_uri'),
  grantTypes: p.text('grant_types').array(),
  responseTypes: p.text('response_types').array(),
  requirePKCE: p.boolean('require_pkce'),
  dpopBoundAccessTokens: p.boolean('dpop_bound_access_tokens').default(false),
  referenceId: p.text('reference_id'),
  metadata: p.jsonb('metadata'),
}, (table) => [
  p.index('oauth_client_user_id_idx').on(table.userId),
])

/** The MCP URL as a token audience (RFC 8707 resource). */
export const oauthResource = p.pgTable('oauth_resource', {
  id: p.text('id').primaryKey().$defaultFn(() => ulid()),
  identifier: p.text('identifier').notNull().unique(),
  name: p.text('name').notNull(),
  accessTokenTtl: p.integer('access_token_ttl'),
  refreshTokenTtl: p.integer('refresh_token_ttl'),
  signingAlgorithm: p.text('signing_algorithm'),
  signingKeyId: p.text('signing_key_id'),
  allowedScopes: p.text('allowed_scopes').array(),
  customClaims: p.jsonb('custom_claims'),
  dpopBoundAccessTokensRequired: p.boolean('dpop_bound_access_tokens_required').default(false),
  disabled: p.boolean('disabled').default(false),
  createdAt: timestamp('created_at').$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').$defaultFn(() => new Date()),
  policyVersion: p.integer('policy_version').default(1),
  metadata: p.jsonb('metadata'),
})

export const oauthClientResource = p.pgTable('oauth_client_resource', {
  id: p.text('id').primaryKey().$defaultFn(() => ulid()),
  clientId: p.text('client_id').notNull().references(() => oauthClient.clientId, { onDelete: 'cascade' }),
  resourceId: p.text('resource_id').notNull().references(() => oauthResource.identifier, { onDelete: 'cascade' }),
  metadata: p.jsonb('metadata'),
  createdAt: timestamp('created_at').$defaultFn(() => new Date()),
}, (table) => [
  p.index('oauth_client_resource_client_id_idx').on(table.clientId),
  p.index('oauth_client_resource_resource_id_idx').on(table.resourceId),
  p.uniqueIndex('oauth_client_resource_client_id_resource_id_unique').on(table.clientId, table.resourceId),
])

export const oauthRefreshToken = p.pgTable('oauth_refresh_token', {
  id: p.text('id').primaryKey().$defaultFn(() => ulid()),
  token: p.text('token').notNull().unique(),
  clientId: p.text('client_id').notNull().references(() => oauthClient.clientId),
  sessionId: p.text('session_id').references(() => session.id, { onDelete: 'set null' }),
  userId: p.text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  referenceId: p.text('reference_id'),
  authorizationCodeId: p.text('authorization_code_id'),
  resources: p.text('resources').array(),
  requestedUserInfoClaims: p.text('requested_user_info_claims').array(),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').$defaultFn(() => new Date()),
  revoked: timestamp('revoked'),
  rotatedAt: timestamp('rotated_at'),
  rotationReplayResponse: p.text('rotation_replay_response'),
  rotationReplayExpiresAt: timestamp('rotation_replay_expires_at'),
  authTime: timestamp('auth_time'),
  confirmation: p.jsonb('confirmation'),
  scopes: p.text('scopes').array().notNull(),
}, (table) => [
  p.index('oauth_refresh_token_client_id_idx').on(table.clientId),
  p.index('oauth_refresh_token_session_id_idx').on(table.sessionId),
  p.index('oauth_refresh_token_user_id_idx').on(table.userId),
  p.index('oauth_refresh_token_authorization_code_id_idx').on(table.authorizationCodeId),
])

/** Revocable MCP access tokens, checked against current grants and sessions. */
export const oauthAccessToken = p.pgTable('oauth_access_token', {
  id: p.text('id').primaryKey().$defaultFn(() => ulid()),
  token: p.text('token').unique(),
  clientId: p.text('client_id').notNull().references(() => oauthClient.clientId),
  sessionId: p.text('session_id').references(() => session.id, { onDelete: 'set null' }),
  userId: p.text('user_id').references(() => user.id, { onDelete: 'cascade' }),
  referenceId: p.text('reference_id'),
  authorizationCodeId: p.text('authorization_code_id'),
  resources: p.text('resources').array(),
  requestedUserInfoClaims: p.text('requested_user_info_claims').array(),
  refreshId: p.text('refresh_id').references(() => oauthRefreshToken.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').$defaultFn(() => new Date()),
  revoked: timestamp('revoked'),
  confirmation: p.jsonb('confirmation'),
  scopes: p.text('scopes').array().notNull(),
}, (table) => [
  p.index('oauth_access_token_client_id_idx').on(table.clientId),
  p.index('oauth_access_token_session_id_idx').on(table.sessionId),
  p.index('oauth_access_token_user_id_idx').on(table.userId),
  p.index('oauth_access_token_authorization_code_id_idx').on(table.authorizationCodeId),
  p.index('oauth_access_token_refresh_id_idx').on(table.refreshId),
])

export const oauthConsent = p.pgTable('oauth_consent', {
  id: p.text('id').primaryKey().$defaultFn(() => ulid()),
  clientId: p.text('client_id').notNull().references(() => oauthClient.clientId),
  userId: p.text('user_id').references(() => user.id, { onDelete: 'cascade' }),
  referenceId: p.text('reference_id'),
  resources: p.text('resources').array(),
  requestedUserInfoClaims: p.text('requested_user_info_claims').array(),
  scopes: p.text('scopes').array().notNull(),
  createdAt: timestamp('created_at').$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').$defaultFn(() => new Date()),
}, (table) => [
  p.index('oauth_consent_client_id_idx').on(table.clientId),
  p.index('oauth_consent_user_id_idx').on(table.userId),
])

/** Single-use private_key_jwt assertion ids (replay guard). */
export const oauthClientAssertion = p.pgTable('oauth_client_assertion', {
  id: p.text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
})

// ── orgs ────────────────────────────────────────────────────────────

/** Owns the plan, the trial (from createdAt) and the hub of Macs. Personal: org_id = user.id. */
export const org = p.pgTable('org', {
  orgId: p.text('org_id').primaryKey().$defaultFn(() => ulid()),
  name: p.text('name').notNull(),
  kind: p.text('kind', { enum: ['personal', 'team'] }).notNull().default('personal'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const orgMember = p.pgTable('org_member', {
  orgMemberId: p.text('org_member_id').primaryKey().$defaultFn(() => ulid()),
  orgId: p.text('org_id').notNull().references(() => org.orgId, { onDelete: 'cascade' }),
  userId: p.text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  role: p.text('role', { enum: ['admin', 'member'] }).notNull().default('member'),
  createdAt: createdAt(),
}, (table) => [
  p.index('org_member_org_id_idx').on(table.orgId),
  p.index('org_member_user_id_idx').on(table.userId),
  p.uniqueIndex('org_member_org_id_user_id_unique').on(table.orgId, table.userId),
])

// ── Stripe ──────────────────────────────────────────────────────────

/** One Stripe customer per (org, Stripe account). The only place customer ids live. */
export const stripeCustomer = p.pgTable('stripe_customer', {
  stripeCustomerId: p.text('stripe_customer_id').primaryKey(),
  orgId: p.text('org_id').notNull().references(() => org.orgId, { onDelete: 'cascade' }),
  stripeAccountId: p.text('stripe_account_id').notNull(),
  createdAt: createdAt(),
}, (table) => [
  p.uniqueIndex('stripe_customer_org_account_unique').on(table.orgId, table.stripeAccountId),
])

/** Mirror of a Stripe subscription, upserted by the webhook. */
export const subscription = p.pgTable('subscription', {
  subscriptionId: p.text('subscription_id').primaryKey(),
  orgId: p.text('org_id').notNull().references(() => org.orgId, { onDelete: 'cascade' }),
  stripeAccountId: p.text('stripe_account_id').notNull(),
  stripeCustomerId: p.text('stripe_customer_id').notNull(),
  priceId: p.text('price_id').notNull(),
  productId: p.text('product_id').notNull(),
  /** Stripe status: active, past_due, canceled, incomplete, unpaid, ... */
  status: p.text('status').notNull(),
  currentPeriodEnd: timestamp('current_period_end'),
  cancelAtPeriodEnd: p.boolean('cancel_at_period_end').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  p.index('subscription_org_id_idx').on(table.orgId),
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
