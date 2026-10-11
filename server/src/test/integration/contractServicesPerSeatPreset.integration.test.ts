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

// Per-seat recurring services in contract line PRESETS: what the preset
// actions persist, and that a line created from a preset reproduces the unit
// services and bills them.

let db: Knex;
let tenantId: string;
let createClientContractFromWizard: typeof import('@alga-psa/billing/actions/contractWizardActions').createClientContractFromWizard;
let generateInvoice: typeof import('@alga-psa/billing/actions/invoiceGeneration').generateInvoice;
let syncRecurringServicePeriodsForContractLine: typeof import('@alga-psa/billing/actions/recurringServicePeriodSync').syncRecurringServicePeriodsForContractLine;
let createPreset: typeof import('@alga-psa/billing/actions/contractLinePresetActions').createContractLinePreset;
let updatePresetServices: typeof import('@alga-psa/billing/actions/contractLinePresetActions').updateContractLinePresetServices;
let updatePresetFixedConfig: typeof import('@alga-psa/billing/actions/contractLinePresetActions').updateContractLinePresetFixedConfig;
let getPresetServices: typeof import('@alga-psa/billing/actions/contractLinePresetActions').getContractLinePresetServices;
let copyPresetToContractLine: typeof import('@alga-psa/billing/actions/contractLinePresetActions').copyPresetToContractLine;

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

type Catalog = { user: SeatCatalogService; endpoint: SeatCatalogService; location: SeatCatalogService };

async function seatCatalog(): Promise<Catalog> {
  const [user, endpoint, location] = await createSeatCatalog(db, tenantId, [
    { name: 'Managed User', rateCents: 10000, prices: { EUR: 9000 } },
    { name: 'Managed Endpoint', rateCents: 5000, prices: { EUR: 4500 } },
    { name: 'Managed Location', rateCents: 20000, prices: { EUR: 18000 } },
  ]);
  return { user, endpoint, location };
}

function ok<T>(result: T): T {
  expect(result, JSON.stringify(result)).toBeTruthy();
  expect(result).not.toHaveProperty('error');
  expect(result).not.toHaveProperty('actionError');
  return result;
}

async function makePreset(
  services: Array<Record<string, unknown>>,
  options: { type?: 'Fixed' | 'Hourly'; baseRate?: number | null } = {},
) {
  const preset: any = ok(
    await createPreset({
      preset_name: `Seat preset ${uuidv4().slice(0, 6)}`,
      contract_line_type: options.type ?? 'Fixed',
      billing_frequency: 'monthly',
      billing_timing: 'arrears',
      cadence_owner: 'client',
    } as any),
  );
  if ((options.type ?? 'Fixed') === 'Fixed') {
    ok(await updatePresetFixedConfig(preset.preset_id, {
      base_rate: options.baseRate ?? null,
      enable_proration: false,
      billing_cycle_alignment: 'start',
    } as any));
  }
  const saved = await updatePresetServices(
    preset.preset_id,
    services.map((service) => ({ preset_id: preset.preset_id, ...service })) as any,
  );
  return { preset, saved };
}

