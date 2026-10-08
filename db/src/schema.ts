// Schema of the ghosthand.dev D1 database.
//
//   user ──< session, account, device_code          (better-auth: Google login, CLI device flow)
//   user ──< org_member >── org
//                           org ──< stripe_customer  one per (org, Stripe account)
//                           org ──< subscription     mirrored from Stripe webhooks
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

// ── orgs ────────────────────────────────────────────────────────────

/** Billing owner. Each user gets one org on first need; teams can join it later. */
export const org = s.sqliteTable('org', {
  orgId: s.text('org_id').primaryKey().$defaultFn(() => ulid()),
  name: s.text('name').notNull(),
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
  // One org per user for now; also makes concurrent ensureOrg calls race-safe.
  s.uniqueIndex('org_member_user_id_unique').on(table.userId),
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
  { user, session, account, verification, deviceCode, org, orgMember, stripeCustomer, subscription },
  (r) => ({
    user: {
      sessions: r.many.session(),
      accounts: r.many.account(),
      memberships: r.many.orgMember(),
    },
    session: {
      user: r.one.user({ from: r.session.userId, to: r.user.id }),
    },
    account: {
      user: r.one.user({ from: r.account.userId, to: r.user.id }),
    },
    deviceCode: {
      user: r.one.user({ from: r.deviceCode.userId, to: r.user.id }),
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
