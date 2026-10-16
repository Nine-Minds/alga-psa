import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import fs from 'node:fs';
import path from 'node:path';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../test-utils/testMocks';
import { createSeatClient, ensureFixtureTenant } from '../../../test-utils/perSeatFixtures';

// REST contracts API parity (alga-2026-0002744): API-created contracts must be
// indistinguishable from wizard-created ones (client_contracts row), create-with-lines
// is atomic, DELETE follows the UI rules, assignments can repair an orphaned contract.

let db: Knex;
let tenantId: string;
let Contract: typeof import('@alga-psa/billing/models/contract').default;
let ContractLineService: typeof import('../../lib/api/services/ContractLineService').ContractLineService;
let schemas: typeof import('../../lib/api/schemas/contractLineSchemas');

vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    // A real transaction, so a rejected submission rolls back like production.
    withTransaction: vi.fn(async (knexOrTrx: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
      (knexOrTrx as Knex).transaction((trx) => callback(trx)),
    ),
    requireTenantId: vi.fn(async () => tenantId),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null),
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(
        { user_id: 'per-seat-test-user', tenant: tenantId, roles: [{ role_name: 'Admin' }] } as any,
        { tenant: tenantId },
        ...args,
      ),
}));

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../test-utils/authModuleMock');
  const { withAuth } = await import('@alga-psa/auth/withAuth');
  return { ...createAuthModuleMock(), withAuth };
});

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

const HOOK_TIMEOUT = 180_000;

let apiContext: { tenant: string; userId: string };

function apiService() {
  const service = new ContractLineService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: tenantId });
  return service;
}

