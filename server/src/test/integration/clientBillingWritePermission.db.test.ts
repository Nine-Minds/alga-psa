/**
 * Changing a client's billing columns requires billing:update, on real Postgres.
 *
 * A subject holding client:update but not billing:update can edit a client but is refused when a
 * billing column would actually change. Values equal to the stored ones are grandfathered, so a
 * full-record round-trip still saves. Authentication is the only substitution (`withAuth`).
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const actor = vi.hoisted(() => ({ user: null as any }));
const dbRef = vi.hoisted(() => ({ db: null as any }));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({ getAppSecret: async () => undefined, getTenantSecret: async () => undefined }),
  getSecret: async (_n: string, e?: string, f = '') => (e ? process.env[e] : undefined) ?? f,
}));
vi.mock('@alga-psa/db', async importOriginal => {
  const real = await importOriginal<typeof import('@alga-psa/db')>();
  return { ...real, getConnection: async () => dbRef.db, getAdminConnection: async () => dbRef.db,
    createTenantKnex: async (tenant?: string) => ({ knex: dbRef.db, tenant: tenant ?? actor.user?.tenant }) };
});
vi.mock('@alga-psa/auth', async importOriginal => {
  const real = await importOriginal<typeof import('@alga-psa/auth')>();
  const { runWithTenant } = await import('@alga-psa/db');
  return { ...real, withAuth: (handler: any) => (...args: any[]) =>
    runWithTenant(actor.user.tenant, () => handler(actor.user, { tenant: actor.user.tenant }, ...args)),
  getSession: async () => ({ user: { id: actor.user.user_id, tenant: actor.user.tenant, user_type: actor.user.user_type } }),
  getApiKeyUserOverride: () => null };
});
vi.mock('@alga-psa/user-composition/actions', async importOriginal => {
  const real = await importOriginal<any>();
  return { ...real, getCurrentUser: async () => actor.user };
});

const require = createRequire(import.meta.url);
const permissionsDir = path.resolve(__dirname, '../../../migrations/utils/permissions');
const { syncPermissionCatalog } = require(path.join(permissionsDir, 'syncPermissionCatalog.cjs'));
const { getDefaultRoles } = require(path.join(permissionsDir, 'roleGrants.cjs'));

const describeDb = await describeWithDb();

describeDb('client billing columns need billing:update to change', { shuffle: false }, () => {
  let db: Knex;
  let tenant: string;
  let clientId: string;
  let editor: any;
  let billingEditor: any;

  const stored = () => db('clients').where({ tenant, client_id: clientId }).first();
  const grantRole = (userId: string, roleId: string) => db('user_roles').insert({ tenant, user_id: userId, role_id: roleId });
  const makeRole = async (name: string, grants: Array<[string, string]>) => {
    const roleId = randomUUID();
    await db('roles').insert({ tenant, role_id: roleId, role_name: name, description: name, msp: true, client: false });
    for (const [resource, action] of grants) {
      const permission = await db('permissions').where({ tenant, resource, action, msp: true, client: false }).first('permission_id');
      await db('role_permissions').insert({ tenant, role_id: roleId, permission_id: permission.permission_id });
    }
    return roleId;
  };
  const isRefused = (result: any) => typeof result?.permissionError === 'string' && /billing/i.test(result.permissionError);

  beforeAll(async () => {
    db = await createTestDbConnection();
    dbRef.db = db;
    tenant = await createTenant(db, `BW ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    await db('roles').insert(getDefaultRoles('psa').filter((role: any) => !role.legacy).map((role: any) => ({
      tenant, role_id: randomUUID(), role_name: role.roleName, msp: role.msp, client: role.client,
    })));
    await syncPermissionCatalog(db, tenant, 'psa');

    clientId = await createClient(db, tenant, 'BW client', { payment_terms: 'net_30', credit_limit: 500, billing_cycle: 'monthly' as any });
    await db('clients').where({ tenant, client_id: clientId }).update({ billing_email: 'ap@bw.example', auto_invoice: false });

    const editorRole = await makeRole('BW Editor', [['client', 'read'], ['client', 'update']]);
    const billingRole = await makeRole('BW Billing Editor', [['client', 'read'], ['client', 'update'], ['billing', 'read'], ['billing', 'update']]);
    const e = await createUser(db, tenant, { user_type: 'internal', username: 'bw.editor' });
    await grantRole(e, editorRole);
    const b = await createUser(db, tenant, { user_type: 'internal', username: 'bw.billing' });
    await grantRole(b, billingRole);
    editor = await db('users').where({ tenant, user_id: e }).first();
    billingEditor = await db('users').where({ tenant, user_id: b }).first();
  }, 180_000);

  afterAll(async () => { await db?.destroy().catch(() => undefined); });

  it('refuses a credit_limit and payment_terms change without billing:update, leaving the row unchanged', async () => {
    const { updateClient } = await import('../../../../packages/clients/src/actions/clientActions');
    const before = await stored();
    actor.user = editor;
    expect(isRefused(await updateClient(clientId, { credit_limit: 999999 } as any))).toBe(true);
    expect(isRefused(await updateClient(clientId, { client_name: 'BW renamed', payment_terms: 'net_90' } as any))).toBe(true);
    expect(await stored()).toEqual(before);
  });

  it('saves a non-billing change', async () => {
    const { updateClient } = await import('../../../../packages/clients/src/actions/clientActions');
    actor.user = editor;
    const saved: any = await updateClient(clientId, { client_name: 'BW client 2' } as any);
    expect(saved?.client_id).toBe(clientId);
    expect((await stored()).client_name).toBe('BW client 2');
  });

  it('saves a full fetched record with unchanged billing fields (grandfathered, decimal string vs number)', async () => {
    const { updateClient } = await import('../../../../packages/clients/src/actions/clientActions');
    actor.user = editor;
    const row = await stored();
    expect(typeof row.credit_limit === 'string' || typeof row.credit_limit === 'number').toBe(true);
    const saved: any = await updateClient(clientId, { ...row, credit_limit: 500, notes: 'round trip' } as any);
    expect(saved?.client_id, JSON.stringify(saved)).toBe(clientId);
    const after = await stored();
    expect(after.notes).toBe('round trip');
    expect(Number(after.credit_limit)).toBe(500);
    expect(after.payment_terms).toBe('net_30');
  });

  it('refuses clearing billing_email to "" or null: they are values', async () => {
    const { updateClient } = await import('../../../../packages/clients/src/actions/clientActions');
    actor.user = editor;
    expect(isRefused(await updateClient(clientId, { billing_email: '' } as any))).toBe(true);
    expect(isRefused(await updateClient(clientId, { billing_email: null } as any))).toBe(true);
    expect((await stored()).billing_email).toBe('ap@bw.example');
  });

  it('lets a user with billing:update change a billing field', async () => {
    const { updateClient } = await import('../../../../packages/clients/src/actions/clientActions');
    actor.user = billingEditor;
    const saved: any = await updateClient(clientId, { credit_limit: 750, payment_terms: 'net_60' } as any);
    expect(saved?.client_id, JSON.stringify(saved)).toBe(clientId);
    const after = await stored();
    expect(Number(after.credit_limit)).toBe(750);
    expect(after.payment_terms).toBe('net_60');
  });

  it('REST ClientService.update refuses a billing change without billing:update and allows it with', async () => {
    const { ClientService } = await import('../../lib/api/services/ClientService');
    const { runWithTenant } = await import('@alga-psa/db');
    const inner = new ClientService();
    vi.spyOn(inner as any, 'getKnex').mockResolvedValue({ knex: db, tenant });
    const update = (user: any, data: any) =>
      runWithTenant(tenant, () => inner.update(clientId, data, { tenant, userId: user.user_id, user, viaPrincipalUserId: null } as any));

    const before = await stored();
    await expect(update(editor, { credit_limit: 12345 })).rejects.toThrow(/billing/i);
    expect((await stored()).credit_limit).toEqual(before.credit_limit);
    await expect(update(editor, { notes: 'rest edit', credit_limit: Number(before.credit_limit) })).resolves.toBeTruthy();
    expect((await stored()).notes).toBe('rest edit');
    await expect(update(billingEditor, { credit_limit: 12345 })).resolves.toBeTruthy();
    expect(Number((await stored()).credit_limit)).toBe(12345);
  });
});
