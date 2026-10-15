import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../test-utils/testMocks';
import {
  createSeatCatalog,
  createSeatClient,
  ensureFixtureTenant,
  type SeatCatalogService,
  type SeatClient,
} from '../../../test-utils/perSeatFixtures';

// The surfaces that summarise a contract - the overview rows and total, and the
// shared monthly valuation behind reports / MRR - must agree with what the
// invoice bills for per-seat services, including a mixed bundle + seats line.
// Andrew's package: Managed User $100 x 20, Endpoint $50 x 30, Location $200 x 2
// = $3,900 / month.

let db: Knex;
let tenantId: string;
let createClientContractFromWizard: typeof import('@alga-psa/billing/actions/contractWizardActions').createClientContractFromWizard;
let generateInvoice: typeof import('@alga-psa/billing/actions/invoiceGeneration').generateInvoice;
let syncRecurringServicePeriodsForContractLine: typeof import('@alga-psa/billing/actions/recurringServicePeriodSync').syncRecurringServicePeriodsForContractLine;
let scheduleUnitPricingRevision: typeof import('@alga-psa/billing/actions/contractLineUnitPricingActions').scheduleUnitPricingRevision;
let getContractOverview: typeof import('@alga-psa/billing/actions/contractActions').getContractOverview;
let getContractMonthlyFixedValuesByContract: typeof import('@alga-psa/shared/billingClients/contractMonthlyValue').getContractMonthlyFixedValuesByContract;

// LEVERAGE: pattern per-seat-test-mocks — the same auth/db/tenant mock preamble is repeated in every contractServicesPerSeat* integration file; it belongs in test-utils.
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

type Catalog = { user: SeatCatalogService; endpoint: SeatCatalogService; location: SeatCatalogService };

async function seatCatalog(): Promise<Catalog> {
  const [user, endpoint, location] = await createSeatCatalog(db, tenantId, [
    { name: 'Managed User', rateCents: 10000, prices: { EUR: 9000 } },
    { name: 'Managed Endpoint', rateCents: 5000, prices: { EUR: 4500 } },
    { name: 'Managed Location', rateCents: 20000, prices: { EUR: 18000 } },
  ]);
  return { user, endpoint, location };
}

async function author(client: SeatClient, fixedServices: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  const result: any = await createClientContractFromWizard({
    contract_name: `Per-seat display ${uuidv4().slice(0, 6)}`,
    client_id: client.clientId,
    start_date: DECEMBER_START,
    end_date: '2025-06-30',
    billing_frequency: 'monthly',
    enable_proration: false,
    fixed_services: fixedServices as any,
    hourly_services: [],
    usage_services: [],
    ...extra,
  } as any);
  expect(result, JSON.stringify(result)).toHaveProperty('contract_id');
  await db.transaction((trx) =>
    syncRecurringServicePeriodsForContractLine(trx, {
      tenant: tenantId,
      contractLineId: result.contract_line_id,
      sourceRunPrefix: 'per-seat-display-test',
    }),
  );
  return result as { contract_id: string; contract_line_id: string };
}

async function overviewOf(contractId: string) {
  const overview: any = await getContractOverview(contractId);
  expect(overview, JSON.stringify(overview)).not.toHaveProperty('error');
  const services = new Map<string, any>(
    overview.contractLines.flatMap((line: any) => line.services).map((svc: any) => [svc.service_id, svc]),
  );
  return { overview, services };
}

async function monthlyValue(contractId: string, asOf?: string) {
  const values = await getContractMonthlyFixedValuesByContract(db, tenantId, [contractId], asOf);
  return values.get(contractId)?.monthlyValueCents;
}

const invoiceOf = (result: any) => {
  expect(result, JSON.stringify(result)).toBeTruthy();
  expect(result).not.toHaveProperty('error');
  return result;
};

