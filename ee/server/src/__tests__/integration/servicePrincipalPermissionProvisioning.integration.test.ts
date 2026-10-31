/**
 * New-tenant permission gap (review item 3). Existing tenants get the service_principal
 * permissions from an EE migration; a tenant provisioned AFTER that migration is built from
 * the permission catalog by the onboarding seeds. The EE contribution under
 * ee/server/permission-catalog must put read/create/update/delete on MSP Admin there,
 * through the same seeds Temporal runs (roles -> permissions -> role grants).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../../../server/test-utils/dbConfig';
import { buildMergedEeMigrationsDir } from '../../../../../server/test-utils/eeMigrations';

const require = createRequire(import.meta.url);
const onboarding = path.resolve(__dirname, '../../../seeds/onboarding/psa');
const ACTIONS = ['create', 'delete', 'read', 'update'];

let db: Knex;
let mergedDir: string;

async function provisionTenant(product: string): Promise<string> {
  const tenant = uuidv4();
  await db('tenants').insert({
    tenant,
    client_name: `provision ${tenant.slice(0, 8)}`,
    email: `p-${tenant.slice(0, 8)}@example.com`,
    product_code: product,
  });
  // The seeds Temporal runs for a new tenant, in order.
  for (const seed of ['01_roles.cjs', '02_permissions.cjs', '03_role_permissions.cjs']) {
    await require(path.join(onboarding, seed)).seed(db, tenant);
  }
  return tenant;
}

async function grantedTo(tenant: string, roleName: string): Promise<string[]> {
  const rows = await tenantDb(db, tenant)
    .table('role_permissions as rp')
    .join('roles as r', function join() {
      this.on('r.role_id', 'rp.role_id').andOn('r.tenant', 'rp.tenant');
    })
    .join('permissions as p', function join() {
      this.on('p.permission_id', 'rp.permission_id').andOn('p.tenant', 'rp.tenant');
    })
    .where({ 'r.role_name': roleName, 'r.msp': true, 'p.resource': 'service_principal' })
    .select('p.action');
  return rows.map((row: { action: string }) => row.action).sort();
}

beforeAll(async () => {
  mergedDir = buildMergedEeMigrationsDir();
  db = await createTestDbConnection({ databaseName: 'sp_provisioning_test', migrationsDir: mergedDir });
}, 600_000);

afterAll(async () => {
  await db?.destroy();
  if (mergedDir) rmSync(mergedDir, { recursive: true, force: true });
});

describe('a freshly provisioned tenant', () => {
  it('has service_principal read/create/update/delete granted to MSP Admin', async () => {
    const tenant = await provisionTenant('psa');
    expect(await grantedTo(tenant, 'Admin')).toEqual(ACTIONS);
  });

  it('does not grant them to the other MSP roles, nor to client-portal roles', async () => {
    const tenant = await provisionTenant('psa');
    for (const role of ['Finance', 'Technician', 'Project Manager', 'Dispatcher']) {
      expect(await grantedTo(tenant, role)).toEqual([]);
    }
    const clientSide = await tenantDb(db, tenant).table('permissions').where({ resource: 'service_principal', client: true }).first();
    expect(clientSide).toBeUndefined();
  });

  it('is idempotent when the seeds replay', async () => {
    const tenant = await provisionTenant('psa');
    for (const seed of ['02_permissions.cjs', '03_role_permissions.cjs']) {
      await require(path.join(onboarding, seed)).seed(db, tenant);
    }
    expect(await grantedTo(tenant, 'Admin')).toEqual(ACTIONS);
  });
});
