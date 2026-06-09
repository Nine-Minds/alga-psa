/**
 * T044/T045/T047/T048 — company-mapping persistence + resolvers against the
 * REAL local dev DB (shared CE table tenant_external_entity_mappings).
 *
 * The knex-level functions are exercised directly (the system_settings auth
 * gate is unit-covered in huduMappingActions.test.ts). Fixtures: a random-uuid
 * tenant + two clients, fully deleted in afterAll; each test clears the
 * tenant's mapping rows first (vitest shuffles).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import knexFactory, { type Knex } from 'knex';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

import {
  clearHuduCompanyMappingRow,
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
let tenantId: string;
let clientA: string;
let clientB: string;

describe('hudu company mappings — DB integration', () => {
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
    });

    await db.raw('select 1');

    // The shared CE table normally already exists in the dev DB. If it does
    // not, bootstrap it from the CE migration + the later tenant_id→tenant
    // column standardization so the schema matches production.
    if (!(await db.schema.hasTable(HUDU_MAPPING_TABLE))) {
      const migration = require(
        path.resolve(repoRoot, 'server', 'migrations', '20250502173321_create_tenant_external_entity_mappings.cjs')
      );
      await migration.up(db);
      if (await db.schema.hasColumn(HUDU_MAPPING_TABLE, 'tenant_id')) {
        await db.raw(`ALTER TABLE ${HUDU_MAPPING_TABLE} RENAME COLUMN tenant_id TO tenant`);
      }
    }

    tenantId = randomUUID();
    await db('tenants').insert({
      tenant: tenantId,
      client_name: 'Hudu Mapping Test Tenant',
      email: `hudu-mapping-${tenantId}@example.test`,
    });

    const inserted = await db('clients')
      .insert([
        { tenant: tenantId, client_name: 'Acme Corp' },
        { tenant: tenantId, client_name: 'Globex Corporation' },
      ])
      .returning(['client_id', 'client_name']);
    clientA = inserted.find((c: any) => c.client_name === 'Acme Corp').client_id;
    clientB = inserted.find((c: any) => c.client_name === 'Globex Corporation').client_id;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    if (db && tenantId) {
      await db(HUDU_MAPPING_TABLE).where({ tenant: tenantId }).del().catch(() => undefined);
      await db('clients').where({ tenant: tenantId }).del().catch(() => undefined);
      await db('tenants').where({ tenant: tenantId }).del().catch(() => undefined);
    }
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await db(HUDU_MAPPING_TABLE).where({ tenant: tenantId }).del();
  });

  it('T044: setHuduCompanyMappingRow writes the expected row shape', async () => {
    const result = await setHuduCompanyMappingRow(db, tenantId, {
      clientId: clientA,
      huduCompanyId: 101,
      metadata: {
        hudu_company_name: 'Acme Corp',
        id_in_integration: clientA,
        url: 'https://hudu.example.com/companies/101',
      },
    });

    expect(result).toMatchObject({ ok: true });
    const mapping = (result as unknown as { mapping: Record<string, unknown> }).mapping;
    expect(mapping).toMatchObject({
      tenant: tenantId,
      integration_type: 'hudu',
      alga_entity_type: 'client',
      alga_entity_id: clientA,
      external_entity_id: '101',
      external_realm_id: null,
      sync_status: 'manual_link',
      metadata: {
        hudu_company_name: 'Acme Corp',
        id_in_integration: clientA,
        url: 'https://hudu.example.com/companies/101',
      },
    });
    expect(mapping.id).toBeTruthy();

    const rows = await db(HUDU_MAPPING_TABLE).where({ tenant: tenantId });
    expect(rows).toHaveLength(1);
    expect(rows[0].external_entity_id).toBe('101');

    // Listing joins the mapped client's name from clients.
    const listed = await getHuduCompanyMappingRows(db, tenantId);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      external_entity_id: '101',
      alga_entity_id: clientA,
      client_name: 'Acme Corp',
    });
  });

  it('T045: one-to-one is enforced in both directions; replace requires explicit clear+set', async () => {
    const first = await setHuduCompanyMappingRow(db, tenantId, { clientId: clientA, huduCompanyId: 101 });
    expect(first).toMatchObject({ ok: true });

    // Same client → another company: rejected.
    const clientTaken = await setHuduCompanyMappingRow(db, tenantId, { clientId: clientA, huduCompanyId: 202 });
    expect(clientTaken).toMatchObject({ ok: false, code: 'client_already_mapped' });
    expect((clientTaken as { message: string }).message).toContain('101');

    // Same company → another client: rejected.
    const companyTaken = await setHuduCompanyMappingRow(db, tenantId, { clientId: clientB, huduCompanyId: 101 });
    expect(companyTaken).toMatchObject({ ok: false, code: 'company_already_mapped' });

    expect(await db(HUDU_MAPPING_TABLE).where({ tenant: tenantId })).toHaveLength(1);

    // The DB itself backstops both directions (unique indexes → 23505).
    await expect(
      db(HUDU_MAPPING_TABLE).insert({
        tenant: tenantId,
        integration_type: 'hudu',
        alga_entity_type: 'client',
        alga_entity_id: clientA, // duplicate client
        external_entity_id: '999',
        sync_status: 'manual_link',
      })
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      db(HUDU_MAPPING_TABLE).insert({
        tenant: tenantId,
        integration_type: 'hudu',
        alga_entity_type: 'client',
        alga_entity_id: clientB,
        external_entity_id: '101', // duplicate company (realm null coalesces equal)
        sync_status: 'manual_link',
      })
    ).rejects.toMatchObject({ code: '23505' });

    // Replace is explicit clear+set.
    expect(await clearHuduCompanyMappingRow(db, tenantId, { huduCompanyId: 101 })).toBe(1);
    const replaced = await setHuduCompanyMappingRow(db, tenantId, { clientId: clientB, huduCompanyId: 101 });
    expect(replaced).toMatchObject({ ok: true });
    const rows = await db(HUDU_MAPPING_TABLE).where({ tenant: tenantId });
    expect(rows).toHaveLength(1);
    expect(rows[0].alga_entity_id).toBe(clientB);
  });

  it('T047: clearHuduCompanyMappingRow removes the row (by company id and by mapping id)', async () => {
    const created = await setHuduCompanyMappingRow(db, tenantId, { clientId: clientA, huduCompanyId: 101 });
    expect(created).toMatchObject({ ok: true });

    expect(await clearHuduCompanyMappingRow(db, tenantId, { huduCompanyId: 101 })).toBe(1);
    expect(await db(HUDU_MAPPING_TABLE).where({ tenant: tenantId })).toHaveLength(0);
    // Clearing again is a no-op (0 rows), which the action maps to not_found.
    expect(await clearHuduCompanyMappingRow(db, tenantId, { huduCompanyId: 101 })).toBe(0);

    const again = await setHuduCompanyMappingRow(db, tenantId, { clientId: clientA, huduCompanyId: 102 });
    const mappingId = (again as { mapping: { id: string } }).mapping.id;
    expect(await clearHuduCompanyMappingRow(db, tenantId, { mappingId })).toBe(1);
    expect(await db(HUDU_MAPPING_TABLE).where({ tenant: tenantId })).toHaveLength(0);
  });

  it('T048: resolvers work both directions and return null when unmapped', async () => {
    await setHuduCompanyMappingRow(db, tenantId, { clientId: clientA, huduCompanyId: 101 });

    expect(await resolveHuduCompanyIdForClient(db, tenantId, clientA)).toBe('101');
    expect(await resolveClientIdForHuduCompany(db, tenantId, 101)).toBe(clientA);
    // Company id resolves identically as number or string.
    expect(await resolveClientIdForHuduCompany(db, tenantId, '101')).toBe(clientA);

    expect(await resolveHuduCompanyIdForClient(db, tenantId, clientB)).toBeNull();
    expect(await resolveClientIdForHuduCompany(db, tenantId, 999)).toBeNull();
    // Other-tenant lookups never leak across tenants.
    expect(await resolveClientIdForHuduCompany(db, randomUUID(), 101)).toBeNull();
  });
});
