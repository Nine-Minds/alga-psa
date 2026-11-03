import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import knex, { type Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const context = vi.hoisted(() => ({ trx: undefined as Knex.Transaction | undefined, tenant: '' }));
vi.mock('../../../../packages/db/src/lib/tenant', () => ({
  createTenantKnex: async () => ({ knex: context.trx, tenant: context.tenant }),
  withTransaction: async (_db: unknown, fn: (trx: Knex.Transaction) => unknown) => fn(context.trx!),
}));
vi.mock('../../../../packages/db/src/lib/tenantId', () => ({ requireTenantId: async () => context.tenant }));
vi.unmock('../../../../packages/db/src/lib/tenantDb');
import { getUserWithRoles, getUserWithRolesByEmail } from '../../../../packages/db/src/lib/getUserWithRoles';
import User from '../../../../packages/db/src/models/user';

/** Wire-in environments name container secret paths; resolve their host equivalents. */
function adminPassword(): string {
  const value = process.env.DB_PASSWORD_ADMIN;
  if (!value) throw new Error('DB_PASSWORD_ADMIN is required for the PostgreSQL projection tests');
  if (!value.startsWith('/')) return value;
  const candidates = [value, path.resolve(__dirname, '../../../../secrets', path.basename(value))];
  const file = candidates.find(existsSync);
  if (!file) throw new Error('Cannot resolve the configured PostgreSQL admin password file');
  return readFileSync(file, 'utf8').trim();
}

const tenant = randomUUID();
const otherTenant = randomUUID();
const userId = randomUUID();
const roleId = randomUUID();
const contactId = randomUUID();
const clientId = randomUUID();
const email = 'projection@example.test';
let db: Knex;

// Temporary tables inherit migrated columns and shadow public tables on this
// connection only. All fixtures and DDL roll back; no application rows change.
describe('role-bearing public user projections (PostgreSQL)', () => {
  beforeAll(async () => {
    db = knex({ client: 'pg', connection: {
      host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432),
      database: process.env.TEST_DB_NAME || process.env.DB_NAME_SERVER,
      user: process.env.DB_USER_ADMIN || 'postgres', password: adminPassword(),
    }, pool: { min: 0, max: 1 } });
    context.trx = await db.transaction();
    context.tenant = tenant;
    for (const table of ['users', 'roles', 'user_roles', 'contacts']) {
      await context.trx.raw('CREATE TEMP TABLE ?? (LIKE public.?? INCLUDING DEFAULTS) ON COMMIT DROP', [table, table]);
    }
    await context.trx('users').insert([tenant, otherTenant].map(owner => ({
      user_id: userId, tenant: owner, username: 'projection', email, first_name: 'Projection', last_name: 'User',
      user_type: 'internal', is_inactive: false, hashed_password: 'PRIVATE_PASSWORD_HASH',
      two_factor_secret: 'PRIVATE_TOTP_SEED', two_factor_enabled: true, contact_id: contactId, phone_extension: '123',
    })));
    await context.trx('roles').insert([tenant, otherTenant].map(owner => ({
      role_id: roleId, tenant: owner, role_name: owner === tenant ? 'Expected role' : 'Other tenant role',
      msp: true, client: false,
    })));
    await context.trx('user_roles').insert([tenant, otherTenant].map(owner => ({ user_id: userId, role_id: roleId, tenant: owner })));
    await context.trx('contacts').insert([tenant, otherTenant].map(owner => ({
      contact_name_id: contactId, tenant: owner, full_name: 'Projection User', client_id: owner === tenant ? clientId : randomUUID(),
    })));
  });
  afterAll(async () => { await context.trx?.rollback(); await db?.destroy(); });

  it.each(['id', 'email', 'model'] as const)('returns only public fields via the %s loader', async route => {
    const user = route === 'id' ? await getUserWithRoles(userId, tenant, async () => '/test-avatar')
      : route === 'email' ? await getUserWithRolesByEmail(email.toUpperCase(), tenant, 'internal')
        : await User.getUserWithRoles(context.trx!, userId);
    expect(user).toMatchObject({ user_id: userId, tenant, two_factor_enabled: true, phone_extension: '123' });
    expect(user?.roles).toHaveLength(1);
    expect(user?.roles[0]).toMatchObject({ role_id: roleId, role_name: 'Expected role', tenant });
    if (route !== 'model') expect(user).toHaveProperty('clientId', clientId);
    if (route === 'id') expect(user).toHaveProperty('avatarUrl', '/test-avatar');
    expect(user).not.toHaveProperty('hashed_password');
    expect(user).not.toHaveProperty('two_factor_secret');
    expect(JSON.stringify(user)).not.toContain('PRIVATE_');
    expect(await context.trx!('users').where({ tenant, user_id: userId }).first()).toMatchObject({
      hashed_password: 'PRIVATE_PASSWORD_HASH', two_factor_secret: 'PRIVATE_TOTP_SEED',
    });
  });
  it('retains missing-user, user-type and tenant guards', async () => {
    expect(await getUserWithRoles(randomUUID(), tenant)).toBeNull();
    expect(await getUserWithRolesByEmail(email, tenant, 'client')).toBeNull();
    expect(await getUserWithRolesByEmail(email, randomUUID(), 'internal')).toBeNull();
    await expect(getUserWithRoles(userId, otherTenant)).rejects.toThrow('Tenant context mismatch');
  });
});
