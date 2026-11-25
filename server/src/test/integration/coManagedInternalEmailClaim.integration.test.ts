import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import User from '@alga-psa/db/models/user';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';
import { getSecret } from '../../lib/utils/getSecret';

/**
 * `User.findInternalEmailClaim` on real SQL. The defect this guards is invisible on plain PostgreSQL:
 * the claim once joined `co_managed_provisioning_operations` (distributed on the sponsor `tenant`) to
 * `user_invitations` on `customer_tenant`, which Citus refuses with 0A000 ("complex joins are only
 * supported when all distributed tables are co-located and joined on their distribution columns").
 * The Citus runtime runner supplies TEST_DB_BACKEND and TEST_MIGRATIONS_DIR, so these same cases run
 * against a distributed schema there; case 1 is the one that fails with the production error.
 */
let db: Knex;
const databaseName = `internal_email_claim_test_${randomUUID().replaceAll('-', '')}`;

beforeAll(async () => {
  db = await createTestDbConnection({ databaseName, runSeeds: false });
}, 300_000);

afterAll(async () => {
  await db?.destroy();
  const admin = knex({ client: 'pg', connection: {
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER_ADMIN || 'postgres',
    password: await getSecret('postgres_password', 'DB_PASSWORD_ADMIN', 'postpass123'), database: 'postgres',
  }, pool: { min: 0, max: 1 } });
  try { await admin.raw('DROP DATABASE IF EXISTS ??', [databaseName]); }
  finally { await admin.destroy(); }
});

const emailFor = () => `admin-${randomUUID()}@example.test`;

/** A sponsor, its co-managed setup for a new customer workspace, and (optionally) that setup's invitation. */
async function setup(options: {
  email: string;
  state?: string;
  invitation?: 'none' | 'unused' | 'used';
  sponsor?: string;
  createdAt?: string;
}) {
  const sponsor = options.sponsor ?? await createTenant(db, 'Claim sponsor');
  const customerTenant = await createTenant(db, 'Claim customer workspace');
  const operationId = randomUUID();
  const invitationId = randomUUID();
  if (options.invitation && options.invitation !== 'none') {
    await db('user_invitations').insert({
      tenant: customerTenant, invitation_id: invitationId, email: options.email, email_normalized: options.email.trim().toLowerCase(), first_name: 'Initial', last_name: 'Administrator',
      token: randomUUID(), expires_at: db.raw("now() + interval '1 day'"),
      used_at: options.invitation === 'used' ? db.fn.now() : null,
    });
  }
  await db('co_managed_provisioning_operations').insert({
    tenant: sponsor, operation_id: operationId, allocation_id: randomUUID(), customer_tenant: customerTenant,
    relationship_id: randomUUID(), requested_by: randomUUID(), escalation_board_id: randomUUID(),
    customer_board_id: randomUUID(), customer_client_id: randomUUID(), administrator_invitation_id: invitationId,
    request_fingerprint: 'a'.repeat(64), request: { administrator: { email: options.email } },
    state: options.state ?? 'queued', ...(options.createdAt ? { created_at: options.createdAt } : {}),
  });
  return { sponsor, customerTenant, operationId, invitationId };
}

