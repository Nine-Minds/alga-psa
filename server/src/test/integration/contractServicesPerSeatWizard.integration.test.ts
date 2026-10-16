import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../test-utils/testMocks';
import {
  createSeatCatalog,
  createSeatClient,
  dateOnly,
  ensureFixtureTenant,
  tenantTable,
  type SeatCatalogService,
  type SeatClient,
} from '../../../test-utils/perSeatFixtures';

// Per-seat recurring services authored through the contract wizard, end to
// end against the real actions and database: what the wizard persists, what
// the invoice bills, and how a later quantity change is revised. Andrew's
// package: Managed User $100 x 20, Managed Endpoint $50 x 30, Managed
// Location $200 x 2 = $3,900 / month.

let db: Knex;
let tenantId: string;
let createClientContractFromWizard: typeof import('@alga-psa/billing/actions/contractWizardActions').createClientContractFromWizard;
let generateInvoice: typeof import('@alga-psa/billing/actions/invoiceGeneration').generateInvoice;
let syncRecurringServicePeriodsForContractLine: typeof import('@alga-psa/billing/actions/recurringServicePeriodSync').syncRecurringServicePeriodsForContractLine;
let scheduleUnitPricingRevision: typeof import('@alga-psa/billing/actions/contractLineUnitPricingActions').scheduleUnitPricingRevision;

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

// Fixed lines bill in arrears: the December service period lands on the
// January invoice window, January's on the February window.
const DECEMBER_START = '2024-12-01';
const JANUARY_START = '2025-01-01';
const FEBRUARY_START = '2025-02-01';
const MARCH_START = '2025-03-01';

type Catalog = { user: SeatCatalogService; endpoint: SeatCatalogService; location: SeatCatalogService };

async function seatCatalog(): Promise<Catalog> {
  const [user, endpoint, location] = await createSeatCatalog(db, tenantId, [
    { name: 'Managed User', rateCents: 10000 },
    { name: 'Managed Endpoint', rateCents: 5000 },
    { name: 'Managed Location', rateCents: 20000 },
  ]);
  return { user, endpoint, location };
}

