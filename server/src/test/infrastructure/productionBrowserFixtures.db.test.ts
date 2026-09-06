import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { createProductionBrowserActors } from '../../../../e2e-tests/fixtures/database';

let db: Knex;
let trx: Knex.Transaction;
let sourceEmail: string;
const sourceHash = 'isolated-source-salt:isolated-source-password-hash';

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();
});
beforeEach(async () => {
  trx = await db.transaction();
  const tenant = randomUUID();
  sourceEmail = `source-${tenant}@example.invalid`;
  await trx('tenants').insert({ tenant, client_name: 'Isolated fixture source', email: sourceEmail, product_code: 'psa' });
  await trx('users').insert({ tenant, user_id: randomUUID(), username: sourceEmail, email: sourceEmail,
    hashed_password: sourceHash, user_type: 'internal', is_inactive: false });
});
afterEach(async () => { await trx?.rollback(); });
afterAll(async () => { await db?.destroy(); });

describe('production browser actor fixtures', () => {
  it('creates distinct tenants, canonical roles and correctly linked portal clients without leaking password material', async () => {
    const actors = await createProductionBrowserActors(trx, { sourceEmail });
    expect(actors.primary.tenantId).not.toBe(actors.secondary.tenantId);
    expect(JSON.stringify(actors)).not.toContain(sourceHash);
    const ids: string[] = [];
    for (const tenant of [actors.primary, actors.secondary]) {
      const users = [tenant.admin, tenant.technician, tenant.portal, tenant.siblingPortal];
      for (const user of users) {
        ids.push(user.userId);
        const row = await trx('users').where({ tenant: tenant.tenantId, user_id: user.userId }).first();
        expect(row).toMatchObject({ email: user.email, user_type: user.userType, hashed_password: sourceHash, is_inactive: false });
        const roles = await trx('user_roles as ur').join('roles as r', function () {
          this.on('r.tenant', '=', 'ur.tenant').andOn('r.role_id', '=', 'ur.role_id');
        }).where({ 'ur.tenant': tenant.tenantId, 'ur.user_id': user.userId }).select('r.role_name', 'r.msp', 'r.client');
        expect(roles).toEqual([{ role_name: user.role.split(':')[1], msp: user.userType === 'internal', client: user.userType === 'client' }]);
        if (user.contactId) {
          expect(await trx('contacts').where({ tenant: tenant.tenantId, contact_name_id: user.contactId }).first())
            .toMatchObject({ client_id: user.clientId, email: user.email });
        }
      }
      const grants = async (userId: string) => trx('user_roles as ur')
        .join('role_permissions as rp', function () { this.on('rp.tenant', '=', 'ur.tenant').andOn('rp.role_id', '=', 'ur.role_id'); })
        .join('permissions as p', function () { this.on('p.tenant', '=', 'rp.tenant').andOn('p.permission_id', '=', 'rp.permission_id'); })
        .where({ 'ur.tenant': tenant.tenantId, 'ur.user_id': userId, 'p.resource': 'user', 'p.action': 'create', 'p.msp': true })
        .select('p.permission_id');
      expect(await grants(tenant.admin.userId)).toHaveLength(1);
      expect(await grants(tenant.technician.userId)).toHaveLength(0);
      expect(tenant.portal.clientId).not.toBe(tenant.siblingPortal.clientId);
      expect(await trx('tenant_companies').where({ tenant: tenant.tenantId, is_default: true })).toHaveLength(1);
    }
    expect(new Set(ids).size).toBe(8);
  });

  it('rejects missing, ambiguous and uninitialized source accounts before creating tenants', async () => {
    const runId = randomUUID();
    await expect(createProductionBrowserActors(trx, { sourceEmail: 'absent@example.invalid', runId })).rejects.toThrow('exactly one initialized');
    await trx('users').where({ email: sourceEmail }).update({ hashed_password: 'uninitialized' });
    await expect(createProductionBrowserActors(trx, { sourceEmail, runId })).rejects.toThrow('exactly one initialized');
    await trx('users').where({ email: sourceEmail }).update({ hashed_password: sourceHash });
    const otherTenant = randomUUID();
    await trx('tenants').insert({ tenant: otherTenant, client_name: 'Ambiguous fixture source', email: sourceEmail, product_code: 'psa' });
    await trx('users').insert({ tenant: otherTenant, user_id: randomUUID(), username: `other-${sourceEmail}`, email: sourceEmail,
      hashed_password: sourceHash, user_type: 'internal', is_inactive: false });
    await expect(createProductionBrowserActors(trx, { sourceEmail, runId })).rejects.toThrow('exactly one initialized');
    expect(await trx('tenants').whereIn('client_name', [`Browser primary ${runId}`, `Browser secondary ${runId}`])).toHaveLength(0);
  });

  it('rolls back the first tenant when creating the second tenant fails', async () => {
    const runId = randomUUID();
    const forbiddenName = `Browser secondary ${runId}`;
    // PostgreSQL DDL does not accept bind parameters; Knex quotes this fixture
    // value when compiling the statement before it is sent to PostgreSQL.
    await trx.raw(trx.raw('ALTER TABLE tenants ADD CONSTRAINT browser_fixture_failure CHECK (client_name <> ?)', [forbiddenName]).toQuery());
    await expect(createProductionBrowserActors(trx, { sourceEmail, runId })).rejects.toThrow('browser_fixture_failure');
    expect(await trx('tenants').whereIn('client_name', [`Browser primary ${runId}`, forbiddenName])).toHaveLength(0);
    expect(await trx('users').where('email', 'like', `%${runId}@example.invalid`)).toHaveLength(0);
  });
});
