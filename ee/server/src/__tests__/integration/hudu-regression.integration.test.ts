/**
 * T112 (DB half) — tenant isolation for Hudu company mappings against the
 * REAL local dev DB: tenant A's mapping rows are invisible to every
 * tenant-B-scoped query (list + both resolvers), and the same Hudu company id
 * can be mapped independently per tenant (the unique indexes are
 * tenant-scoped). The unit half (tenant-prefixed reference-cache keys) lives
 * in huduRegression.test.ts.
 *
 * Same harness as hudu-company-mappings.integration.test.ts: single-connection
 * pool holding pg_advisory_lock('hudu-db-integration-tests') for the whole
 * file (serializes against the migration test's DROP TABLE), random-uuid
 * tenants fully deleted in afterAll, beforeEach re-seeds (vitest shuffles).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import knexFactory, { type Knex } from 'knex';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

import {
  getHuduCompanyMappingRows,
  resolveClientIdForHuduCompany,
  resolveHuduCompanyIdForClient,
  setHuduCompanyMappingRow,
} from '../../lib/integrations/hudu/companyMapping';
import { HUDU_MAPPING_TABLE } from '../../lib/integrations/hudu/contracts';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(process.cwd(), '..', '..');

function readPostgresPassword(): string {
  try {
    return fs.readFileSync(path.join(repoRoot, 'secrets', 'postgres_password'), 'utf8').trim();
  } catch {
    return process.env.DB_PASSWORD_ADMIN || 'postpass123';
  }
}

let db: Knex;
let tenantA: string;
let tenantB: string;
let clientA: string;
let clientB: string;

const HUDU_COMPANY_ID = 101;

describe('hudu regression — tenant isolation (DB)', () => {
  const HOOK_TIMEOUT = 60_000;

  beforeAll(async () => {
    db = knexFactory({
      client: 'pg',
      connection: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        user: process.env.DB_USER_ADMIN || 'postgres',
        password: readPostgresPassword(),
        database: process.env.HUDU_TEST_DB_NAME || 'server',
      },
      // Single connection so the advisory lock below is held for the whole file.
      pool: { min: 1, max: 1 },
    });

    await db.raw('select 1');
    // Serialize against the other hudu DB files (migration DROP TABLE vs
    // tenants cascade-delete deadlock when run in parallel).
    await db.raw("select pg_advisory_lock(hashtext('hudu-db-integration-tests'))");

    if (!(await db.schema.hasTable(HUDU_MAPPING_TABLE))) {
      const migration = require(
        path.resolve(repoRoot, 'server', 'migrations', '20250502173321_create_tenant_external_entity_mappings.cjs')
      );
      await migration.up(db);
      if (await db.schema.hasColumn(HUDU_MAPPING_TABLE, 'tenant_id')) {
        await db.raw(`ALTER TABLE ${HUDU_MAPPING_TABLE} RENAME COLUMN tenant_id TO tenant`);
      }
    }

    tenantA = randomUUID();
    tenantB = randomUUID();
    await db('tenants').insert([
      { tenant: tenantA, client_name: 'Hudu Isolation Tenant A', email: `hudu-iso-a-${tenantA}@example.test` },
      { tenant: tenantB, client_name: 'Hudu Isolation Tenant B', email: `hudu-iso-b-${tenantB}@example.test` },
    ]);

    const insertedA = await db('clients')
      .insert({ tenant: tenantA, client_name: 'Tenant A Client' })
      .returning(['client_id']);
    const insertedB = await db('clients')
      .insert({ tenant: tenantB, client_name: 'Tenant B Client' })
      .returning(['client_id']);
    clientA = insertedA[0].client_id;
    clientB = insertedB[0].client_id;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    if (db && tenantA && tenantB) {
      await db(HUDU_MAPPING_TABLE).whereIn('tenant', [tenantA, tenantB]).del().catch(() => undefined);
      await db('clients').whereIn('tenant', [tenantA, tenantB]).del().catch(() => undefined);
      await db('tenants').whereIn('tenant', [tenantA, tenantB]).del().catch(() => undefined);
    }
    await db?.raw('select pg_advisory_unlock_all()').catch(() => undefined);
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await db(HUDU_MAPPING_TABLE).whereIn('tenant', [tenantA, tenantB]).del();
    // Tenant A maps Hudu company 101 → its client. Tenant B has NO mappings
    // unless a test creates them.
    const created = await setHuduCompanyMappingRow(db, tenantA, {
      clientId: clientA,
      huduCompanyId: HUDU_COMPANY_ID,
      metadata: { hudu_company_name: 'Acme (Tenant A)' },
    });
    expect(created).toMatchObject({ ok: true });
  });

  it("T112: tenant A's mapping rows are invisible to tenant B queries", async () => {
    // Tenant A sees its own row…
    const rowsA = await getHuduCompanyMappingRows(db, tenantA);
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0]).toMatchObject({
      tenant: tenantA,
      alga_entity_id: clientA,
      external_entity_id: String(HUDU_COMPANY_ID),
    });

    // …tenant B sees nothing at all.
    expect(await getHuduCompanyMappingRows(db, tenantB)).toEqual([]);

    // Both resolvers come back empty for tenant B, even for tenant A's ids.
    expect(await resolveHuduCompanyIdForClient(db, tenantB, clientA)).toBeNull();
    expect(await resolveClientIdForHuduCompany(db, tenantB, HUDU_COMPANY_ID)).toBeNull();

    // And an unknown tenant sees nothing either.
    const ghostTenant = randomUUID();
    expect(await getHuduCompanyMappingRows(db, ghostTenant)).toEqual([]);
    expect(await resolveClientIdForHuduCompany(db, ghostTenant, HUDU_COMPANY_ID)).toBeNull();
  });

  it('T112: the same Hudu company id maps independently per tenant and resolves per tenant', async () => {
    // Tenant B can map the SAME external company id to its own client — the
    // one-to-one unique indexes are tenant-scoped.
    const createdB = await setHuduCompanyMappingRow(db, tenantB, {
      clientId: clientB,
      huduCompanyId: HUDU_COMPANY_ID,
      metadata: { hudu_company_name: 'Acme (Tenant B)' },
    });
    expect(createdB).toMatchObject({ ok: true });

    // Each tenant resolves company 101 to ITS OWN client.
    expect(await resolveClientIdForHuduCompany(db, tenantA, HUDU_COMPANY_ID)).toBe(clientA);
    expect(await resolveClientIdForHuduCompany(db, tenantB, HUDU_COMPANY_ID)).toBe(clientB);
    expect(await resolveHuduCompanyIdForClient(db, tenantA, clientA)).toBe(String(HUDU_COMPANY_ID));
    expect(await resolveHuduCompanyIdForClient(db, tenantB, clientB)).toBe(String(HUDU_COMPANY_ID));

    // Cross-tenant lookups still resolve to nothing.
    expect(await resolveHuduCompanyIdForClient(db, tenantA, clientB)).toBeNull();
    expect(await resolveHuduCompanyIdForClient(db, tenantB, clientA)).toBeNull();

    // Each tenant's list contains exactly its own row.
    const rowsA = await getHuduCompanyMappingRows(db, tenantA);
    const rowsB = await getHuduCompanyMappingRows(db, tenantB);
    expect(rowsA).toHaveLength(1);
    expect(rowsB).toHaveLength(1);
    expect(rowsA[0].alga_entity_id).toBe(clientA);
    expect(rowsB[0].alga_entity_id).toBe(clientB);
    expect(rowsA[0].client_name).toBe('Tenant A Client');
    expect(rowsB[0].client_name).toBe('Tenant B Client');
  });
});