describe('User.findInternalEmailClaim', () => {
  // 1. The production repro: a queued setup whose worker has not yet created the invitation.
  it('claims the email for a queued setup that has no invitation yet, with no cross-tenant join', async () => {
    const email = emailFor();
    const queued = await setup({ email, state: 'queued', invitation: 'none' });
    await expect(User.findInternalEmailClaim(email, { db })).resolves.toEqual({
      kind: 'pending_administrator', tenant: queued.customerTenant,
    });
    // Whitespace and case in the address do not matter on either side.
    await expect(User.findInternalEmailClaim(`  ${email.toUpperCase()} `, { db })).resolves.toMatchObject({ kind: 'pending_administrator' });
  });

  it('claims for provisioning and failed setups without an invitation, but not for a setup past that step', async () => {
    for (const state of ['provisioning', 'failed']) {
      const email = emailFor();
      const row = await setup({ email, state, invitation: 'none' });
      await expect(User.findInternalEmailClaim(email, { db }), state).resolves.toEqual({ kind: 'pending_administrator', tenant: row.customerTenant });
    }
    for (const state of ['pending_acceptance', 'cancelled', 'cleanup_requested']) {
      const email = emailFor();
      await setup({ email, state, invitation: 'none' });
      await expect(User.findInternalEmailClaim(email, { db }), state).resolves.toBeNull();
    }
  });

  // 2. An unused invitation claims the email whatever the setup's state.
  it('claims the email while the setup\'s invitation is unused', async () => {
    for (const state of ['pending_acceptance', 'failed', 'cancelled']) {
      const email = emailFor();
      const row = await setup({ email, state, invitation: 'unused' });
      await expect(User.findInternalEmailClaim(email, { db }), state).resolves.toEqual({ kind: 'pending_administrator', tenant: row.customerTenant });
    }
  });

  // 3. A used invitation means the administrator signed up (a user exists), so the setup no longer claims it.
  it('does not claim the email once the invitation is used', async () => {
    for (const state of ['pending_acceptance', 'failed', 'queued']) {
      const email = emailFor();
      await setup({ email, state, invitation: 'used' });
      await expect(User.findInternalEmailClaim(email, { db }), state).resolves.toBeNull();
    }
  });

  // 4. An internal user anywhere on the platform holds the address, and wins over a pending setup.
  it('reports an internal user in another tenant, ahead of a pending setup', async () => {
    const email = emailFor();
    const holderTenant = await createTenant(db, 'Existing user tenant');
    const userId = await createUser(db, holderTenant, { email, user_type: 'internal' });
    await setup({ email, state: 'queued', invitation: 'none' });
    await expect(User.findInternalEmailClaim(email, { db })).resolves.toEqual({ kind: 'user', tenant: holderTenant, userId });
    // A client-type user with the same address does not hold an internal email.
    const clientEmail = emailFor();
    await createUser(db, holderTenant, { email: clientEmail, user_type: 'client' });
    await expect(User.findInternalEmailClaim(clientEmail, { db })).resolves.toBeNull();
  });

  // 5. The exclusions each narrow their own query.
  it('honours excludeTenant, excludeOperationId and excludeUserId', async () => {
    const email = emailFor();
    const row = await setup({ email, state: 'queued', invitation: 'none' });
    await expect(User.findInternalEmailClaim(email, { db, excludeTenant: row.customerTenant })).resolves.toBeNull();
    await expect(User.findInternalEmailClaim(email, { db, excludeOperationId: row.operationId })).resolves.toBeNull();
    await expect(User.findInternalEmailClaim(email, { db, excludeTenant: randomUUID(), excludeOperationId: randomUUID() }))
      .resolves.toEqual({ kind: 'pending_administrator', tenant: row.customerTenant });

    const userEmail = emailFor();
    const holderTenant = await createTenant(db, 'Excluded user tenant');
    const userId = await createUser(db, holderTenant, { email: userEmail, user_type: 'internal' });
    await expect(User.findInternalEmailClaim(userEmail, { db, excludeUserId: userId })).resolves.toBeNull();
    await expect(User.findInternalEmailClaim(userEmail, { db, excludeUserId: randomUUID() })).resolves.toMatchObject({ kind: 'user', userId });
  });

  // 6. Nothing holds the address.
  it('returns null for an email nothing claims', async () => {
    await expect(User.findInternalEmailClaim(emailFor(), { db })).resolves.toBeNull();
  });

  // The old `.first()` was arbitrary; the answer is now the earliest setup, then the operation id.
  it('answers with the earliest matching setup when several claim the address', async () => {
    const email = emailFor();
    const sponsor = await createTenant(db, 'Ordering sponsor');
    const later = await setup({ email, sponsor, state: 'queued', invitation: 'none', createdAt: '2026-02-01T00:00:00Z' });
    const earlier = await setup({ email, sponsor, state: 'pending_acceptance', invitation: 'unused', createdAt: '2026-01-01T00:00:00Z' });
    await expect(User.findInternalEmailClaim(email, { db })).resolves.toEqual({ kind: 'pending_administrator', tenant: earlier.customerTenant });
    await expect(User.findInternalEmailClaim(email, { db, excludeOperationId: earlier.operationId }))
      .resolves.toEqual({ kind: 'pending_administrator', tenant: later.customerTenant });
  });

  // A setup whose invitation is used does not hide another setup that still claims the address.
  it('skips a setup with a used invitation and still finds another that claims the address', async () => {
    const email = emailFor();
    const sponsor = await createTenant(db, 'Mixed sponsor');
    await setup({ email, sponsor, state: 'pending_acceptance', invitation: 'used', createdAt: '2026-01-01T00:00:00Z' });
    const open = await setup({ email, sponsor, state: 'queued', invitation: 'none', createdAt: '2026-02-01T00:00:00Z' });
    await expect(User.findInternalEmailClaim(email, { db })).resolves.toEqual({ kind: 'pending_administrator', tenant: open.customerTenant });
  });
});
