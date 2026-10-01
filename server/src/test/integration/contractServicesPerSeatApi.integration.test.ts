import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../test-utils/testMocks';
import {
  createSeatCatalog,
  createSeatClient,
  ensureFixtureTenant,
  tenantTable,
  type SeatCatalogService,
} from '../../../test-utils/perSeatFixtures';

// Per-seat recurring services through the REST/MCP contract-line service API:
// create (pricing_basis, quantity, unit rate), update (must revise through the
// dated-revision path) and copy.

let db: Knex;
let tenantId: string;
let createClientContractFromWizard: typeof import('@alga-psa/billing/actions/contractWizardActions').createClientContractFromWizard;
let generateInvoice: typeof import('@alga-psa/billing/actions/invoiceGeneration').generateInvoice;
let syncRecurringServicePeriodsForContractLine: typeof import('@alga-psa/billing/actions/recurringServicePeriodSync').syncRecurringServicePeriodsForContractLine;
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

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

const HOOK_TIMEOUT = 180_000;
const DECEMBER_START = '2024-12-01';
const JANUARY_START = '2025-01-01';
const FEBRUARY_START = '2025-02-01';
const MARCH_START = '2025-03-01';

let apiContext: { tenant: string; userId: string };

function apiService() {
  const service = new ContractLineService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: tenantId });
  return service;
}

async function syncLine(contractLineId: string) {
  await db.transaction((trx) =>
    syncRecurringServicePeriodsForContractLine(trx, { tenant: tenantId, contractLineId, sourceRunPrefix: 'per-seat-api-test' }),
  );
}

async function fixedConfigFor(contractLineId: string, serviceId: string) {
  return tenantTable(db, tenantId, 'contract_line_service_configuration as c')
    .leftJoin('contract_line_service_fixed_config as f', function join() {
      this.on('f.config_id', 'c.config_id').andOn('f.tenant', 'c.tenant');
    })
    .where({ 'c.tenant': tenantId, 'c.contract_line_id': contractLineId, 'c.service_id': serviceId })
    .select('c.config_id', 'c.quantity', 'c.custom_rate as config_rate', 'f.base_rate', 'f.pricing_basis', 'f.rate_provenance')
    .first() as Promise<any>;
}

// A Fixed contract line for a client. The wizard needs one per-unit service to
// author a line, so a zero-seat placeholder anchors it (it bills nothing).
async function hostLine() {
  const [placeholder, user, endpoint, location] = await createSeatCatalog(db, tenantId, [
    { name: 'Anchor', rateCents: 100 },
    { name: 'Managed User', rateCents: 10000, prices: { EUR: 9000 } },
    { name: 'Managed Endpoint', rateCents: 5000, prices: { EUR: 4500 } },
    { name: 'Managed Location', rateCents: 20000 },
  ]);
  const client = await createSeatClient(db, tenantId);
  const januaryCycle = await client.addMonthlyCycle(JANUARY_START, FEBRUARY_START);
  const februaryCycle = await client.addMonthlyCycle(FEBRUARY_START, MARCH_START);
  const result: any = await createClientContractFromWizard({
    contract_name: `API host ${uuidv4().slice(0, 6)}`,
    client_id: client.clientId,
    start_date: DECEMBER_START,
    end_date: '2025-06-30',
    billing_frequency: 'monthly',
    enable_proration: false,
    fixed_services: [{ service_id: placeholder.serviceId, pricing_basis: 'unit', quantity: 0, unit_rate: 100 }],
    hourly_services: [],
    usage_services: [],
  } as any);
  expect(result, JSON.stringify(result)).toHaveProperty('contract_line_id');
  return { client, januaryCycle, februaryCycle, lineId: result.contract_line_id as string, user, endpoint, location };
}

const invoiceOf = (result: any) => {
  expect(result, JSON.stringify(result)).toBeTruthy();
  expect(result).not.toHaveProperty('error');
  return result;
};

