import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import knex, { type Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { getSecret } from '../../lib/utils/getSecret';

// Seat admission and seat counts read `is_inactive = false`, while sign-in
// only tests truthiness. A null or string active state therefore produced a
// working account no seat count saw, and reactivating an inactive internal user
// took a seat without checking the limit.

const context = vi.hoisted(() => ({ tenant: '', userId: '', db: null as any }));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) =>
    fn({ user_id: context.userId, tenant: context.tenant, user_type: 'internal' }, { tenant: context.tenant }, ...args),
  withOptionalAuth: (fn: any) => fn,
  withAuthCheck: (fn: any) => fn,
  hasPermission: vi.fn(async () => true),
  preCheckDeletion: vi.fn(),
  localizeActionError: async (error: any) => error,
}));
vi.mock('@alga-psa/user-composition/lib/permissions', () => ({
  hasPermission: vi.fn(async () => true),
  throwPermissionError: (action: string) => { throw new Error(`Permission denied: ${action}`); },
}));
vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({ getUserRoles: vi.fn(async () => []) }));
vi.mock('@alga-psa/user-composition/lib/avatarUtils', () => ({ getUserAvatarUrl: vi.fn(async () => null) }));
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/db')>(),
  createTenantKnex: async () => ({ knex: context.db, tenant: context.tenant }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/storage', () => ({ uploadEntityImage: vi.fn(), deleteEntityImage: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn(), publishEvent: vi.fn(async () => undefined), publishNonCatalogWorkflowEvent: vi.fn(async () => undefined), publishStoredWorkflowEvent: vi.fn(async () => undefined), publishBuiltWorkflowPayload: vi.fn(async () => undefined), publishNonCatalogEventByName: vi.fn(async () => undefined), publishUnregisteredEventType: vi.fn(async () => undefined) }));

import { createSystemContext, runAsSystem, runWithTenant } from '@alga-psa/db';
import { updateUser as updateUserAction } from '@alga-psa/users/actions/user-actions/userActions';
import { UserService } from '../../../../packages/users/src/services/UserService';
import { countCoManagedCommittedSeats } from '../../../../packages/licensing/src/lib/co-managed-admission';

// Production runs actions inside the request's tenant context; User.update reads it.
const updateUser = (userId: string, data: Parameters<typeof updateUserAction>[1]) =>
  runWithTenant(context.tenant, () => updateUserAction(userId, data));

let db: Knex;
const databaseName = `update_user_active_state_test_${randomUUID().replaceAll('-', '')}`;

beforeAll(async () => {
  db = await createTestDbConnection({ databaseName, runSeeds: false });
  context.db = db;
  process.env.DB_NAME_SERVER = databaseName;
}, 180_000);

afterAll(async () => {
  await db?.destroy();
  const admin = knex({ client: 'pg', connection: {
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER_ADMIN || 'postgres',
    password: await getSecret('postgres_password', 'DB_PASSWORD_ADMIN', 'postpass123'), database: 'postgres',
  }, pool: { min: 0, max: 1 } });
  try {
    await admin.raw('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ? AND pid <> pg_backend_pid()', [databaseName]);
    await admin.raw('DROP DATABASE IF EXISTS ??', [databaseName]);
  }
  finally { await admin.destroy(); }
});

async function seedUser(isInactive: boolean): Promise<void> {
  context.tenant = randomUUID();
  context.userId = randomUUID();
  await db('tenants').insert({ tenant: context.tenant, client_name: 'Active state test', email: `${context.tenant}@example.test`, product_code: 'psa' });
  await db('users').insert({
    tenant: context.tenant, user_id: context.userId, username: context.userId,
    email: `${context.userId}@example.test`, first_name: 'Test', last_name: 'User',
    user_type: 'internal', hashed_password: 'unused', is_inactive: isInactive,
  });
}

const storedActiveState = async () =>
  (await db('users').where({ tenant: context.tenant, user_id: context.userId }).first()).is_inactive;

beforeEach(() => vi.clearAllMocks());

it.each([null, 'false', 0, 'true'])('refuses the active state %j and leaves the stored value alone', async (value) => {
  await seedUser(false);
  const result = await updateUser(context.userId, { is_inactive: value as never, phone: '555-0100' });
  expect(result).toMatchObject({ success: false, code: 'INVALID_ACTIVE_STATE' });
  expect(await storedActiveState()).toBe(false);
});

it('still deactivates and reactivates with a real boolean', async () => {
  await seedUser(false);
  await expect(updateUser(context.userId, { is_inactive: true })).resolves.toMatchObject({ success: true });
  expect(await storedActiveState()).toBe(true);
  await expect(updateUser(context.userId, { is_inactive: false })).resolves.toMatchObject({ success: true });
  expect(await storedActiveState()).toBe(false);
});

it('updates an active internal user email through the action and persists the identity change', async () => {
  await seedUser(false);
  const nextEmail = `renamed-${randomUUID()}@example.test`;
  await expect(updateUser(context.userId, { email: nextEmail })).resolves.toMatchObject({ success: true });
  expect(await db('users').where({ tenant: context.tenant, user_id: context.userId }).first('email'))
    .toEqual({ email: nextEmail });
});

it('stores no user without an active state', async () => {
  await seedUser(false);
  await expect(db('users').where({ tenant: context.tenant, user_id: context.userId }).update({ is_inactive: null }))
    .rejects.toMatchObject({ code: '23502' });
  const columns = await db('information_schema.columns').where({ table_name: 'users', column_name: 'is_inactive' }).first('is_nullable');
  expect(columns.is_nullable).toBe('NO');
});

async function seedOtherActiveInternalUser(): Promise<void> {
  const otherId = randomUUID();
  await db('users').insert({
    tenant: context.tenant, user_id: otherId, username: otherId, email: `${otherId}@example.test`,
    first_name: 'Other', last_name: 'User', user_type: 'internal', hashed_password: 'unused', is_inactive: false,
  });
}

const setSeatLimit = (limit: number | null) =>
  db('tenants').where({ tenant: context.tenant }).update({ licensed_user_count: limit });

async function seedCoManagedSeatWorld() {
  const sponsor = randomUUID();
  context.tenant = randomUUID();
  await db('tenants').insert([
    { tenant: sponsor, client_name: 'Sponsor', email: `${sponsor}@example.test`, product_code: 'psa', plan: 'pro' },
    { tenant: context.tenant, client_name: 'Customer', email: `${context.tenant}@example.test`, product_code: 'co_managed', licensed_user_count: 1 },
  ]);
  await db('co_managed_entitlements').insert({ tenant: sponsor, source: 'admin_grant', source_reference: randomUUID(), capacity: 1,
    verified_at: db.fn.now(), valid_until: db.raw("now() + interval '1 year'") });
  const relationshipId = randomUUID();
  const operationId = randomUUID();
  const allocationId = randomUUID();
  const sponsorAdminId = randomUUID();
  await db('co_management_relationships').insert({ tenant: context.tenant, relationship_id: relationshipId,
    sponsor_tenant: sponsor, sponsor_client_id: randomUUID(), state: 'active', accepted_by: randomUUID(), accepted_at: db.fn.now() });
  await db('co_managed_provisioning_operations').insert({ tenant: sponsor, operation_id: operationId, allocation_id: allocationId,
    customer_tenant: context.tenant, relationship_id: relationshipId, requested_by: sponsorAdminId,
    escalation_board_id: randomUUID(), customer_board_id: randomUUID(), customer_client_id: randomUUID(),
    administrator_invitation_id: randomUUID(), request_fingerprint: 'a'.repeat(64), request: {}, state: 'pending_acceptance' });
  await db('co_managed_allocations').insert({ tenant: sponsor, allocation_id: allocationId, operation_id: operationId,
    request_fingerprint: 'a'.repeat(64), customer_tenant: context.tenant, relationship_id: relationshipId, seats: 1, state: 'active' });

  const roleId = randomUUID();
  await db('roles').insert({ tenant: context.tenant, role_id: roleId, role_name: `Seat member ${roleId}` });
  const email = `member-${randomUUID()}@example.test`;
  const invitationToken = randomUUID();
  const duplicateInvitationId = randomUUID();
  await db('user_invitations').insert([
    { tenant: context.tenant, invitation_id: randomUUID(), email, email_normalized: email, invited_user_id: null,
      first_name: 'Seat', last_name: 'Member', role_id: roleId, token: invitationToken,
      expires_at: db.raw("now() + interval '1 day'") },
    { tenant: context.tenant, invitation_id: duplicateInvitationId, email, email_normalized: email, invited_user_id: null,
      first_name: 'Seat', last_name: 'Member', role_id: roleId, token: randomUUID(),
      expires_at: db.raw("now() + interval '1 day'") },
  ]);
  return { sponsor, relationshipId, email, invitationToken, duplicateInvitationId, roleId };
}

async function acceptCoManagedInvitation(email: string, invitationToken: string, roleId: string) {
  // Two duplicate pending invitations reserve one distinct seat before acceptance.
  expect(await db.transaction(trx => countCoManagedCommittedSeats(trx, context.tenant))).toBe(1);
  return runWithTenant(context.tenant, () => runAsSystem('co-managed-seat-test', async () => db.transaction(trx =>
    new UserService().createFromInvitation({ username: email, email, password: 'Passw0rd!x', first_name: 'Seat',
      last_name: 'Member', user_type: 'internal', is_inactive: false, role_ids: [roleId] },
    createSystemContext(context.tenant), trx, invitationToken))));
}

async function expectAcceptedReservationState(userId: string, duplicateInvitationId: string) {
  const invitation = await db('user_invitations').where({ tenant: context.tenant, invitation_id: duplicateInvitationId })
    .first('invited_user_id', 'used_at', 'email_normalized');
  expect(invitation).toMatchObject({ invited_user_id: userId, used_at: null });
  expect(await db.transaction(trx => countCoManagedCommittedSeats(trx, context.tenant))).toBe(1);
  return invitation.email_normalized as string;
}

it('refuses to reactivate an internal user when the seat limit is reached', async () => {
  await seedUser(true);
  await seedOtherActiveInternalUser();
  await setSeatLimit(1);
  const result = await updateUser(context.userId, { is_inactive: false });
  expect(result).toMatchObject({ success: false, code: 'LICENSE_LIMIT_REACHED' });
  expect(await storedActiveState()).toBe(true);
});

it('reactivates an internal user while a seat is free', async () => {
  await seedUser(true);
  await seedOtherActiveInternalUser();
  await setSeatLimit(2);
  await expect(updateUser(context.userId, { is_inactive: false })).resolves.toMatchObject({ success: true });
  expect(await storedActiveState()).toBe(false);
});

it('reactivates an accepted member through the action while its retained duplicate reservation fills allocation', async () => {
  const { email, invitationToken, duplicateInvitationId, roleId } = await seedCoManagedSeatWorld();
  const accepted = await acceptCoManagedInvitation(email, invitationToken, roleId);
  context.userId = accepted.user.user_id;
  const reservedIdentity = await expectAcceptedReservationState(context.userId, duplicateInvitationId);

  const changedEmail = `renamed-${randomUUID()}@example.test`;
  await expect(updateUser(context.userId, { email: changedEmail })).resolves.toMatchObject({ success: true });
  expect(await db('users').where({ tenant: context.tenant, user_id: context.userId }).first('email'))
    .toEqual({ email: changedEmail });

  await expect(updateUser(context.userId, { is_inactive: true })).resolves.toMatchObject({ success: true });
  expect(await db('users').where({ tenant: context.tenant, user_id: context.userId }).first('is_inactive')).toEqual({ is_inactive: true });
  expect(await db.transaction(trx => countCoManagedCommittedSeats(trx, context.tenant))).toBe(1);

  await expect(updateUser(context.userId, { is_inactive: false })).resolves.toMatchObject({ success: true });
  expect(await db('users').where({ tenant: context.tenant, user_id: context.userId }).first('is_inactive')).toEqual({ is_inactive: false });
  await expectAcceptedReservationState(context.userId, duplicateInvitationId);
  // The duplicate's immutable snapshot still reserves capacity even after the
  // linked member changes their live email. An unrelated create cannot claim it.
  await expect(runWithTenant(context.tenant, () => runAsSystem('co-managed-seat-test', async () =>
    new UserService().create({ username: reservedIdentity, email: reservedIdentity, password: 'Passw0rd!x',
      first_name: 'Outside', last_name: 'Member', user_type: 'internal' }, createSystemContext(context.tenant))))).rejects.toMatchObject({
    code: 'CO_MANAGED_SEAT_LIMIT',
  });
});

it('reactivates an accepted member through UserService at full allocation and rejects unrelated admission', async () => {
  const { email, invitationToken, duplicateInvitationId, roleId } = await seedCoManagedSeatWorld();
  const accepted = await acceptCoManagedInvitation(email, invitationToken, roleId);
  const userId = accepted.user.user_id;
  const reservedIdentity = await expectAcceptedReservationState(userId, duplicateInvitationId);

  const changedEmail = `renamed-${randomUUID()}@example.test`;
  await runWithTenant(context.tenant, () => runAsSystem('co-managed-seat-test', async () =>
    new UserService().update(userId, { email: changedEmail } as any, createSystemContext(context.tenant))));
  expect(await db('users').where({ tenant: context.tenant, user_id: userId }).first('email'))
    .toEqual({ email: changedEmail });

  await runWithTenant(context.tenant, () => runAsSystem('co-managed-seat-test', async () =>
    new UserService().update(userId, { is_inactive: true } as any, createSystemContext(context.tenant))));
  expect(await db.transaction(trx => countCoManagedCommittedSeats(trx, context.tenant))).toBe(1);

  await expect(runWithTenant(context.tenant, () => runAsSystem('co-managed-seat-test', async () =>
    new UserService().update(userId, { is_inactive: false } as any, createSystemContext(context.tenant))))).resolves.toMatchObject({ user_id: userId });
  expect(await db('users').where({ tenant: context.tenant, user_id: userId }).first('is_inactive')).toEqual({ is_inactive: false });
  await expectAcceptedReservationState(userId, duplicateInvitationId);

  // Admission remains tied to the tenant-scoped immutable member ID; the old
  // invitation address cannot grant this unrelated user the member's seat.
  await expect(runWithTenant(context.tenant, () => runAsSystem('co-managed-seat-test', async () =>
    new UserService().create({ username: reservedIdentity, email: reservedIdentity, password: 'Passw0rd!x',
      first_name: 'Outside', last_name: 'Member', user_type: 'internal' }, createSystemContext(context.tenant))))).rejects.toMatchObject({
    code: 'CO_MANAGED_SEAT_LIMIT',
  });
});

it('does not refuse an unrelated edit by an already-active user at the seat limit', async () => {
  await seedUser(false);
  await setSeatLimit(1);
  await expect(updateUser(context.userId, { phone: '555-0101' })).resolves.toMatchObject({ success: true });
  await expect(updateUser(context.userId, { is_inactive: false, phone: '555-0102' })).resolves.toMatchObject({ success: true });
  expect(await storedActiveState()).toBe(false);
});