async function authorAndSync(
  client: SeatClient,
  fixedServices: Array<Record<string, unknown>>,
  extra: Record<string, unknown> = {},
) {
  const result = await createClientContractFromWizard({
    contract_name: `Per-seat ${uuidv4().slice(0, 6)}`,
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
  await db.transaction(async (trx) => {
    await syncRecurringServicePeriodsForContractLine(trx, {
      tenant: tenantId,
      contractLineId: result.contract_line_id!,
      sourceRunPrefix: 'per-seat-test',
    });
  });
  return result;
}

async function fixedConfigs(contractLineId: string) {
  const rows = await tenantTable(db, tenantId, 'contract_line_service_configuration as c')
    .join('contract_line_service_fixed_config as f', function join() {
      this.on('f.config_id', 'c.config_id').andOn('f.tenant', 'c.tenant');
    })
    .where({ 'c.tenant': tenantId, 'c.contract_line_id': contractLineId })
    .select('c.config_id', 'c.service_id', 'c.quantity', 'f.base_rate', 'f.pricing_basis', 'f.rate_provenance');
  return new Map(rows.map((row: any) => [row.service_id as string, row]));
}

async function lineBaseRate(contractLineId: string) {
  const row = await tenantTable(db, tenantId, 'contract_lines')
    .where({ tenant: tenantId, contract_line_id: contractLineId })
    .first();
  return row?.custom_rate == null ? null : Number(row.custom_rate);
}

function unwrapInvoice(result: any) {
  expect(result, JSON.stringify(result)).toBeTruthy();
  expect(result).not.toHaveProperty('error');
  return result;
}

describe('contract wizard: per-seat recurring services', () => {
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
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  const andrewsPackage = (catalog: Catalog) => [
    { service_id: catalog.user.serviceId, pricing_basis: 'unit', quantity: 20, unit_rate: 10000 },
    { service_id: catalog.endpoint.serviceId, pricing_basis: 'unit', quantity: 30, unit_rate: 5000 },
    { service_id: catalog.location.serviceId, pricing_basis: 'unit', quantity: 2, unit_rate: 20000 },
  ];

  it('persists three unit-priced configs and bills $3,900 / month with no line base rate', async () => {
    const client = await createSeatClient(db, tenantId);
    const catalog = await seatCatalog();
    const januaryCycle = await client.addMonthlyCycle(JANUARY_START, FEBRUARY_START);

    const result = await authorAndSync(client, andrewsPackage(catalog));

    const configs = await fixedConfigs(result.contract_line_id!);
    expect(configs.size).toBe(3);
    const expected: Array<[SeatCatalogService, number, number]> = [
      [catalog.user, 20, 10000],
      [catalog.endpoint, 30, 5000],
      [catalog.location, 2, 20000],
    ];
    for (const [service, quantity, rate] of expected) {
      const config: any = configs.get(service.serviceId);
      expect(config, service.name).toBeTruthy();
      expect(config.pricing_basis).toBe('unit');
      expect(Number(config.quantity)).toBe(quantity);
      expect(Number(config.base_rate)).toBe(rate);
      expect(config.rate_provenance).toBe('custom');
    }
    // Unit members are billed by quantity x rate; the line has no bundle total.
    expect(await lineBaseRate(result.contract_line_id!)).toBeNull();

    const invoice = unwrapInvoice(await generateInvoice(januaryCycle));
    expect(Number(invoice.subtotal)).toBe(390000);
  }, HOOK_TIMEOUT);

  it('ignores a stale line base rate when every member is per-seat (no double billing)', async () => {
    const client = await createSeatClient(db, tenantId);
    const catalog = await seatCatalog();
    const januaryCycle = await client.addMonthlyCycle(JANUARY_START, FEBRUARY_START);

    const result = await authorAndSync(client, andrewsPackage(catalog), { fixed_base_rate: 999900 });

    expect(await lineBaseRate(result.contract_line_id!)).toBeNull();
    const invoice = unwrapInvoice(await generateInvoice(januaryCycle));
    expect(Number(invoice.subtotal)).toBe(390000);
  }, HOOK_TIMEOUT);

  it('revises a seat count at the next boundary, keeps the billed period, and adds one opt-in mid-period true-up', async () => {
    const client = await createSeatClient(db, tenantId);
    const catalog = await seatCatalog();
    const januaryCycle = await client.addMonthlyCycle(JANUARY_START, FEBRUARY_START);
    const februaryCycle = await client.addMonthlyCycle(FEBRUARY_START, MARCH_START);

    const result = await authorAndSync(client, andrewsPackage(catalog));
    const userConfig: any = (await fixedConfigs(result.contract_line_id!)).get(catalog.user.serviceId);

    // Managed User 20 -> 23 from the January service period (opt-in true-up
    // for the 16th-31st of December that has not been invoiced yet).
    const scheduled: any = await scheduleUnitPricingRevision({
      contract_line_id: result.contract_line_id!,
      service_id: catalog.user.serviceId,
      config_id: userConfig.config_id,
      quantity: 23,
      unit_rate_cents: 10000,
      effective_period_start: JANUARY_START,
      allow_mid_period: true,
      mid_period_effective_date: '2024-12-16',
    });
    expect(scheduled, JSON.stringify(scheduled)).not.toHaveProperty('actionError');

    // The mid-period true-up is quantity-only and settles exactly once, on the
    // invoice that owns the December period: 3 seats x $100 x 16/31.
    const january = unwrapInvoice(await generateInvoice(januaryCycle));
    expect(Number(january.subtotal)).toBe(390000 + 15484);
    const adjustments = await tenantTable(db, tenantId, 'invoice_charges')
      .where({ tenant: tenantId, invoice_id: january.invoice_id, adjustment_source_kind: 'contract_change' });
    expect(adjustments).toHaveLength(1);

    // From the boundary the new count bills: 23x100 + 30x50 + 2x200 = $4,200.
    const february = unwrapInvoice(await generateInvoice(februaryCycle));
    expect(Number(february.subtotal)).toBe(420000);

    // The billed invoice is untouched by the later revision.
    const earlier = await tenantTable(db, tenantId, 'invoices')
      .where({ tenant: tenantId, invoice_id: january.invoice_id })
      .first();
    expect(Number(earlier?.subtotal)).toBe(390000 + 15484);
    const adjustmentRows = await tenantTable(db, tenantId, 'contract_recurring_unit_adjustments')
      .where({ tenant: tenantId, contract_line_id: result.contract_line_id });
    expect(adjustmentRows).toHaveLength(1);
    expect(dateOnly(adjustmentRows[0].mid_period_effective_date)).toBe('2024-12-16');
  }, HOOK_TIMEOUT);

  it('a mixed line takes its base rate from allocation members only and bills seats separately', async () => {
    const client = await createSeatClient(db, tenantId);
    const catalog = await seatCatalog();
    const januaryCycle = await client.addMonthlyCycle(JANUARY_START, FEBRUARY_START);

    const result = await authorAndSync(
      client,
      [
        { service_id: catalog.endpoint.serviceId, pricing_basis: 'bundle', quantity: 1 },
        { service_id: catalog.location.serviceId, pricing_basis: 'bundle', quantity: 3 },
        { service_id: catalog.user.serviceId, pricing_basis: 'unit', quantity: 5, unit_rate: 10000 },
      ],
      { fixed_base_rate: 40000 },
    );

    expect(await lineBaseRate(result.contract_line_id!)).toBe(40000);
    const configs = await fixedConfigs(result.contract_line_id!);
    const endpoint: any = configs.get(catalog.endpoint.serviceId);
    const location: any = configs.get(catalog.location.serviceId);
    const user: any = configs.get(catalog.user.serviceId);
    // The $400 bundle is split 1:3 over the allocation members alone.
    expect(Number(endpoint.base_rate)).toBe(10000);
    expect(Number(location.base_rate)).toBe(30000);
    expect(endpoint.pricing_basis === 'unit').toBe(false);
    expect(location.pricing_basis === 'unit').toBe(false);
    expect(user.pricing_basis).toBe('unit');
    expect(Number(user.base_rate)).toBe(10000);

    // $400 bundle + 5 seats x $100.
    const invoice = unwrapInvoice(await generateInvoice(januaryCycle));
    expect(Number(invoice.subtotal)).toBe(40000 + 50000);
  }, HOOK_TIMEOUT);

  it('stores a zero seat count as zero and bills nothing for it', async () => {
    const client = await createSeatClient(db, tenantId);
    const catalog = await seatCatalog();
    const januaryCycle = await client.addMonthlyCycle(JANUARY_START, FEBRUARY_START);

    const result = await authorAndSync(client, [
      { service_id: catalog.user.serviceId, pricing_basis: 'unit', quantity: 0, unit_rate: 10000 },
      { service_id: catalog.endpoint.serviceId, pricing_basis: 'unit', quantity: 3, unit_rate: 5000 },
    ]);

    const configs = await fixedConfigs(result.contract_line_id!);
    const user: any = configs.get(catalog.user.serviceId);
    expect(Number(user.quantity)).toBe(0);
    expect(user.pricing_basis).toBe('unit');
    expect(Number(user.base_rate)).toBe(10000);

    const invoice = unwrapInvoice(await generateInvoice(januaryCycle));
    expect(Number(invoice.subtotal)).toBe(15000);
  }, HOOK_TIMEOUT);

  it('uses the contract currency for a non-default-currency client', async () => {
    const client = await createSeatClient(db, tenantId, { currencyCode: 'EUR' });
    const [seat] = await createSeatCatalog(db, tenantId, [
      { name: 'Managed User', rateCents: 10000, prices: { EUR: 9000 } },
    ]);
    const januaryCycle = await client.addMonthlyCycle(JANUARY_START, FEBRUARY_START);

    const result = await authorAndSync(client, [
      { service_id: seat.serviceId, pricing_basis: 'unit', quantity: 10, unit_rate: 9000 },
    ]);

    const contract = await tenantTable(db, tenantId, 'contracts')
      .where({ tenant: tenantId, contract_id: result.contract_id })
      .first();
    expect(contract?.currency_code).toBe('EUR');

    const invoice = unwrapInvoice(await generateInvoice(januaryCycle));
    expect(Number(invoice.subtotal)).toBe(90000);
    const stored = await tenantTable(db, tenantId, 'invoices')
      .where({ tenant: tenantId, invoice_id: invoice.invoice_id })
      .first();
    expect(stored?.currency_code).toBe('EUR');
  }, HOOK_TIMEOUT);

  it('leaves existing bundle authoring unchanged: absent basis, explicit bundle and allocation shares', async () => {
    const client = await createSeatClient(db, tenantId);
    const catalog = await seatCatalog();
    const januaryCycle = await client.addMonthlyCycle(JANUARY_START, FEBRUARY_START);

    const result = await authorAndSync(
      client,
      [
        // No pricing_basis at all: the historical payload shape.
        { service_id: catalog.user.serviceId, quantity: 1 },
        { service_id: catalog.endpoint.serviceId, pricing_basis: 'bundle', quantity: 2 },
      ],
      { fixed_base_rate: 25000 },
    );

    expect(await lineBaseRate(result.contract_line_id!)).toBe(25000);
    const configs = await fixedConfigs(result.contract_line_id!);
    const first: any = configs.get(catalog.user.serviceId);
    const second: any = configs.get(catalog.endpoint.serviceId);
    expect(first.pricing_basis === 'unit').toBe(false);
    expect(second.pricing_basis === 'unit').toBe(false);
    // Allocation split by quantity 1:2, the last member absorbing the remainder.
    expect(Number(first.base_rate)).toBe(8333);
    expect(Number(second.base_rate)).toBe(16667);
    expect(Number(first.base_rate) + Number(second.base_rate)).toBe(25000);

    const invoice = unwrapInvoice(await generateInvoice(januaryCycle));
    expect(Number(invoice.subtotal)).toBe(25000);
  }, HOOK_TIMEOUT);

  it.each([
    ['no unit rate', { quantity: 5, unit_rate: null }, /unit rate/i],
    ['a fractional seat count', { quantity: 2.5, unit_rate: 10000 }, /whole number/i],
    ['a negative seat count', { quantity: -1, unit_rate: 10000 }, /zero or greater/i],
  ])('rejects a per-seat service with %s', async (_label, fields, message) => {
    const client = await createSeatClient(db, tenantId);
    const catalog = await seatCatalog();
    const before = await tenantTable(db, tenantId, 'contracts').count<{ count: string }[]>('* as count');

    await expect(
      createClientContractFromWizard({
        contract_name: `Rejected ${uuidv4().slice(0, 6)}`,
        client_id: client.clientId,
        start_date: DECEMBER_START,
        billing_frequency: 'monthly',
        enable_proration: false,
        fixed_services: [{ service_id: catalog.user.serviceId, pricing_basis: 'unit', ...fields }] as any,
        hourly_services: [],
        usage_services: [],
      } as any),
    ).rejects.toThrow(message);

    const after = await tenantTable(db, tenantId, 'contracts').count<{ count: string }[]>('* as count');
    expect(after[0].count).toBe(before[0].count);
  }, HOOK_TIMEOUT);
});
