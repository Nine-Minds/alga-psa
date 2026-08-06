import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { ContractLineService } from '@/lib/api/services/ContractLineService';

type Fixture = {
  tenantId: string;
  clientId: string;
  contractId: string;
  contractLineId: string;
};

type ColumnInfoMap = Record<string, unknown>;

let db: Knex;
const tenantsToCleanup = new Set<string>();
let tenantColumns: ColumnInfoMap;
let clientColumns: ColumnInfoMap;
let contractColumns: ColumnInfoMap;
let contractLineColumns: ColumnInfoMap;

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
  await tenantTable(tenantId, 'contract_line_service_configuration').del();
  await tenantTable(tenantId, 'client_contracts').del();
  await tenantTable(tenantId, 'contract_lines').del();
  await tenantTable(tenantId, 'contracts').del();
  await tenantTable(tenantId, 'clients').del();
  await tenantRows().where({ tenant: tenantId }).del();
}

const FIXTURE_START_DATE = '2026-08-01T00:00:00.000Z';
const FIXTURE_END_DATE = '2027-07-31T23:59:59.999Z';

async function createFixture(): Promise<Fixture> {
  const tenantId = uuidv4();
  const clientId = uuidv4();
  const contractId = uuidv4();
  const contractLineId = uuidv4();

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

  await tenantTable(tenantId, 'contracts').insert({
    tenant: tenantId,
    contract_id: contractId,
    contract_name: `Contract ${tenantId.slice(0, 8)}`,
    billing_frequency: 'monthly',
    ...(hasColumn(contractColumns, 'owner_client_id') ? { owner_client_id: clientId } : {}),
    ...(hasColumn(contractColumns, 'is_template') ? { is_template: false } : {}),
    ...(hasColumn(contractColumns, 'start_date') ? { start_date: FIXTURE_START_DATE } : {}),
    ...(hasColumn(contractColumns, 'end_date') ? { end_date: FIXTURE_END_DATE } : {}),
    ...(hasColumn(contractColumns, 'status') ? { status: 'draft' } : {}),
    ...(hasColumn(contractColumns, 'is_active') ? { is_active: true } : {}),
    ...(hasColumn(contractColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(contractColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await tenantTable(tenantId, 'contract_lines').insert({
    tenant: tenantId,
    contract_line_id: contractLineId,
    contract_line_name: `Line ${tenantId.slice(0, 8)}`,
    billing_frequency: 'monthly',
    ...(hasColumn(contractLineColumns, 'contract_id') ? { contract_id: contractId } : {}),
    ...(hasColumn(contractLineColumns, 'contract_line_type') ? { contract_line_type: 'Fixed' } : {}),
    ...(hasColumn(contractLineColumns, 'is_active') ? { is_active: true } : {}),
    ...(hasColumn(contractLineColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(contractLineColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  return { tenantId, clientId, contractId, contractLineId };
}

function serviceFor(fixture: Fixture): ContractLineService {
  const service = new ContractLineService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: fixture.tenantId });
  return service;
}

describe('contract line service list integration', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    tenantColumns = await schemaTable('tenants').columnInfo();
    clientColumns = await schemaTable('clients').columnInfo();
    contractColumns = await schemaTable('contracts').columnInfo();
    contractLineColumns = await schemaTable('contract_lines').columnInfo();
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

  // Regression: the GROUP BY omitted the tenant half of the composite primary
  // key, so Postgres rejected every non-aggregated column and the endpoint 500'd.
  it('lists client-owned contracts without a GROUP BY error', async () => {
    const fixture = await createFixture();
    const service = serviceFor(fixture);

    const result = await service.listContracts(
      { page: 1, limit: 25 },
      { tenant: fixture.tenantId, userId: uuidv4() } as any,
    );

    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);

    const [contract] = result.data as any[];
    expect(contract.contract_id).toBe(fixture.contractId);
    expect(contract.owner_client_id).toBe(fixture.clientId);
    expect(contract.owner_client_name).toBe(`Owner Client ${fixture.tenantId.slice(0, 8)}`);
    expect(contract.total_plans).toBe(1);
  });

  // Regression: the explicit select list dropped the public create fields, so
  // GET /api/v1/contracts silently lost `client_id`, `start_date` and
  // `end_date` that POST /api/v1/contracts had just returned.
  it('projects the public create fields (client_id, start_date, end_date, is_template)', async () => {
    const fixture = await createFixture();
    const service = serviceFor(fixture);

    const result = await service.listContracts(
      { page: 1, limit: 25 },
      { tenant: fixture.tenantId, userId: uuidv4() } as any,
    );

    const [contract] = result.data as any[];
    expect(contract.client_id).toBe(fixture.clientId);
    expect(contract.is_template).toBe(false);
    expect(new Date(contract.start_date).toISOString()).toBe(FIXTURE_START_DATE);
    expect(new Date(contract.end_date).toISOString()).toBe(FIXTURE_END_DATE);
  });

  it('lists contract lines with include_services without a GROUP BY error', async () => {
    const fixture = await createFixture();
    const service = serviceFor(fixture);

    const result = await service.listWithOptions(
      { page: 1, limit: 25 },
      { tenant: fixture.tenantId, userId: uuidv4() } as any,
      { includeServices: true },
    );

    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);

    const [line] = result.data as any[];
    expect(line.contract_line_id).toBe(fixture.contractLineId);
    expect(line.contract_line_name).toBe(`Line ${fixture.tenantId.slice(0, 8)}`);
    expect(Number(line.total_services)).toBe(0);
  });
});