// addContractLine validates the id against contract_lines (getExistingPlan, pre-existing) and then
// clones it from contract_template_lines, so a usable line id needs both rows. Both are inserted
// directly: POST /contract-lines itself writes audit columns this table lacks (pre-existing).
async function templateLine(_service?: unknown) {
  const templateId = uuidv4();
  const id = uuidv4();
  await db('contract_templates').insert({
    tenant: tenantId,
    template_id: templateId,
    template_name: `Template ${id.slice(0, 6)}`,
    default_billing_frequency: 'monthly',
    template_status: 'published',
  });
  await db('contract_template_lines').insert({
    tenant: tenantId,
    template_line_id: id,
    template_id: templateId,
    template_line_name: `Line ${id.slice(0, 6)}`,
    billing_frequency: 'monthly',
    line_type: 'Fixed',
    custom_rate: 100,
    is_active: true,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await db('contract_lines').insert({
    tenant: tenantId,
    contract_line_id: id,
    contract_line_name: `Line ${id.slice(0, 6)}`,
    billing_frequency: 'monthly',
    is_custom: false,
    contract_line_type: 'Fixed',
  });
  return id;
}

const assignmentsOf = (contractId: string) =>
  db('client_contracts').where({ tenant: tenantId, contract_id: contractId });

const base = (clientId: string) => ({
  contract_name: `API contract ${uuidv4().slice(0, 6)}`,
  client_id: clientId,
  billing_frequency: 'monthly',
  start_date: '2025-01-01',
  status: 'active',
});

describe('REST contracts API parity', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection();
    await db.migrate.latest();
    tenantId = await ensureFixtureTenant(db);
    setupCommonMocks({ tenantId, userId: 'per-seat-test-user', permissionCheck: () => true });
    apiContext = { tenant: tenantId, userId: uuidv4() };
    ({ default: Contract } = await import('@alga-psa/billing/models/contract'));
    ({ ContractLineService } = await import('../../lib/api/services/ContractLineService'));
    schemas = await import('../../lib/api/schemas/contractLineSchemas');
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    vi.restoreAllMocks();
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('(a) POST creates the client_contracts row and the contract is listed by getAllWithClients', async () => {
    const service = apiService();
    const client = await createSeatClient(db, tenantId);
    const created: any = await service.createContract(schemas.createContractSchema.parse(base(client.clientId)), apiContext as any);

    const rows = await assignmentsOf(created.contract_id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ client_id: client.clientId, is_active: true });
    expect(created.assignment.client_contract_id).toBe(rows[0].client_contract_id);

    const visible = await Contract.getAllWithClients(db, tenantId);
    expect(visible.map((c: any) => c.contract_id)).toContain(created.contract_id);
  }, HOOK_TIMEOUT);

  it('requires a client', () => {
    const { client_id: _c, ...noClient } = base(uuidv4());
    expect(schemas.createContractSchema.safeParse(noClient).success).toBe(false);
  });

  it('(b) create-with-lines commits together and rolls back completely on an invalid line', async () => {
    const service = apiService();
    const client = await createSeatClient(db, tenantId);
    const lineId = await templateLine(service);

    const ok: any = await service.createContract(
      schemas.createContractSchema.parse({ ...base(client.clientId), lines: [{ contract_line_id: lineId }] }),
      apiContext as any,
    );
    expect(ok.contract_lines).toHaveLength(1);
    expect(await db('contract_lines').where({ tenant: tenantId, contract_id: ok.contract_id })).toHaveLength(1);

    const failing = base(client.clientId);
    await expect(
      service.createContract(
        schemas.createContractSchema.parse({ ...failing, lines: [{ contract_line_id: lineId }, { contract_line_id: uuidv4() }] }),
        apiContext as any,
      ),
    ).rejects.toThrow();
    expect(await db('contracts').where({ tenant: tenantId, contract_name: failing.contract_name })).toHaveLength(0);
    expect(await db('client_contracts').where({ tenant: tenantId, client_id: client.clientId })).toHaveLength(1);
  }, HOOK_TIMEOUT);

  it('(c) GET/PUT/DELETE work; DELETE refuses system-managed and invoiced contracts', async () => {
    const service = apiService();
    const client = await createSeatClient(db, tenantId);
    const created: any = await service.createContract(schemas.createContractSchema.parse(base(client.clientId)), apiContext as any);

    const got: any = await service.getContract(created.contract_id, apiContext as any);
    expect(got.assignments).toHaveLength(1);

    const updated: any = await service.updateContract(created.contract_id, { contract_name: 'Renamed' } as any, apiContext as any);
    expect(updated.contract_name).toBe('Renamed');

    // System-managed: 422
    const sys: any = await service.createContract(schemas.createContractSchema.parse(base(client.clientId)), apiContext as any);
    await db('contracts').where({ tenant: tenantId, contract_id: sys.contract_id }).update({ is_system_managed_default: true });
    await expect(service.deleteContract(sys.contract_id, apiContext as any)).rejects.toMatchObject({ statusCode: 422 });

    // Invoiced: 409
    const inv: any = await service.createContract(schemas.createContractSchema.parse(base(client.clientId)), apiContext as any);
    vi.spyOn(Contract, 'hasInvoices').mockResolvedValueOnce(true);
    await expect(service.deleteContract(inv.contract_id, apiContext as any)).rejects.toMatchObject({ statusCode: 409 });

    // Missing: 404
    await expect(service.deleteContract(uuidv4(), apiContext as any)).rejects.toMatchObject({ statusCode: 404 });

    await service.deleteContract(created.contract_id, apiContext as any);
    expect(await db('contracts').where({ tenant: tenantId, contract_id: created.contract_id })).toHaveLength(0);
    expect(await assignmentsOf(created.contract_id)).toHaveLength(0);
  }, HOOK_TIMEOUT);

  it('(d) assignment endpoints assign an orphaned contract to its owner and activate it', async () => {
    const service = apiService();
    const client = await createSeatClient(db, tenantId);
    const contractId = uuidv4();
    // The Foreground shape: owner_client_id set, no client_contracts row.
    await db('contracts').insert({
      tenant: tenantId,
      contract_id: contractId,
      contract_name: 'ATP Managed Services',
      owner_client_id: client.clientId,
      billing_frequency: 'monthly',
      is_active: true,
      is_template: false,
      status: 'draft',
      currency_code: 'USD',
    });
    expect(await assignmentsOf(contractId)).toHaveLength(0);

    const created: any = await service.createContractAssignment(
      contractId,
      schemas.createContractAssignmentSchema.parse({ start_date: '2025-01-01' }),
      apiContext as any,
    );
    expect(created.client_id).toBe(client.clientId);
    expect(await service.listContractAssignments(contractId, apiContext as any)).toHaveLength(1);

    // A second assignment is a conflict; a different client is refused.
    await expect(
      service.createContractAssignment(contractId, { start_date: '2025-02-01' } as any, apiContext as any),
    ).rejects.toMatchObject({ statusCode: 409 });

    const activated: any = await service.updateContractAssignment(
      contractId,
      created.client_contract_id,
      { is_active: true } as any,
      apiContext as any,
    );
    expect(activated.is_active).toBe(true);

    const visible = await Contract.getAllWithClients(db, tenantId);
    expect(visible.map((c: any) => c.contract_id)).toContain(contractId);

    await service.deleteContractAssignment(contractId, created.client_contract_id, apiContext as any);
    expect(await assignmentsOf(contractId)).toHaveLength(0);
  }, HOOK_TIMEOUT);

  it('(e) links have no doubled segments and point at registered routes', async () => {
    const service = apiService();
    const client = await createSeatClient(db, tenantId);
    const created: any = await service.createContract(schemas.createContractSchema.parse(base(client.clientId)), apiContext as any);

    const hrefs: Array<{ href: string; method: string }> = [
      ...Object.values(created._links as Record<string, any>),
      ...Object.values(created.assignment._links as Record<string, any>),
    ];
    const routeFiles = fs.readFileSync(path.resolve(__dirname, '../../../../docs/openapi/route-inventory.json'), 'utf8');
    const inventory = JSON.parse(routeFiles) as Array<{ route_path: string; methods: string[] }>;

    for (const { href, method } of hrefs) {
      expect(href.startsWith('/api/v1/')).toBe(true);
      const segments = href.split('/').filter(Boolean);
      for (let i = 1; i < segments.length; i++) expect(segments[i]).not.toBe(segments[i - 1]);
      const normalised = href.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '{id}');
      const matches = inventory.some(
        (r) => r.route_path.replace(/\{[^}]+\}/g, '{id}') === normalised && r.methods.includes(method),
      );
      expect(matches, `${method} ${href} -> no registered route`).toBe(true);
    }
  }, HOOK_TIMEOUT);
});
