import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

import { BaseService, tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';

// Route handlers must run without a live app server: bypass API-key auth and
// inject the authenticated context the handlers read via requireRequestContext.
vi.mock('@/lib/api/middleware/withApiKeyRouteAuth', () => ({
  withApiKeyRouteAuth: (handler: unknown) => handler,
}));

// The route/controller layer creates its own service instances, so point the
// inherited `getKnex()` at the test database and run the service's own
// `withTransaction` on a real transaction.
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

vi.mock('server/src/lib/eventBus/publishers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('server/src/lib/eventBus/publishers')>();
  return { ...actual, publishUnregisteredEventType: vi.fn(async () => undefined) };
});

vi.mock('@alga-psa/billing/lib/billing/utils/templateClone', () => ({
  cloneTemplateContractLine: vi.fn(async () => ({ appliedCustomRate: null })),
}));

import { POST as createContractLine, GET as listContractLines } from '@/app/api/v1/contract-lines/route';
import { PUT as updateContractLine } from '@/app/api/v1/contract-lines/[id]/route';
import { PUT as setActivation } from '@/app/api/v1/contract-lines/[id]/activation/route';
import { POST as bulkCreateContractLines } from '@/app/api/v1/contract-lines/bulk/create/route';

const tenantsToCleanup = new Set<string>();

function tenantTable(id: string, table: string) {
  return tenantDb(db, id).table(table);
}

function tenantRows() {
  return tenantDb(db, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates and removes tenant rows');
}

async function cleanupTenant(id: string): Promise<void> {
  await tenantTable(id, 'contract_lines').del();
  await tenantRows().where({ tenant: id }).del();
}

function contextFor(id: string) {
  return { tenant: id, userId: uuidv4() };
}

function makeRequest(url: string, method: string, body?: unknown, context?: { tenant: string; userId: string }) {
  const request = new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  (request as any).context = context ?? contextFor(tenantId);
  return request;
}

async function readJson(response: Response): Promise<any> {
  return response.json();
}

async function insertContractLine(name: string): Promise<string> {
  const contractLineId = uuidv4();
  await tenantTable(tenantId, 'contract_lines').insert({
    tenant: tenantId,
    contract_line_id: contractLineId,
    contract_line_name: name,
    billing_frequency: 'monthly',
    contract_line_type: 'Fixed',
  });
  return contractLineId;
}

describe('contract line route endpoints (no app server)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    // The route layer builds its own services; route their reads/writes here.
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
    for (const id of tenantsToCleanup) {
      await cleanupTenant(id);
    }
    tenantsToCleanup.clear();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (db) {
      await db.destroy();
    }
  });

  it('POST /api/v1/contract-lines creates a contract line', async () => {
    const request = makeRequest('http://localhost/api/v1/contract-lines', 'POST', {
      contract_line_name: 'Route created line',
      billing_frequency: 'monthly',
      contract_line_type: 'Fixed',
    });

    const response = await createContractLine(request as any);
    expect(response.status).toBe(201);
    const body = await readJson(response);
    expect(body.success).toBe(true);
    expect(body.data.contract_line_id).toBeTruthy();

    const row = await tenantTable(tenantId, 'contract_lines')
      .where({ contract_line_id: body.data.contract_line_id })
      .first();
    expect(row.contract_line_name).toBe('Route created line');
  });

  it('POST /api/v1/contract-lines/bulk/create creates multiple contract lines', async () => {
    const request = makeRequest('http://localhost/api/v1/contract-lines/bulk/create', 'POST', {
      plans: [
        { contract_line_name: 'Route bulk A', billing_frequency: 'monthly', contract_line_type: 'Fixed' },
        { contract_line_name: 'Route bulk B', billing_frequency: 'monthly', contract_line_type: 'Hourly' },
      ],
    });

    const response = await bulkCreateContractLines(request as any);
    expect(response.status).toBe(201);
    const body = await readJson(response);
    expect(body.data).toHaveLength(2);
  });

  it('PUT /api/v1/contract-lines/{id} updates a contract line', async () => {
    const contractLineId = await insertContractLine('Route update source');
    const request = makeRequest(`http://localhost/api/v1/contract-lines/${contractLineId}`, 'PUT', {
      contract_line_name: 'Route updated line',
    });

    const response = await updateContractLine(request as any, { params: Promise.resolve({ id: contractLineId }) } as any);
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.data.contract_line_name).toBe('Route updated line');
  });

  it('PUT /api/v1/contract-lines/{id}/activation toggles activation', async () => {
    const contractLineId = await insertContractLine('Route activation line');
    const request = makeRequest(`http://localhost/api/v1/contract-lines/${contractLineId}/activation`, 'PUT', {
      is_active: false,
    });

    const response = await setActivation(request as any, { params: Promise.resolve({ id: contractLineId }) } as any);
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.data.is_active).toBe(false);

    const row = await tenantTable(tenantId, 'contract_lines')
      .where({ contract_line_id: contractLineId })
      .first();
    expect(row.is_active).toBe(false);
  });

  it('GET /api/v1/contract-lines?updated_from= filters the list', async () => {
    const contractLineId = await insertContractLine('Route filter line');
    const row = await tenantTable(tenantId, 'contract_lines')
      .where({ contract_line_id: contractLineId })
      .first();
    const updatedAt = new Date(row.updated_at).getTime();

    const included = makeRequest(
      `http://localhost/api/v1/contract-lines?updated_from=${encodeURIComponent(new Date(updatedAt - 60_000).toISOString())}`,
      'GET',
    );
    const includedResponse = await listContractLines(included as any);
    expect(includedResponse.status).toBe(200);
    const includedBody = await readJson(includedResponse);
    expect(includedBody.data.map((line: any) => line.contract_line_id)).toContain(contractLineId);

    const excluded = makeRequest(
      `http://localhost/api/v1/contract-lines?updated_from=${encodeURIComponent(new Date(updatedAt + 60_000).toISOString())}`,
      'GET',
    );
    const excludedResponse = await listContractLines(excluded as any);
    expect(excludedResponse.status).toBe(200);
    const excludedBody = await readJson(excludedResponse);
    expect(excludedBody.data.map((line: any) => line.contract_line_id)).not.toContain(contractLineId);
  });
});
