import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { ContractLineService } from '@/lib/api/services/ContractLineService';

type Fixture = {
  tenantId: string;
  clientId: string;
};

type ColumnInfoMap = Record<string, unknown>;

let db: Knex;
const tenantsToCleanup = new Set<string>();
let tenantColumns: ColumnInfoMap;
let clientColumns: ColumnInfoMap;

const START_DATE = '2026-08-01T00:00:00.000Z';
const END_DATE = '2027-07-31T23:59:59.999Z';

function hasColumn(columns: ColumnInfoMap, columnName: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns, columnName);
}

function tenantTable(tenantId: string, table: string) {
  return tenantDb(db, tenantId).table(table);
}

function tenantRows() {
  return tenantDb(db, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates and removes tenant rows');
}

function schemaTable(table: string) {
  return tenantDb(db, '__test_schema__')
    .unscoped(table, 'columnInfo reads schema metadata, not tenant rows');
}

async function cleanupTenant(tenantId: string): Promise<void> {
  await tenantTable(tenantId, 'contracts').del();
  await tenantTable(tenantId, 'clients').del();
  await tenantRows().where({ tenant: tenantId }).del();
}

async function createFixture(): Promise<Fixture> {
  const tenantId = uuidv4();
  const clientId = uuidv4();

  tenantsToCleanup.add(tenantId);

  await tenantRows().insert({
    tenant: tenantId,
    client_name: `Contract Tenant ${tenantId.slice(0, 8)}`,
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
    ...(hasColumn(tenantColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(tenantColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await tenantTable(tenantId, 'clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: `Owner Client ${tenantId.slice(0, 8)}`,
    ...(hasColumn(clientColumns, 'billing_cycle') ? { billing_cycle: 'monthly' } : {}),
    ...(hasColumn(clientColumns, 'is_tax_exempt') ? { is_tax_exempt: false } : {}),
    ...(hasColumn(clientColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(clientColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  return { tenantId, clientId };
}

function serviceFor(fixture: Fixture): ContractLineService {
  const service = new ContractLineService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: fixture.tenantId });
  return service;
}

describe('contract line service createContract persistence integration', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    tenantColumns = await schemaTable('tenants').columnInfo();
    clientColumns = await schemaTable('clients').columnInfo();
  });

  afterEach(async () => {
    for (const tenantId of tenantsToCleanup) {
      await cleanupTenant(tenantId);
    }
    tenantsToCleanup.clear();
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  // Regression alga0001984: the insert used to stamp created_by/updated_by,
  // columns the contracts table does not have, so every create 500'd (42703).
  it('persists a contract from the public create shape (client_id, start_date, end_date)', async () => {
    const fixture = await createFixture();
    const service = serviceFor(fixture);
    const context = { tenant: fixture.tenantId, userId: uuidv4() } as any;

    const created = await service.createContract(
      {
        client_id: fixture.clientId,
        contract_name: 'API Created Contract',
        billing_frequency: 'monthly',
        start_date: START_DATE,
        end_date: END_DATE,
        is_active: true,
      } as any,
      context,
    );

    // Response projects the public shape.
    expect(created.contract_id).toBeTruthy();
    expect((created as any).client_id).toBe(fixture.clientId);
    expect(created.owner_client_id).toBe(fixture.clientId);

    // Row actually persisted with the caller's values.
    const row = await tenantTable(fixture.tenantId, 'contracts')
      .where({ contract_id: created.contract_id })
      .first();

    expect(row).toBeTruthy();
    expect(row.owner_client_id).toBe(fixture.clientId);
    expect(row.contract_name).toBe('API Created Contract');
    expect(row.status).toBe('draft');
    // Explicitly non-template: the column defaults to true, which would hide
    // the contract from every non-template listing/report.
    expect(row.is_template).toBe(false);
    // timestamptz round-trip: the caller-supplied instants come back unshifted.
    expect(new Date(row.start_date).toISOString()).toBe(START_DATE);
    expect(new Date(row.end_date).toISOString()).toBe(END_DATE);
  });

  it('lists the created contract with the same public fields it returned on create', async () => {
    const fixture = await createFixture();
    const service = serviceFor(fixture);
    const context = { tenant: fixture.tenantId, userId: uuidv4() } as any;

    const created = await service.createContract(
      {
        client_id: fixture.clientId,
        contract_name: 'Roundtrip Contract',
        billing_frequency: 'monthly',
        start_date: START_DATE,
        end_date: END_DATE,
        is_active: true,
      } as any,
      context,
    );

    const result = await service.listContracts({ page: 1, limit: 25 }, context);

    const listed = (result.data as any[]).find((c) => c.contract_id === created.contract_id);
    expect(listed).toBeTruthy();
    expect(listed.client_id).toBe(fixture.clientId);
    expect(listed.owner_client_id).toBe(fixture.clientId);
    expect(new Date(listed.start_date).toISOString()).toBe(START_DATE);
    expect(new Date(listed.end_date).toISOString()).toBe(END_DATE);
  });
});
