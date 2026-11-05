import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import knex, { type Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { getSecret } from '../../lib/utils/getSecret';

// Plan §6.2: the wizard reports active internal users + pending invitations
// (used_at IS NULL AND expires_at > now(), tenant-scoped) — the seats
// sendUserInvitation reserves. Accepted (used) and expired invitations are not
// pending; an accepted invitee is an active user, counted once.

const context = vi.hoisted(() => ({ tenant: '', db: null as any }));
vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/auth')>(),
  withAuth: (fn: any) => (...args: any[]) =>
    fn({ user_id: 'admin', tenant: context.tenant, user_type: 'internal' }, { tenant: context.tenant }, ...args),
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/db')>(),
  createTenantKnex: async () => ({ knex: context.db, tenant: context.tenant }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { getOnboardingLicenseUsage } from '../../../../packages/onboarding/src/actions/onboarding-actions/onboardingActions';
import { countPendingInvitationSeats } from '../../../../packages/users/src/lib/internalUserLicenseGuard';
import { countCoManagedCommittedSeats } from '../../../../packages/licensing/src/lib/co-managed-admission';

let db: Knex;
const databaseName = `onboarding_pending_seats_test_${randomUUID().replaceAll('-', '')}`;

beforeAll(async () => {
  db = await createTestDbConnection({ databaseName, runSeeds: false });
  context.db = db;
}, 180_000);

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

async function seedTenant(): Promise<string> {
  const tenant = randomUUID();
  await db('tenants').insert({ tenant, client_name: 'Seats', email: `${tenant}@example.test`, product_code: 'psa', licensed_user_count: 5 });
  return tenant;
}
const seedUser = (tenant: string, email: string) => db('users').insert({
  tenant, user_id: randomUUID(), username: email, email, first_name: 'T', last_name: 'U',
  user_type: 'internal', hashed_password: 'unused', is_inactive: false,
});
const seedInvitation = (tenant: string, email: string, expires: string, used: boolean) => db('user_invitations').insert({
  tenant, email, email_normalized: email.trim().toLowerCase(), invited_user_id: null,
  first_name: 'I', last_name: 'V', token: randomUUID(),
  expires_at: db.raw(`now() + interval '${expires}'`), used_at: used ? db.fn.now() : null,
});

it('counts active users plus pending invitations only', async () => {
  const tenant = context.tenant = await seedTenant();
  await seedUser(tenant, 'active@example.test');
  await seedInvitation(tenant, 'pending@example.test', '1 day', false);
  await seedInvitation(tenant, 'expired@example.test', '-1 day', false);
  await seedInvitation(tenant, 'used@example.test', '1 day', true);

  const other = await seedTenant();
  await seedInvitation(other, 'other-tenant@example.test', '1 day', false);

  expect(await countPendingInvitationSeats(db, tenant)).toBe(1);
  expect(await countPendingInvitationSeats(db, tenant, { excludeEmail: 'pending@example.test' })).toBe(0);
  await expect(getOnboardingLicenseUsage()).resolves.toEqual({ success: true, data: { limit: 5, used: 2 } });
});

it('does not count an invitee twice once they accept', async () => {
  const tenant = context.tenant = await seedTenant();
  await seedInvitation(tenant, 'new@example.test', '1 day', false);
  await expect(getOnboardingLicenseUsage()).resolves.toMatchObject({ data: { used: 1 } });

  await seedUser(tenant, 'new@example.test');
  await db('user_invitations').where({ tenant, email: 'new@example.test' }).update({ used_at: db.fn.now() });
  await expect(getOnboardingLicenseUsage()).resolves.toMatchObject({ data: { used: 1 } });
});

it('keeps committed usage stable when a member changes email and consumes one linked reservation atomically', async () => {
  const tenant = context.tenant = await seedTenant();
  const userId = randomUUID();
  await db('users').insert({ tenant, user_id: userId, username: 'old@example.test', email: 'old@example.test',
    first_name: 'T', last_name: 'U', user_type: 'internal', hashed_password: 'unused', is_inactive: false });
  const invitationId = randomUUID();
  await db('user_invitations').insert({ tenant, invitation_id: randomUUID(), email: 'a@example.test',
    email_normalized: 'a@example.test', invited_user_id: null, first_name: 'A', last_name: 'V', token: randomUUID(),
    expires_at: db.raw("now() + interval '1 day'") });
  await db('user_invitations').insert({ tenant, invitation_id: invitationId, email: 'invite@example.test',
    email_normalized: 'invite@example.test', invited_user_id: null, first_name: 'I', last_name: 'V', token: randomUUID(),
    expires_at: db.raw("now() + interval '1 day'") });
  await db('user_invitations').insert({ tenant, invitation_id: randomUUID(), email: 'invite@example.test',
    email_normalized: 'invite@example.test', invited_user_id: null, first_name: 'I', last_name: 'V', token: randomUUID(),
    expires_at: db.raw("now() + interval '1 day'") });

  const committedBefore = await db.transaction(trx => countCoManagedCommittedSeats(trx, tenant));
  // This used to make the matching pending reservation disappear from usage.
  await db('users').where({ tenant, user_id: userId }).update({ email: 'a@example.test' });
  const committedAfter = await db.transaction(trx => countCoManagedCommittedSeats(trx, tenant));
  expect(committedBefore).toBe(3);
  expect(committedAfter).toBe(committedBefore);

  const rolledBackUserId = randomUUID();
  await expect(db.transaction(async trx => {
    await trx('users').insert({ tenant, user_id: rolledBackUserId, username: 'rollback@example.test', email: 'rollback@example.test',
      first_name: 'R', last_name: 'B', user_type: 'internal', hashed_password: 'unused', is_inactive: false });
    await trx('user_invitations').where({ tenant, email_normalized: 'invite@example.test', used_at: null })
      .update({ invited_user_id: rolledBackUserId });
    await trx('user_invitations').where({ tenant, invitation_id: invitationId }).update({ used_at: trx.fn.now() });
    throw new Error('allocation recount rejected the transition');
  })).rejects.toThrow('allocation recount rejected the transition');
  expect(await db('users').where({ tenant, user_id: rolledBackUserId })).toHaveLength(0);
  expect(await db('user_invitations').where({ tenant, invitation_id: invitationId }).first('used_at')).toMatchObject({ used_at: null });

  // Acceptance consumes the reservation in the same transaction as creating
  // the membership; the duplicate pending token stays linked to that member.
  await db.transaction(async trx => {
    const acceptedUserId = randomUUID();
    await trx('users').insert({ tenant, user_id: acceptedUserId, username: 'invite@example.test', email: 'invite@example.test',
      first_name: 'I', last_name: 'V', user_type: 'internal', hashed_password: 'unused', is_inactive: false });
    await trx('user_invitations').where({ tenant, email_normalized: 'invite@example.test', used_at: null })
      .update({ invited_user_id: acceptedUserId });
    await trx('user_invitations').where({ tenant, invitation_id: invitationId }).update({ used_at: trx.fn.now() });
  });
  expect(await db.transaction(trx => countCoManagedCommittedSeats(trx, tenant))).toBe(3);
});

it('does not reserve an extra seat for a pending invitation already tied to an active member', async () => {
  const tenant = context.tenant = await seedTenant();
  const userId = randomUUID();
  await db('users').insert({ tenant, user_id: userId, username: 'member@example.test', email: 'member@example.test',
    first_name: 'T', last_name: 'U', user_type: 'internal', hashed_password: 'unused', is_inactive: false });
  await db('user_invitations').insert({ tenant, invitation_id: randomUUID(), email: 'prior@example.test',
    email_normalized: 'prior@example.test', invited_user_id: userId, first_name: 'T', last_name: 'U', token: randomUUID(),
    expires_at: db.raw("now() + interval '1 day'") });

  expect(await db.transaction(trx => countCoManagedCommittedSeats(trx, tenant))).toBe(1);
  await db('users').where({ tenant, user_id: userId }).update({ email: 'changed@example.test' });
  expect(await db.transaction(trx => countCoManagedCommittedSeats(trx, tenant))).toBe(1);
});