async function lineFixedConfigs(contractLineId: string) {
  const rows = await tenantTable(db, tenantId, 'contract_line_service_configuration as c')
    .leftJoin('contract_line_service_fixed_config as f', function join() {
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

async function syncLine(contractLineId: string) {
  await db.transaction(async (trx) => {
    await syncRecurringServicePeriodsForContractLine(trx, {
      tenant: tenantId,
      contractLineId,
      sourceRunPrefix: 'per-seat-preset-test',
    });
  });
}

// A contract that already bills for a client (a zero-seat placeholder bills
// nothing) plus its January cycle, to attach preset lines to.
async function hostContract(catalog: Catalog, currencyCode?: string) {
  const client = await createSeatClient(db, tenantId, currencyCode ? { currencyCode } : {});
  const januaryCycle = await client.addMonthlyCycle(JANUARY_START, FEBRUARY_START);
  const host = ok(
    await createClientContractFromWizard({
      contract_name: `Host ${uuidv4().slice(0, 6)}`,
      client_id: client.clientId,
      start_date: DECEMBER_START,
      end_date: '2025-06-30',
      billing_frequency: 'monthly',
      enable_proration: false,
      fixed_services: [{ service_id: catalog.user.serviceId, pricing_basis: 'unit', quantity: 0, unit_rate: 10000 }],
      hourly_services: [],
      usage_services: [],
    } as any),
  ) as { contract_id: string; contract_line_id: string };
  return { host, januaryCycle };
}

async function addFromPresetAndInvoice(
  presetId: string,
  host: { contract_id: string; contract_line_id: string },
  januaryCycle: string,
) {
  const lineId = ok(await copyPresetToContractLine(host.contract_id, presetId)) as unknown as string;
  expect(typeof lineId).toBe('string');
  await syncLine(lineId);
  await syncLine(host.contract_line_id);
  const invoice: any = ok(await generateInvoice(januaryCycle));
  return { lineId, invoice };
}

const seatPackage = (catalog: Catalog) => [
  { service_id: catalog.user.serviceId, pricing_basis: 'unit', quantity: 20, custom_rate: 10000 },
  { service_id: catalog.endpoint.serviceId, pricing_basis: 'unit', quantity: 30, custom_rate: null },
  { service_id: catalog.location.serviceId, pricing_basis: 'unit', quantity: 2, custom_rate: 20000 },
];

describe('contract line presets: per-seat recurring services', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection();
    await db.migrate.latest();
    tenantId = await ensureFixtureTenant(db);
    setupCommonMocks({ tenantId, userId: 'per-seat-test-user', permissionCheck: () => true });
    ({ createClientContractFromWizard } = await import('@alga-psa/billing/actions/contractWizardActions'));
    ({ generateInvoice } = await import('@alga-psa/billing/actions/invoiceGeneration'));
    ({ syncRecurringServicePeriodsForContractLine } = await import('@alga-psa/billing/actions/recurringServicePeriodSync'));
    ({
      createContractLinePreset: createPreset,
      updateContractLinePresetServices: updatePresetServices,
      updateContractLinePresetFixedConfig: updatePresetFixedConfig,
      getContractLinePresetServices: getPresetServices,
      copyPresetToContractLine,
    } = await import('@alga-psa/billing/actions/contractLinePresetActions'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('stores basis, quantity and the optional unit rate per preset service', async () => {
    const catalog = await seatCatalog();
    const { preset } = await makePreset(seatPackage(catalog));

    const stored: any = ok(await getPresetServices(preset.preset_id));
    const byService = new Map<string, any>(stored.map((row: any) => [row.service_id, row]));
    expect(byService.get(catalog.user.serviceId)).toMatchObject({ pricing_basis: 'unit', quantity: 20 });
    expect(Number(byService.get(catalog.user.serviceId).custom_rate)).toBe(10000);
    expect(byService.get(catalog.endpoint.serviceId)).toMatchObject({ pricing_basis: 'unit', quantity: 30, custom_rate: null });
    expect(Number(byService.get(catalog.location.serviceId).custom_rate)).toBe(20000);
  }, HOOK_TIMEOUT);

  it('a line created from the preset reproduces the unit services and bills $3,900', async () => {
    const catalog = await seatCatalog();
    const { preset } = await makePreset(seatPackage(catalog));
    // A stale base rate on an all-seat preset must not be billed on top.
    ok(await updatePresetFixedConfig(preset.preset_id, {
      base_rate: 999900,
      enable_proration: false,
      billing_cycle_alignment: 'start',
    } as any));
    const { host, januaryCycle } = await hostContract(catalog);

    const { lineId, invoice } = await addFromPresetAndInvoice(preset.preset_id, host, januaryCycle);

    const configs = await lineFixedConfigs(lineId);
    expect(configs.size).toBe(3);
    const user: any = configs.get(catalog.user.serviceId);
    const endpoint: any = configs.get(catalog.endpoint.serviceId);
    const location: any = configs.get(catalog.location.serviceId);
    expect(user).toMatchObject({ pricing_basis: 'unit', rate_provenance: 'custom' });
    expect(Number(user.quantity)).toBe(20);
    expect(Number(user.base_rate)).toBe(10000);
    // No stored preset rate follows the live catalog.
    expect(endpoint).toMatchObject({ pricing_basis: 'unit', rate_provenance: 'inherited' });
    expect(endpoint.base_rate).toBeNull();
    expect(Number(endpoint.quantity)).toBe(30);
    expect(Number(location.base_rate)).toBe(20000);
    expect(await lineBaseRate(lineId)).toBeNull();

    // 20 x $100 + 30 x $50 (catalog) + 2 x $200
    expect(Number(invoice.subtotal)).toBe(390000);
  }, HOOK_TIMEOUT);

  it('an empty preset unit rate follows the catalog in a non-default contract currency', async () => {
    const catalog = await seatCatalog();
    const { preset } = await makePreset([
      { service_id: catalog.user.serviceId, pricing_basis: 'unit', quantity: 10, custom_rate: null },
    ]);
    const { host, januaryCycle } = await hostContract(catalog, 'EUR');

    const { invoice } = await addFromPresetAndInvoice(preset.preset_id, host, januaryCycle);
    // 10 x EUR 90.00 (catalog EUR price, not the USD default)
    expect(Number(invoice.subtotal)).toBe(90000);
  }, HOOK_TIMEOUT);

  it('a mixed preset bills the bundle base rate for allocation members plus seats separately', async () => {
    const catalog = await seatCatalog();
    const { preset } = await makePreset(
      [
        { service_id: catalog.endpoint.serviceId, quantity: 1 },
        { service_id: catalog.location.serviceId, pricing_basis: 'bundle', quantity: 3 },
        { service_id: catalog.user.serviceId, pricing_basis: 'unit', quantity: 5, custom_rate: 10000 },
      ],
      { baseRate: 40000 },
    );
    const { host, januaryCycle } = await hostContract(catalog);

    const { lineId, invoice } = await addFromPresetAndInvoice(preset.preset_id, host, januaryCycle);
    const configs = await lineFixedConfigs(lineId);
    expect((configs.get(catalog.user.serviceId) as any).pricing_basis).toBe('unit');
    expect((configs.get(catalog.endpoint.serviceId) as any).pricing_basis).not.toBe('unit');
    expect((configs.get(catalog.location.serviceId) as any).pricing_basis).not.toBe('unit');
    // $400 bundle + 5 seats x $100
    expect(Number(invoice.subtotal)).toBe(40000 + 50000);
  }, HOOK_TIMEOUT);

  it('an existing bundle preset is unchanged', async () => {
    const catalog = await seatCatalog();
    // Exactly what the dialog saved before this change: no pricing_basis at all.
    const { preset, saved } = await makePreset(
      [
        { service_id: catalog.endpoint.serviceId, quantity: 1, custom_rate: null, unit_of_measure: null },
        { service_id: catalog.location.serviceId, quantity: 3, custom_rate: null, unit_of_measure: null },
      ],
      { baseRate: 40000 },
    );
    for (const row of ok(saved) as any[]) {
      expect(row.pricing_basis ?? null).toBeNull();
    }
    const { host, januaryCycle } = await hostContract(catalog);

    const { lineId, invoice } = await addFromPresetAndInvoice(preset.preset_id, host, januaryCycle);
    for (const config of (await lineFixedConfigs(lineId)).values() as Iterable<any>) {
      expect(config.pricing_basis ?? 'bundle').toBe('bundle');
    }
    expect(Number(invoice.subtotal)).toBe(40000);
  }, HOOK_TIMEOUT);

  it.each([
    ['a fractional seat count', { pricing_basis: 'unit', quantity: 2.5, custom_rate: 10000 }, /whole number/i],
    ['a negative seat count', { pricing_basis: 'unit', quantity: -1, custom_rate: 10000 }, /zero or more/i],
    ['a negative unit rate', { pricing_basis: 'unit', quantity: 2, custom_rate: -5 }, /unit rate/i],
    ['an unknown basis', { pricing_basis: 'per-moon', quantity: 2 }, /bundle or recurring/i],
  ])('rejects %s and keeps the previously saved services', async (_label, fields, message) => {
    const catalog = await seatCatalog();
    const { preset } = await makePreset(seatPackage(catalog));
    const result: any = await updatePresetServices(preset.preset_id, [
      { preset_id: preset.preset_id, service_id: catalog.user.serviceId, ...fields },
    ] as any);
    expect(JSON.stringify(result)).toMatch(message);
    const stored: any = ok(await getPresetServices(preset.preset_id));
    expect(stored).toHaveLength(3);
  }, HOOK_TIMEOUT);

  it('rejects recurring units on a non-Fixed preset and on a product', async () => {
    const catalog = await seatCatalog();
    const { preset: hourly } = await makePreset(
      [{ service_id: catalog.user.serviceId, quantity: 1, custom_rate: 5000 }],
      { type: 'Hourly' },
    );
    const hourlyAttempt: any = await updatePresetServices(hourly.preset_id, [
      { preset_id: hourly.preset_id, service_id: catalog.user.serviceId, pricing_basis: 'unit', quantity: 1, custom_rate: 5000 },
    ] as any);
    expect(JSON.stringify(hourlyAttempt)).toMatch(/only available on Fixed/i);

    const productId = uuidv4();
    const [seat] = await tenantTable(db, tenantId, 'service_catalog').where({ tenant: tenantId, service_id: catalog.user.serviceId });
    await tenantTable(db, tenantId, 'service_catalog').insert({
      ...seat,
      service_id: productId,
      service_name: `Router ${productId.slice(0, 6)}`,
      item_kind: 'product',
      sku: `SKU-${productId.slice(0, 8)}`,
    });
    const { preset } = await makePreset([{ service_id: catalog.endpoint.serviceId, quantity: 1 }]);
    const productAttempt: any = await updatePresetServices(preset.preset_id, [
      { preset_id: preset.preset_id, service_id: productId, pricing_basis: 'unit', quantity: 2, custom_rate: 1000 },
    ] as any);
    expect(JSON.stringify(productAttempt)).toMatch(/Products are billed by unit quantity/i);
  }, HOOK_TIMEOUT);
});