describe('contract line API: per-seat recurring services', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection();
    await db.migrate.latest();
    tenantId = await ensureFixtureTenant(db);
    setupCommonMocks({ tenantId, userId: 'per-seat-test-user', permissionCheck: () => true });
    apiContext = { tenant: tenantId, userId: uuidv4() };
    ({ createClientContractFromWizard } = await import('@alga-psa/billing/actions/contractWizardActions'));
    ({ generateInvoice } = await import('@alga-psa/billing/actions/invoiceGeneration'));
    ({ syncRecurringServicePeriodsForContractLine } = await import('@alga-psa/billing/actions/recurringServicePeriodSync'));
    ({ ContractLineService } = await import('../../lib/api/services/ContractLineService'));
    schemas = await import('../../lib/api/schemas/contractLineSchemas');
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    vi.restoreAllMocks();
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('the request schemas keep pricing_basis and accept a zero per-unit quantity', () => {
    const parsed = schemas.addServiceToPlanSchema.parse({
      service_id: uuidv4(),
      quantity: 0,
      type_config: { pricing_basis: 'unit', base_rate: 10000 },
    });
    expect(parsed.quantity).toBe(0);
    expect(parsed.type_config).toEqual({ pricing_basis: 'unit', base_rate: 10000 });
    expect(schemas.updatePlanServiceSchema.parse({ quantity: 0 }).quantity).toBe(0);
    expect(() => schemas.addServiceToPlanSchema.parse({
      service_id: uuidv4(), type_config: { pricing_basis: 'per-moon' },
    })).toThrow();
    // Omitted basis stays omitted (server default is bundle).
    expect(schemas.addServiceToPlanSchema.parse({ service_id: uuidv4(), type_config: { base_rate: 5 } }).type_config)
      .toEqual({ base_rate: 5 });
  });

  it('adds per-unit services (basis, quantity, rate), bills $3,900, then revises through the boundary path', async () => {
    const service = apiService();
    const { lineId, januaryCycle, februaryCycle, user, endpoint, location } = await hostLine();

    await service.addServiceToPlan(lineId, { service_id: user.serviceId, quantity: 20, type_config: { pricing_basis: 'unit', base_rate: 10000 } } as any, apiContext as any);
    // No rate: follows the catalog.
    await service.addServiceToPlan(lineId, { service_id: endpoint.serviceId, quantity: 30, type_config: { pricing_basis: 'unit' } } as any, apiContext as any);
    // custom_rate is accepted as the unit-rate alias.
    await service.addServiceToPlan(lineId, { service_id: location.serviceId, quantity: 2, custom_rate: 20000, type_config: { pricing_basis: 'unit' } } as any, apiContext as any);

    const userConfig = await fixedConfigFor(lineId, user.serviceId);
    expect(userConfig).toMatchObject({ pricing_basis: 'unit', rate_provenance: 'custom' });
    expect(Number(userConfig.quantity)).toBe(20);
    expect(Number(userConfig.base_rate)).toBe(10000);
    expect(await fixedConfigFor(lineId, endpoint.serviceId)).toMatchObject({ pricing_basis: 'unit', rate_provenance: 'inherited', base_rate: null });
    const locationConfig = await fixedConfigFor(lineId, location.serviceId);
    expect(Number(locationConfig.base_rate)).toBe(20000);
    expect(locationConfig.config_rate).toBeNull();

    await syncLine(lineId);
    const january = invoiceOf(await generateInvoice(januaryCycle));
    expect(Number(january.subtotal)).toBe(390000);

    // Quantity update after January was billed: 20 -> 23 from the next unbilled boundary.
    await service.updatePlanService(lineId, user.serviceId, { quantity: 23 } as any, apiContext as any);
    // The January invoice is untouched and the stored baseline is not rewritten in place.
    const untouched = await tenantTable(db, tenantId, 'invoices').where({ tenant: tenantId, invoice_id: january.invoice_id }).first();
    expect(Number(untouched.subtotal)).toBe(390000);
    expect(Number((await fixedConfigFor(lineId, user.serviceId)).quantity)).toBe(20);

    const february = invoiceOf(await generateInvoice(februaryCycle));
    expect(Number(february.subtotal)).toBe(420000);

    // A unit-rate change (type_config.base_rate) is also boundary-only: no more
    // unbilled boundary exists here, so it is written directly only when nothing is billed.
  }, HOOK_TIMEOUT);

  it('a zero per-unit quantity is stored as zero; a bundle add keeps defaulting and rejecting as before', async () => {
    const service = apiService();
    const { lineId, user, endpoint } = await hostLine();
    await service.addServiceToPlan(lineId, { service_id: user.serviceId, quantity: 0, type_config: { pricing_basis: 'unit', base_rate: 10000 } } as any, apiContext as any);
    expect(Number((await fixedConfigFor(lineId, user.serviceId)).quantity)).toBe(0);

    // Existing behaviour: no type_config -> bundle, quantity defaults to 1.
    await service.addServiceToPlan(lineId, { service_id: endpoint.serviceId } as any, apiContext as any);
    const bundle = await fixedConfigFor(lineId, endpoint.serviceId);
    expect(bundle.pricing_basis ?? 'bundle').toBe('bundle');
    expect(Number(bundle.quantity)).toBe(1);
  }, HOOK_TIMEOUT);

  it.each([
    ['a fractional seat count', { quantity: 2.5, type_config: { pricing_basis: 'unit', base_rate: 100 } }, /whole number/i],
    ['a negative seat count', { quantity: -1, type_config: { pricing_basis: 'unit', base_rate: 100 } }, /zero or more/i],
    ['a fractional unit rate', { quantity: 2, type_config: { pricing_basis: 'unit', base_rate: 10.5 } }, /whole number of cents/i],
    ['disagreeing rates', { quantity: 2, custom_rate: 200, type_config: { pricing_basis: 'unit', base_rate: 100 } }, /disagree/i],
    ['a zero-quantity bundle service', { quantity: 0 }, /at least 1/i],
  ])('rejects %s on add', async (_label, body, message) => {
    const service = apiService();
    const { lineId, user } = await hostLine();
    await expect(
      service.addServiceToPlan(lineId, { service_id: user.serviceId, ...body } as any, apiContext as any),
    ).rejects.toThrow(message);
    expect(await fixedConfigFor(lineId, user.serviceId)).toBeUndefined();
  }, HOOK_TIMEOUT);

  it('rejects per-unit pricing on a product', async () => {
    const service = apiService();
    const { lineId, user } = await hostLine();
    await tenantTable(db, tenantId, 'service_catalog')
      .where({ tenant: tenantId, service_id: user.serviceId })
      .update({ item_kind: 'product', sku: `SKU-${user.serviceId.slice(0, 8)}` });
    await expect(
      service.addServiceToPlan(lineId, { service_id: user.serviceId, quantity: 2, type_config: { pricing_basis: 'unit', base_rate: 100 } } as any, apiContext as any),
    ).rejects.toThrow(/Products are billed by unit quantity/i);
  }, HOOK_TIMEOUT);

  it('cannot change the pricing basis by update, and rejects an invalid unit quantity', async () => {
    const service = apiService();
    const { lineId, user, endpoint } = await hostLine();
    await service.addServiceToPlan(lineId, { service_id: user.serviceId, quantity: 5, type_config: { pricing_basis: 'unit', base_rate: 10000 } } as any, apiContext as any);
    await service.addServiceToPlan(lineId, { service_id: endpoint.serviceId, quantity: 3 } as any, apiContext as any);

    await expect(
      service.updatePlanService(lineId, endpoint.serviceId, { type_config: { pricing_basis: 'unit' } } as any, apiContext as any),
    ).rejects.toThrow(/cannot be changed/i);
    await expect(
      service.updatePlanService(lineId, user.serviceId, { type_config: { pricing_basis: 'bundle' } } as any, apiContext as any),
    ).rejects.toThrow(/cannot be changed/i);
    await expect(
      service.updatePlanService(lineId, user.serviceId, { quantity: 1.5 } as any, apiContext as any),
    ).rejects.toThrow(/whole number/i);
    await expect(
      service.updatePlanService(lineId, endpoint.serviceId, { quantity: 0 } as any, apiContext as any),
    ).rejects.toThrow(/at least 1/i);

    // Re-sending the stored basis is accepted (idempotent clients).
    await service.updatePlanService(lineId, user.serviceId, { quantity: 6, type_config: { pricing_basis: 'unit' } } as any, apiContext as any);
    // On an assigned contract the edit is a dated revision, not an in-place write.
    const userConfig = await fixedConfigFor(lineId, user.serviceId);
    expect(Number(userConfig.quantity)).toBe(5);
    const revisions = await tenantTable(db, tenantId, 'contract_line_unit_pricing_revisions')
      .where({ tenant: tenantId, config_id: userConfig.config_id });
    expect(revisions).toHaveLength(1);
    expect(Number(revisions[0].quantity)).toBe(6);
    expect((await fixedConfigFor(lineId, endpoint.serviceId)).pricing_basis ?? 'bundle').toBe('bundle');
  }, HOOK_TIMEOUT);

  it('copying a contract line keeps per-unit services per-unit (quantity, rate) and applies a rate change to the unit rate', async () => {
    const service = apiService();
    const { lineId, user, endpoint } = await hostLine();
    await service.addServiceToPlan(lineId, { service_id: user.serviceId, quantity: 20, type_config: { pricing_basis: 'unit', base_rate: 10000 } } as any, apiContext as any);
    await service.addServiceToPlan(lineId, { service_id: endpoint.serviceId, quantity: 30, type_config: { pricing_basis: 'unit' } } as any, apiContext as any);

    // The public copyPlan insert stamps created_by, which contract_lines does not
    // have (pre-existing, unrelated to seats), so drive the services copy directly.
    const target = uuidv4();
    const [source] = await tenantTable(db, tenantId, 'contract_lines').where({ tenant: tenantId, contract_line_id: lineId });
    await tenantTable(db, tenantId, 'contract_lines').insert({ ...source, contract_line_id: target, contract_line_name: 'Copy' });
    await db.transaction((trx) =>
      (service as any).copyPlanServices(lineId, target, { percentage_change: 10 }, apiContext, trx),
    );
    const copy = { contract_line_id: target };
    const copiedUser = await fixedConfigFor(copy.contract_line_id, user.serviceId);
    expect(copiedUser).toMatchObject({ pricing_basis: 'unit' });
    expect(Number(copiedUser.quantity)).toBe(20);
    expect(Number(copiedUser.base_rate)).toBe(11000);
    // An inherited (catalog) unit rate stays inherited.
    const copiedEndpoint = await fixedConfigFor(copy.contract_line_id, endpoint.serviceId);
    expect(copiedEndpoint).toMatchObject({ pricing_basis: 'unit', base_rate: null, rate_provenance: 'inherited' });
    expect(Number(copiedEndpoint.quantity)).toBe(30);
  }, HOOK_TIMEOUT);
});