describe('per-seat recurring services: overview and monthly value agree with billing', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection();
    await db.migrate.latest();
    tenantId = await ensureFixtureTenant(db);
    setupCommonMocks({ tenantId, userId: 'per-seat-test-user', permissionCheck: () => true });
    ({ createClientContractFromWizard } = await import('@alga-psa/billing/actions/contractWizardActions'));
    ({ generateInvoice } = await import('@alga-psa/billing/actions/invoiceGeneration'));
    ({ syncRecurringServicePeriodsForContractLine } = await import('@alga-psa/billing/actions/recurringServicePeriodSync'));
    ({ scheduleUnitPricingRevision } = await import('@alga-psa/billing/actions/contractLineUnitPricingActions'));
    ({ getContractOverview } = await import('@alga-psa/billing/actions/contractActions'));
    ({ getContractMonthlyFixedValuesByContract } = await import('@alga-psa/shared/billingClients/contractMonthlyValue'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it("Andrew's package is $3,900 / month in the monthly value, the overview and the invoice", async () => {
    const client = await createSeatClient(db, tenantId);
    const catalog = await seatCatalog();
    const januaryCycle = await client.addMonthlyCycle(JANUARY_START, FEBRUARY_START);
    const contract = await author(client, [
      { service_id: catalog.user.serviceId, pricing_basis: 'unit', quantity: 20, unit_rate: 10000 },
      { service_id: catalog.endpoint.serviceId, pricing_basis: 'unit', quantity: 30, unit_rate: 5000 },
      { service_id: catalog.location.serviceId, pricing_basis: 'unit', quantity: 2, unit_rate: 20000 },
    ]);

    expect(await monthlyValue(contract.contract_id)).toBe(390000);

    const { overview, services } = await overviewOf(contract.contract_id);
    // Each row carries what the UI renders as "quantity x unit rate = amount".
    expect(services.get(catalog.user.serviceId)).toMatchObject({ pricing_basis: 'unit', quantity: 20, unit_rate: 10000 });
    expect(services.get(catalog.endpoint.serviceId)).toMatchObject({ pricing_basis: 'unit', quantity: 30, unit_rate: 5000 });
    expect(services.get(catalog.location.serviceId)).toMatchObject({ pricing_basis: 'unit', quantity: 2, unit_rate: 20000 });
    expect(overview.totalEstimatedMonthlyValue).toBe(390000);

    const invoice = invoiceOf(await generateInvoice(januaryCycle));
    expect(Number(invoice.subtotal)).toBe(390000);
  }, HOOK_TIMEOUT);

  it('a mixed line is valued as bundle + seats, matching the invoice', async () => {
    const client = await createSeatClient(db, tenantId);
    const catalog = await seatCatalog();
    const januaryCycle = await client.addMonthlyCycle(JANUARY_START, FEBRUARY_START);
    const contract = await author(
      client,
      [
        { service_id: catalog.endpoint.serviceId, pricing_basis: 'bundle', quantity: 1 },
        { service_id: catalog.location.serviceId, pricing_basis: 'bundle', quantity: 3 },
        { service_id: catalog.user.serviceId, pricing_basis: 'unit', quantity: 5, unit_rate: 10000 },
      ],
      { fixed_base_rate: 40000 },
    );

    // $400 bundle + 5 x $100 seats.
    expect(await monthlyValue(contract.contract_id)).toBe(90000);
    const { overview, services } = await overviewOf(contract.contract_id);
    expect(overview.totalEstimatedMonthlyValue).toBe(90000);
    expect(services.get(catalog.user.serviceId)).toMatchObject({ pricing_basis: 'unit', quantity: 5, unit_rate: 10000 });
    // Bundle members are allocations of the $400, never seats.
    expect(services.get(catalog.location.serviceId).pricing_basis ?? 'bundle').not.toBe('unit');

    const invoice = invoiceOf(await generateInvoice(januaryCycle));
    expect(Number(invoice.subtotal)).toBe(90000);
  }, HOOK_TIMEOUT);

  it('a scheduled quantity change moves the monthly value only from its effective date', async () => {
    const client = await createSeatClient(db, tenantId);
    const catalog = await seatCatalog();
    const contract = await author(client, [
      { service_id: catalog.user.serviceId, pricing_basis: 'unit', quantity: 20, unit_rate: 10000 },
      { service_id: catalog.endpoint.serviceId, pricing_basis: 'unit', quantity: 30, unit_rate: 5000 },
      { service_id: catalog.location.serviceId, pricing_basis: 'unit', quantity: 2, unit_rate: 20000 },
    ]);
    const userConfig: any = await db('contract_line_service_configuration')
      .where({ tenant: tenantId, contract_line_id: contract.contract_line_id, service_id: catalog.user.serviceId })
      .first();
    const scheduled: any = await scheduleUnitPricingRevision({
      contract_line_id: contract.contract_line_id,
      service_id: catalog.user.serviceId,
      config_id: userConfig.config_id,
      quantity: 23,
      unit_rate_cents: 10000,
      effective_period_start: FEBRUARY_START,
    });
    expect(scheduled, JSON.stringify(scheduled)).not.toHaveProperty('actionError');

    expect(await monthlyValue(contract.contract_id, JANUARY_START)).toBe(390000);
    expect(await monthlyValue(contract.contract_id, FEBRUARY_START)).toBe(420000);
    expect(await monthlyValue(contract.contract_id, MARCH_START)).toBe(420000);
  }, HOOK_TIMEOUT);

  it("a catalog-following seat rate is shown and valued at the contract currency's catalog price", async () => {
    const client = await createSeatClient(db, tenantId, { currencyCode: 'EUR' });
    const catalog = await seatCatalog();
    const januaryCycle = await client.addMonthlyCycle(JANUARY_START, FEBRUARY_START);
    const contract = await author(client, [
      { service_id: catalog.user.serviceId, pricing_basis: 'unit', quantity: 20, unit_rate: 1 },
      { service_id: catalog.endpoint.serviceId, pricing_basis: 'unit', quantity: 30, unit_rate: 1 },
      { service_id: catalog.location.serviceId, pricing_basis: 'unit', quantity: 2, unit_rate: 1 },
    ]);
    // The client wizard always states a rate; catalog-following rows come from
    // templates and the API. Put the rows in that state (no stored rate, inherited).
    const configIds = (await db('contract_line_service_configuration')
      .where({ tenant: tenantId, contract_line_id: contract.contract_line_id })
      .select('config_id')).map((row: any) => row.config_id);
    await db('contract_line_service_fixed_config')
      .where({ tenant: tenantId })
      .whereIn('config_id', configIds)
      .update({ base_rate: null, rate_provenance: 'inherited' });

    // 20 x EUR 90 + 30 x EUR 45 + 2 x EUR 180.
    const expected = 20 * 9000 + 30 * 4500 + 2 * 18000;
    expect(await monthlyValue(contract.contract_id)).toBe(expected);
    const { overview, services } = await overviewOf(contract.contract_id);
    expect(overview.currencyCode).toBe('EUR');
    // The row must state the rate the client is billed, not a blank or a USD price.
    expect(services.get(catalog.user.serviceId)).toMatchObject({ quantity: 20, unit_rate: 9000 });
    expect(services.get(catalog.endpoint.serviceId)).toMatchObject({ quantity: 30, unit_rate: 4500 });
    expect(services.get(catalog.location.serviceId)).toMatchObject({ quantity: 2, unit_rate: 18000 });
    expect(overview.totalEstimatedMonthlyValue).toBe(expected);

    const invoice = invoiceOf(await generateInvoice(januaryCycle));
    expect(Number(invoice.subtotal)).toBe(expected);
  }, HOOK_TIMEOUT);
});
