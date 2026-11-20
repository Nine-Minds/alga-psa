import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

import { BaseService, tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';

vi.mock('@/lib/api/middleware/withApiKeyRouteAuth', () => ({
  withApiKeyRouteAuth: (handler: unknown) => handler,
}));

let db: Knex;
let tenantId: string;
vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    withTransaction: vi.fn(async (knexOrTrx: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
      (knexOrTrx as Knex).transaction((trx) => callback(trx)),
    ),
  };
});

import { POST as attachContractLine } from '@/app/api/v1/contracts/[contractId]/contract-lines/route';

const tenantsToCleanup = new Set<string>();

function tenantTable(id: string, table: string) {
  return tenantDb(db, id).table(table);
}

function tenantRows() {
  return tenantDb(db, '__test_tenant_fixture__').unscoped('tenants', 'test fixture creates and removes tenant rows');
}

async function cleanupTenant(id: string): Promise<void> {
  await tenantTable(id, 'contract_lines').del();
  await tenantTable(id, 'contracts').del();
  await tenantTable(id, 'contract_template_lines').del();
  await tenantTable(id, 'contract_templates').del();
  await tenantRows().where({ tenant: id }).del();
}

function makeRequest(url: string, body: unknown) {
  const request = new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  (request as any).context = { tenant: tenantId, userId: uuidv4() };
  return request;
}

async function readJson(response: Response): Promise<any> {
  return response.json();
}

async function insertContract(): Promise<string> {
  const contractId = uuidv4();
  await tenantTable(tenantId, 'contracts').insert({
    tenant: tenantId,
    contract_id: contractId,
    contract_name: `Contract ${contractId.slice(0, 8)}`,
    billing_frequency: 'monthly',
  });
  return contractId;
}

async function insertStandaloneContractLine(): Promise<string> {
  const contractLineId = uuidv4();
  await tenantTable(tenantId, 'contract_lines').insert({
    tenant: tenantId,
    contract_line_id: contractLineId,
    contract_id: null,
    contract_line_name: 'Standalone contract line',
    billing_frequency: 'monthly',
    contract_line_type: 'Fixed',
  });
  return contractLineId;
}

describe('POST /api/v1/contracts/{contractId}/contract-lines', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    vi.spyOn(BaseService.prototype as any, 'getKnex').mockImplementation(async () => ({ knex: db, tenant: tenantId }));
  }, 180_000);

  beforeEach(async () => {
    tenantId = uuidv4();
    tenantsToCleanup.add(tenantId);
    await tenantRows().insert({
      tenant: tenantId,
      client_name: `Route Tenant ${tenantId.slice(0, 8)}`,
      email: `tenant-${tenantId.slice(0, 8)}@example.com`,
    });
  });

  afterEach(async () => {
    for (const id of tenantsToCleanup) await cleanupTenant(id);
    tenantsToCleanup.clear();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (db) await db.destroy();
  });

  it('returns 400 VALIDATION_ERROR for an existing standalone contract line', async () => {
    const contractId = await insertContract();
    const contractLineId = await insertStandaloneContractLine();
    const request = makeRequest(`http://localhost/api/v1/contracts/${contractId}/contract-lines`, {
      contract_line_id: contractLineId,
    });

    const response = await attachContractLine(request as any, { params: Promise.resolve({ contractId }) } as any);
    expect(response.status).toBe(400);
    const body = await readJson(response);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain(contractLineId);
    expect(body.error.message).toContain('Only contract-template lines can be cloned onto a contract through this endpoint');
  });

  it('clones a template line that has no corresponding live contract line', async () => {
    const contractId = await insertContract();
    const templateId = uuidv4();
    const templateLineId = uuidv4();
    await tenantTable(tenantId, 'contract_templates').insert({
      tenant: tenantId,
      template_id: templateId,
      template_name: 'Managed support template',
      currency_code: 'USD',
    });
    await tenantTable(tenantId, 'contract_template_lines').insert({
      tenant: tenantId,
      template_id: templateId,
      template_line_id: templateLineId,
      template_line_name: 'Managed support',
      line_type: 'Fixed',
      billing_frequency: 'monthly',
    });
    const request = makeRequest(`http://localhost/api/v1/contracts/${contractId}/contract-lines`, {
      contract_line_id: templateLineId,
    });

    const response = await attachContractLine(request as any, { params: Promise.resolve({ contractId }) } as any);
    expect(response.status).toBe(201);
    const { data } = await readJson(response);
    expect(data.contract_line_id).not.toBe(templateLineId);
    const clone = await tenantTable(tenantId, 'contract_lines')
      .where({ contract_line_id: data.contract_line_id })
      .first();
    expect(clone).toMatchObject({
      contract_id: contractId,
      contract_line_name: 'Managed support',
      contract_line_type: 'Fixed',
    });
  });

  it('preserves 404 for an absent contract line ID', async () => {
    const contractId = await insertContract();
    const absentContractLineId = uuidv4();
    const request = makeRequest(`http://localhost/api/v1/contracts/${contractId}/contract-lines`, {
      contract_line_id: absentContractLineId,
    });

    const response = await attachContractLine(request as any, { params: Promise.resolve({ contractId }) } as any);
    expect(response.status).toBe(404);
  });
});
