/**
 * Real Postgres locks and rollback, through the API's UserService. Only auth,
 * seat admission and presentation/audit side effects are stubbed; ownership,
 * user/role writes and contact flag sync run their production implementations.
 * Uses an isolated schema and drops it afterwards; no application data is read.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import knex, { type Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { describeWithDb } from '../../../../server/test-utils/requireDb';
import { USER_RESPONSE_FIELD_NAMES } from '@alga-psa/types';
import { checkClientPortalContactAvailability, assertClientPortalContactAvailable, addUserRoles, runWithTenant } from '@alga-psa/db';
import User from '@alga-psa/db/models/user';
import { PermissionRoleService } from '../../../../server/src/lib/api/services/PermissionRoleService';

const fixture = vi.hoisted(() => ({ db: null as Knex | null }));
vi.mock('@alga-psa/auth', () => ({
  verifyAuthenticator: () => true,
  hasPermission: async () => true,
  withAuth: (fn: unknown) => fn,
  withOptionalAuth: (fn: unknown) => fn,
}));
vi.mock('@alga-psa/db', async (original) => ({
  ...await original<typeof import('@alga-psa/db')>(),
  createTenantKnex: async () => ({ knex: fixture.db }),
  withAdminTransaction: async (fn: (trx: Knex.Transaction) => Promise<unknown>) => fixture.db!.transaction(fn),
}));
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: async () => fixture.db }));
vi.mock('@/lib/db', () => ({
  createTenantKnex: async () => ({ knex: fixture.db }),
  runWithTenant: async (_tenant: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('@ee/lib/auth/oauthAccountLinks', () => ({
  upsertOAuthAccountLink: async () => undefined,
  OAuthAccountLinkConflictError: class extends Error {},
}));
vi.mock('../lib/rateLimiting', () => ({ checkRegistrationLimit: async () => ({ success: true }), formatRateLimitError: () => '' }));
vi.mock('@alga-psa/user-composition/lib/permissions', () => ({ hasPermission: async () => true, throwPermissionError: () => { throw new Error('Permission denied'); } }));
vi.mock('@alga-psa/db/models/userPreferences', () => ({ default: { upsert: async () => undefined } }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishNonCatalogWorkflowEvent: async () => undefined }));
vi.mock('@alga-psa/core/encryption', () => ({ hashPassword: async () => 'test-hash', verifyPassword: () => true }));
vi.mock('../lib/internalUserLicenseGuard', () => ({
  admitInternalUserSeat: async () => ({ ok: true }),
  assertInternalUserSeatsWithinLimit: async () => undefined,
  isInternalUserLicenseLimitRejected: () => false,
}));

const { UserService } = await import('./UserService');
const describeDb = await describeWithDb();
const slot = path.basename(process.cwd()).match(/mc\d+$/)?.[0]
  ?? path.basename(path.resolve(__dirname, '../../../..')).match(/mc\d+$/)?.[0] ?? 'ci';
const schema = `portal_ownership_${randomUUID().replaceAll('-', '')}_${slot}`;
const tenant = 'tenant-a';
const otherTenant = 'tenant-b';
const context = (tenantId = tenant) => ({ tenant: tenantId, userId: 'actor', user: {} }) as any;

// Externally controlled gate: tests wait for a real SQL lock wait rather than
// relying on sleeps to guess whether two requests overlapped.
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describeDb('API portal contact ownership', () => {
  let db: Knex;
  let admin: Knex;
  let service: any;

  beforeAll(async () => {
    const connection = {
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER_ADMIN || 'postgres',
      password: process.env.DB_PASSWORD_ADMIN || 'postgres',
      database: process.env.DB_NAME_SERVER || 'postgres',
      application_name: schema,
    };
    admin = knex({ client: 'pg', connection });
    await admin.schema.createSchema(schema);
    db = knex({ client: 'pg', connection, searchPath: [schema], pool: { min: 0, max: 8 } });
    fixture.db = db;
    await db.schema.createTable('clients', (table) => {
      table.text('tenant'); table.text('client_id'); table.primary(['tenant', 'client_id']);
    });
    await db.schema.createTable('user_auth_accounts', (table) => {
      for (const column of ['tenant', 'user_id', 'provider', 'provider_account_id']) table.text(column);
    });
    await db.schema.createTable('contacts', (table) => {
      table.text('tenant');
      table.text('contact_name_id');
      for (const column of ['email', 'full_name', 'client_id', 'contact_kind']) table.text(column);
      table.boolean('is_inactive').defaultTo(false);
      table.boolean('is_client_admin').notNullable().defaultTo(false);
      table.timestamp('updated_at');
      table.primary(['tenant', 'contact_name_id']);
    });
    await db.schema.createTable('users', (table) => {
      for (const field of [...USER_RESPONSE_FIELD_NAMES, 'hashed_password']) {
        if (['two_factor_enabled', 'two_factor_required_new_device', 'is_google_user', 'is_inactive'].includes(field)) {
          table.boolean(field).defaultTo(false);
        } else if (field === 'user_id') table.text(field).defaultTo(db.raw('gen_random_uuid()::text'));
        else table.text(field);
      }
      table.jsonb('client_portal_entra_metadata');
      table.primary(['tenant', 'user_id']);
      table.foreign(['tenant', 'contact_id']).references(['tenant', 'contact_name_id']).inTable('contacts');
    });
    await db.schema.createTable('roles', (table) => {
      table.text('tenant'); table.text('role_id'); table.text('role_name');
      table.boolean('client'); table.boolean('msp');
      table.primary(['tenant', 'role_id']);
    });
    await db.schema.createTable('co_managed_seat_assignments', (table) => {
      table.text('tenant'); table.text('user_id'); table.text('state');
    });
    await db.schema.createTable('user_roles', (table) => {
      table.text('tenant'); table.text('user_id'); table.text('role_id');
      table.primary(['tenant', 'user_id', 'role_id']);
    });
  });

  afterAll(async () => {
    await db?.destroy();
    if (admin) {
      await admin.schema.dropSchemaIfExists(schema, true);
      await admin.destroy();
    }
  });

  beforeEach(async () => {
    await db('user_roles').del(); await db('users').del();
    await db('contacts').del(); await db('roles').del(); await db('clients').del();
    for (const tenantId of [tenant, otherTenant]) {
      await db('clients').insert({ tenant: tenantId, client_id: 'client-a' });
      await db('contacts').insert(['contact-a', 'contact-b', 'free-contact'].map((id) => ({
        tenant: tenantId, contact_name_id: id, is_client_admin: true,
        email: `${id}-${tenantId}@ownership.test`, full_name: 'Portal User', client_id: 'client-a',
      })));
      await db('roles').insert([
        { tenant: tenantId, role_id: 'user-role', role_name: 'User', client: true, msp: false },
        { tenant: tenantId, role_id: 'admin-role', role_name: 'Admin', client: true, msp: false },
        { tenant: tenantId, role_id: 'msp-role', role_name: 'Admin', client: false, msp: true },
      ]);
    }
    service = new UserService();
    service.getKnex = async () => ({ knex: db });
    service.ensurePermission = vi.fn(async () => undefined);
    service.emailExistsInAnotherTenant = async () => false;
    service.createDefaultUserPreferences = async () => undefined;
    service.logUserActivity = async () => undefined;
    service.enhanceUsersWithDetails = async (users: unknown[]) => users;
  });

  const create = (suffix: string, contactId: string | null, tenantId = tenant, extra = {}) => service.create({
    username: suffix, email: `${suffix}@ownership.test`, password: 'test-password',
    user_type: 'client', contact_id: contactId, role_ids: ['user-role'], ...extra,
  }, context(tenantId));
  const snapshot = async () => ({
    users: await db('users').orderBy(['tenant', 'user_id']),
    roles: await db('user_roles').orderBy(['tenant', 'user_id', 'role_id']),
    contacts: await db('contacts').orderBy(['tenant', 'contact_name_id']),
  });
  const conflict = { statusCode: 409, code: 'CONFLICT', message: 'This contact already has a client portal user. Choose another contact.' };
  const owners = () => db('users').where({ tenant, contact_id: 'free-contact', user_type: 'client' });

  it('refuses a second portal user with a different email without changing any rows', async () => {
    await create('owner', 'contact-a', tenant, { role_ids: ['admin-role'] });
    const before = await snapshot();
    await expect(create('different-email', 'contact-a')).rejects.toMatchObject(conflict);
    expect(await snapshot()).toEqual(before);
  });

  it('refuses relinking onto an occupied contact without changing users, roles or flags', async () => {
    await create('owner', 'contact-a', tenant, { role_ids: ['admin-role'] });
    const mover = await create('mover', 'contact-b');
    const before = await snapshot();
    await expect(service.update(mover.user_id, { contact_id: 'contact-a' }, context())).rejects.toMatchObject(conflict);
    expect(await snapshot()).toEqual(before);
  });

  it('allows the current owner to keep its link, including a profile-only update', async () => {
    const owner = await create('owner', 'contact-a');
    await service.update(owner.user_id, { contact_id: 'contact-a', first_name: 'Alice' }, context());
    await service.update(owner.user_id, { last_name: 'Liddell' }, context());
    expect(await db('users').where({ tenant, user_id: owner.user_id }).first()).toMatchObject({ contact_id: 'contact-a', first_name: 'Alice', last_name: 'Liddell' });
    expect(await db('contacts').where({ tenant, contact_name_id: 'contact-a' }).first()).toMatchObject({ is_client_admin: false });
  });

  it('keeps ownership and locks tenant-scoped, even for identical contact IDs', async () => {
    await create('owner-a', 'contact-a', tenant, { role_ids: ['admin-role'] });
    await create('owner-b', 'contact-a', otherTenant);
    const holder = await db.transaction();
    try {
      await checkClientPortalContactAvailability(holder, tenant, 'free-contact');
      // Completes while the other tenant holds its lock on the same ID.
      await create('independent', 'free-contact', otherTenant);
    } finally { await holder.rollback(); }
    expect(await db('contacts').where({ tenant, contact_name_id: 'contact-a' }).first()).toMatchObject({ is_client_admin: true });
    expect(await db('contacts').where({ tenant: otherTenant, contact_name_id: 'contact-a' }).first()).toMatchObject({ is_client_admin: false });
  });

  it('rejects a missing or other-tenant-only contact', async () => {
    await db('contacts').where({ tenant, contact_name_id: 'free-contact' }).del();
    const before = await snapshot();
    await expect(create('outsider', 'free-contact')).rejects.toMatchObject({ statusCode: 404, message: 'Contact not found' });
    expect(await snapshot()).toEqual(before);
  });

  it('leaves internal-user contact behavior unchanged and allows an unlinked portal user', async () => {
    await create('portal', 'contact-a');
    await create('internal', 'contact-a', tenant, { user_type: 'internal', role_ids: ['msp-role'] });
    await create('unlinked', null);
    expect(await db('users').where({ tenant })).toHaveLength(3);
  });

  it('refuses conversion to client when the existing contact is occupied', async () => {
    await create('owner', 'contact-a');
    const internal = await create('internal', 'contact-a', tenant, { user_type: 'internal', role_ids: ['msp-role'], is_inactive: true });
    const before = await snapshot();
    await expect(service.update(internal.user_id, { user_type: 'client' }, context())).rejects.toMatchObject(conflict);
    expect(await snapshot()).toEqual(before);
  });

  // Park the winner after user+roles+flag were written but before commit. The
  // loser must actually wait on its contact lock, then see the committed owner.
  async function race(winner: () => Promise<any>, loser: () => Promise<any>) {
    const written = gate(); const release = gate();
    let first = true;
    service.logUserActivity = async () => {
      if (first) { first = false; written.resolve(); await release.promise; }
    };
    const winning = winner();
    await written.promise;
    const losing = loser().then((value) => ({ value }), (error) => ({ error }));
    try {
      await vi.waitFor(async () => {
        const { rows } = await admin.raw("SELECT pid FROM pg_stat_activity WHERE application_name = ? AND wait_event_type = 'Lock' AND query LIKE ?", [schema, '%pg_advisory_xact_lock%']);
        expect(rows.length).toBeGreaterThan(0);
      }, { timeout: 3000, interval: 10 });
    } finally { release.resolve(); }
    const result = await winning;
    expect(await losing).toMatchObject({ error: conflict });
    expect(await owners()).toHaveLength(1);
    expect(await db('contacts').where({ tenant, contact_name_id: 'free-contact' }).first()).toMatchObject({ is_client_admin: false });
    return result;
  }

  it('serializes two concurrent creates; only the winner writes users and roles', async () => {
    await race(() => create('winner', 'free-contact'), () => create('loser', 'free-contact', tenant, { role_ids: ['admin-role'] }));
    expect(await db('users').where({ tenant })).toHaveLength(1);
    expect(await db('user_roles').where({ tenant })).toHaveLength(1);
  });

  it('serializes concurrent relinks and preserves the losing account and flag', async () => {
    const first = await create('first', 'contact-a');
    const second = await create('second', 'contact-b', tenant, { role_ids: ['admin-role'] });
    const before = await snapshot();
    await race(
      () => service.update(first.user_id, { contact_id: 'free-contact' }, context()),
      () => service.update(second.user_id, { contact_id: 'free-contact' }, context()),
    );
    const after = await snapshot();
    expect(after.users.find((row) => row.user_id === second.user_id)).toEqual(before.users.find((row) => row.user_id === second.user_id));
    expect(after.roles).toEqual(before.roles);
    expect(after.contacts.find((row) => row.tenant === tenant && row.contact_name_id === 'contact-b')).toEqual(before.contacts.find((row) => row.tenant === tenant && row.contact_name_id === 'contact-b'));
  });

  it('serializes a create racing a relink', async () => {
    const mover = await create('mover', 'contact-a');
    await race(
      () => service.update(mover.user_id, { contact_id: 'free-contact' }, context()),
      () => create('loser', 'free-contact'),
    );
    expect(await db('users').where({ tenant })).toHaveLength(1);
  });

  it('rechecks ownership after a concurrent same-account type change', async () => {
    await create('owner', 'contact-b');
    const changing = await create('changing', 'contact-a', tenant, {
      user_type: 'internal', role_ids: ['msp-role'], is_inactive: true,
    });
    const written = gate(); const release = gate();
    service.logUserActivity = async () => { written.resolve(); await release.promise; };
    const winner = service.update(changing.user_id, { user_type: 'client' }, context());
    await written.promise;
    // The loser waits before reading the type, then checks the newly client account's link.
    const loser = service.update(changing.user_id, { contact_id: 'contact-b' }, context())
      .then((value: unknown) => ({ value }), (error: unknown) => ({ error }));
    try {
      await vi.waitFor(async () => {
        const { rows } = await admin.raw("SELECT pid FROM pg_stat_activity WHERE application_name = ? AND wait_event_type = 'Lock' AND query LIKE ?", [schema, '%pg_advisory_xact_lock%']);
        expect(rows.length).toBeGreaterThan(0);
      }, { timeout: 3000, interval: 10 });
    } finally { release.resolve(); }
    await winner;
    expect(await loser).toMatchObject({ error: {
      statusCode: 409, code: 'CONFLICT',
      message: conflict.message,
    } });
    expect(await db('users').where({ tenant, user_id: changing.user_id }).first())
      .toMatchObject({ user_type: 'client', contact_id: 'contact-a' });
    expect(await db('users').where({ tenant, contact_id: 'contact-b', user_type: 'client' })).toHaveLength(1);
  });

  it('rolls back a relink and its flag sync when a later step fails', async () => {
    const mover = await create('mover', 'contact-a');
    const before = await snapshot();
    service.logUserActivity = async () => { throw new Error('audit failure'); };
    await expect(service.update(mover.user_id, { contact_id: 'free-contact' }, context())).rejects.toThrow('audit failure');
    expect(await snapshot()).toEqual(before);
  });

  it('rolls back the link, roles and flag together if a later creation step fails', async () => {
    const before = await snapshot();
    service.logUserActivity = async () => { throw new Error('audit failure'); };
    await expect(create('failed', 'free-contact')).rejects.toThrow('audit failure');
    expect(await snapshot()).toEqual(before);
    service.logUserActivity = async () => undefined;
    await create('retry', 'free-contact');
  });
  const flag = async (contactId: string) => (await db('contacts').where({ tenant, contact_name_id: contactId }).first()).is_client_admin;

  async function waitForMutationLock() {
    await vi.waitFor(async () => {
      const { rows } = await admin.raw("SELECT pid FROM pg_stat_activity WHERE application_name = ? AND wait_event_type = 'Lock' AND query LIKE ?", [schema, '%pg_advisory_xact_lock%']);
      expect(rows.length).toBeGreaterThan(0);
    }, { timeout: 3000, interval: 10 });
  }

  it('API assign-replace and remove converge the flag in both directions', async () => {
    const user = await create('roles', 'contact-a');
    expect(await flag('contact-a')).toBe(false);
    await service.assignRoles(user.user_id, ['user-role', 'admin-role'], context());
    expect(await flag('contact-a')).toBe(true);
    await service.removeRoles(user.user_id, ['admin-role'], context());
    expect(await flag('contact-a')).toBe(false);
    await service.assignRoles(user.user_id, ['admin-role'], context());
    expect(await flag('contact-a')).toBe(true);
    await service.assignRoles(user.user_id, ['user-role'], context());
    expect(await flag('contact-a')).toBe(false);
  });

  it('MSP role changes leave contacts unchanged', async () => {
    const user = await create('msp', 'contact-a', tenant, { user_type: 'internal', role_ids: ['msp-role'] });
    const before = await db('contacts').orderBy(['tenant', 'contact_name_id']);
    await service.assignRoles(user.user_id, ['msp-role'], context());
    expect(await db('contacts').orderBy(['tenant', 'contact_name_id'])).toEqual(before);
  });

  it.each(['relink-first', 'remove-first'])('serializes role removal and relinking: %s', async (order) => {
    const user = await create('moving-admin', 'contact-a', tenant, { role_ids: ['user-role', 'admin-role'] });
    const written = gate(); const release = gate(); let first = true;
    service.logUserActivity = async () => { if (first) { first = false; written.resolve(); await release.promise; } };
    const relink = () => service.update(user.user_id, { contact_id: 'contact-b' }, context());
    const remove = () => service.removeRoles(user.user_id, ['admin-role'], context());
    const winner = order === 'relink-first' ? relink() : remove();
    await written.promise;
    const loser = order === 'relink-first' ? remove() : relink();
    try { await waitForMutationLock(); } finally { release.resolve(); }
    await Promise.all([winner, loser]);
    expect(await flag('contact-b')).toBe(false);
    expect(await db('user_roles').where({ tenant, user_id: user.user_id })).toMatchObject([{ role_id: 'user-role' }]);
  });

  it.each(['guard-first', 'create-first'])('serializes the direct flag guard with creation: %s', async (order) => {
    // Execute the action's production ownership check + flag write in a real
    // transaction. Its authorization/translation channel has a separate action test.
    const written = gate(); const release = gate();
    const setPreseed = () => db.transaction(async (trx) => {
      if (await checkClientPortalContactAvailability(trx, tenant, 'free-contact') === 'occupied') return false;
      if (order === 'guard-first') { written.resolve(); await release.promise; }
      await trx('contacts').where({ tenant, contact_name_id: 'free-contact' }).update({ is_client_admin: true });
      return true;
    });
    service.logUserActivity = async () => { if (order === 'create-first') { written.resolve(); await release.promise; } };
    const winner = order === 'guard-first' ? setPreseed() : create('created', 'free-contact');
    await written.promise;
    const loser = order === 'guard-first' ? create('created', 'free-contact') : setPreseed();
    try { await waitForMutationLock(); } finally { release.resolve(); }
    await Promise.all([winner, loser]);
    if (order === 'create-first') expect(await loser).toBe(false);
    expect(await flag('free-contact')).toBe(false);
  });

  it('serializes non-API ownership checks against API creation', async () => {
    const trx = await db.transaction();
    await assertClientPortalContactAvailable(trx, tenant, 'client', 'free-contact');
    const api = create('api', 'free-contact').then(value => ({ value }), error => ({ error }));
    try {
      await waitForMutationLock();
      await trx('users').insert({ tenant, user_id: 'invited', user_type: 'client', contact_id: 'free-contact' });
      await addUserRoles(trx, tenant, 'invited', ['user-role']);
      await trx.commit();
    } catch (error) { await trx.rollback(); throw error; }
    expect(await api).toMatchObject({ error: conflict });
    expect(await owners()).toHaveLength(1);
    expect(await flag('free-contact')).toBe(false);
  });

  it('model relinking enforces ownership and synchronizes the flag', async () => {
    const owner = await create('owner', 'contact-a');
    const moving = await create('model', 'contact-b');
    const before = await snapshot();
    await expect(runWithTenant(tenant, () => User.update(db, moving.user_id, { contact_id: 'contact-a' })))
      .rejects.toThrow('This contact already has a client portal user');
    expect(await snapshot()).toEqual(before);
    await runWithTenant(tenant, () => User.update(db, owner.user_id, { contact_id: 'contact-a' }));
    await runWithTenant(tenant, () => User.update(db, moving.user_id, { contact_id: 'free-contact' }));
    expect(await flag('free-contact')).toBe(false);
  });

  it('role-definition renames converge linked flags and stay tenant-scoped', async () => {
    await create('admin-a', 'contact-a', tenant, { role_ids: ['admin-role'] });
    await create('admin-b', 'contact-a', otherTenant, { role_ids: ['admin-role'] });
    const roles: any = new PermissionRoleService();
    roles.getKnex = async () => ({ knex: db });
    roles.addUpdateAuditFields = async (_trx: unknown, data: unknown) => data;
    roles.logAuditEvent = async () => undefined;
    roles.addRoleHateoas = (role: unknown) => role;
    await roles.updateRole('admin-role', { role_name: 'Former Admin' }, context());
    expect(await flag('contact-a')).toBe(false);
    expect((await db('contacts').where({ tenant: otherTenant, contact_name_id: 'contact-a' }).first()).is_client_admin).toBe(true);
    await roles.updateRole('admin-role', { role_name: 'ADMIN' }, context());
    expect(await flag('contact-a')).toBe(true);
  });

  it('MSP addUser assigns the selected User role and clears the pre-seed', async () => {
    const { addUser } = await import('../actions/user-actions/userActions');
    const result = await (addUser as any)({ user_id: 'actor', user_type: 'internal' } as any, { tenant } as any, {
      firstName: 'Portal', lastName: 'User', email: 'manual@ownership.test', password: 'password',
      userType: 'client', contactId: 'contact-a', roleId: 'user-role',
    });
    expect(result).toMatchObject({ success: true });
    expect(await flag('contact-a')).toBe(false);
    expect(await db('user_roles').where({ tenant })).toMatchObject([{ role_id: 'user-role' }]);
  });

  it('registration assigns User and clears a contact admin pre-seed', async () => {
    const { initiateRegistration } = await import('../actions/user-actions/registrationActions');
    const result = await initiateRegistration(`contact-a-${tenant}@ownership.test`, 'password');
    expect(result).toMatchObject({ success: true });
    expect(await flag('contact-a')).toBe(false);
    expect(await db('user_roles').where({ tenant })).toMatchObject([{ role_id: 'user-role' }]);
  });

  it.each(['User', 'Restricted'])('Entra provisioning honors configured %s despite an admin pre-seed', async (roleName) => {
    await db('roles').insert({ tenant, role_id: 'restricted-role', role_name: 'Restricted', client: true, msp: false });
    const { handleEligibleClientPortalProvisioning } = await import('../../../../ee/server/src/lib/integrations/entra/sync/clientPortalProvisioning');
    const result = await handleEligibleClientPortalProvisioning({
      tenantId: tenant, clientId: 'client-a', managedTenantId: 'managed', contactNameId: 'contact-a', defaultRoleName: roleName,
    }, { email: 'entra@ownership.test', userPrincipalName: 'entra@ownership.test', entraObjectId: 'object', entraTenantId: 'entra-tenant', accountEnabled: true } as any);
    expect(result).toMatchObject({ outcome: 'provisioned' });
    expect(await flag('contact-a')).toBe(false);
    expect(await db('user_roles').where({ tenant })).toMatchObject([{ role_id: roleName === 'User' ? 'user-role' : 'restricted-role' }]);
  });

  it('manual invitation creation rolls back when no client role resolves', async () => {
    await db('roles').where({ tenant, client: true }).del();
    const before = await snapshot();
    const { createClientPortalUser } = await import('../../../portal-shared/src/actions/portalInvitationActions');
    const result = await (createClientPortalUser as any)({ user_id: 'actor', user_type: 'internal' }, { tenant }, {
      contactId: 'contact-a', password: 'password123',
    });
    expect(result).toMatchObject({ success: false, errorCode: 'PORTAL_ROLE_NOT_CONFIGURED' });
    expect(await snapshot()).toEqual(before);
  });

  it('manual invitation creation still derives Admin from the pre-seed', async () => {
    const { createClientPortalUser } = await import('../../../portal-shared/src/actions/portalInvitationActions');
    const result = await (createClientPortalUser as any)({ user_id: 'actor', user_type: 'internal' }, { tenant }, {
      contactId: 'contact-a', password: 'password123',
    });
    expect(result).toMatchObject({ success: true });
    expect(await flag('contact-a')).toBe(true);
    expect(await db('user_roles').where({ tenant })).toMatchObject([{ role_id: 'admin-role' }]);
  });

  it('manual invitation creation cannot race an API owner into a second account', async () => {
    const written = gate(); const release = gate();
    service.logUserActivity = async () => { written.resolve(); await release.promise; };
    const api = create('api', 'contact-a');
    await written.promise;
    const { createClientPortalUser } = await import('../../../portal-shared/src/actions/portalInvitationActions');
    const invitation = (createClientPortalUser as any)({ user_id: 'actor', user_type: 'internal' }, { tenant }, {
      contactId: 'contact-a', password: 'password123',
    });
    try { await waitForMutationLock(); } finally { release.resolve(); }
    await api;
    expect(await invitation).toMatchObject({ success: false });
    expect(await db('users').where({ tenant, contact_id: 'contact-a' })).toHaveLength(1);
    expect(await flag('contact-a')).toBe(false);
  });

});
