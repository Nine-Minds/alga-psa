import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { getContractMonthlyFixedValuesByContract } from '@alga-psa/shared/billingClients/contractMonthlyValue';
import { resolveFixedLineRecurringTotal } from '@alga-psa/billing/lib/billing/compute/recurringMemberRate';
import { computeRecurringQuantityCharges } from '@alga-psa/billing/lib/billing/compute/computeRecurringQuantityCharges';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../test-utils/testMocks';

/**
 * alga-2026-0002714 — Products contracts were valued at $0 by the wizard total and by the stored
 * valuation while the invoice engine billed the catalog price. These tests pin all three paths to
 * the customer's numbers (AUD, 5 x 16098 + 5 x 18000 + 5 x 9000, monthly = $2,154.90) and cover
 * the wizard persistence and the backfill migration.
 */

const require = createRequire(import.meta.url);
const backfill = require(path.resolve(__dirname, '../../../migrations/20261020120000_backfill_products_contract_placeholder_zero_rates.cjs')) as {
  up: (knex: Knex) => Promise<void>;
};

let db: Knex;
let tenantId: string;
let createClientContractFromWizard: typeof import('@alga-psa/billing/actions/contractWizardActions').createClientContractFromWizard;

const t = (table: string) => tenantDb(db, tenantId).table<any>(table);

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
    withTransaction: vi.fn(async (knexOrTrx: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
      knexOrTrx.transaction((trx) => callback(trx)),
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
      action({ user_id: 'products-totals-test', tenant: tenantId, roles: [{ role_name: 'Admin' }] } as any, { tenant: tenantId }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));

async function seedProduct(name: string, audPriceCents: number | null, defaultRate: number, serviceTypeId: string, itemKind = 'product') {
  const serviceId = uuidv4();
  await t('service_catalog').insert({
    tenant: tenantId,
    service_id: serviceId,
    service_name: `${name} ${serviceId.slice(0, 6)}`,
    description: 'products totals test',
    default_rate: defaultRate,
    unit_of_measure: 'each',
    billing_method: 'fixed',
    custom_service_type_id: serviceTypeId,
    item_kind: itemKind,
  });
  if (audPriceCents !== null) {
    await t('service_prices').insert({ tenant: tenantId, price_id: uuidv4(), service_id: serviceId, currency_code: 'AUD', rate: audPriceCents });
  }
  return serviceId;
}

async function createProductsContract(products: Array<{ service_id: string; quantity: number }>) {
  const clientId = uuidv4();
  await t('clients').insert({
    tenant: tenantId, client_id: clientId, client_name: `M365 client ${clientId.slice(0, 6)}`,
    billing_cycle: 'monthly', is_tax_exempt: false, default_currency_code: 'AUD', created_at: db.fn.now(), updated_at: db.fn.now(),
  });
  const result: any = await createClientContractFromWizard({
    contract_name: 'M365 Agreement',
    client_id: clientId,
    start_date: '2026-01-01',
    end_date: null,
    billing_frequency: 'monthly',
    currency_code: 'AUD',
    enable_proration: false,
    fixed_lines: [],
    product_services: products,
    hourly_services: [],
    usage_services: [],
    po_required: false,
  } as any);
  expect(result.contract_id).toBeDefined();
  const lines = await t('contract_lines').where({ contract_id: result.contract_id });
  return { contractId: result.contract_id as string, lines };
}

let serviceTypeId: string;

beforeAll(async () => {
  process.env.APP_ENV = process.env.APP_ENV || 'test';
  db = await createTestDbConnection();
  await db.migrate.latest();
  const tenantRow = await tenantDb(db, '__fixture__').unscoped('tenants', 'test fixture').first<{ tenant: string }>('tenant');
  tenantId = tenantRow!.tenant;
  setupCommonMocks({ tenantId, permissionCheck: () => true });
  ({ createClientContractFromWizard } = await import('@alga-psa/billing/actions/contractWizardActions'));
  serviceTypeId = uuidv4();
  await t('service_types').insert({
    id: serviceTypeId, tenant: tenantId, name: `Products totals ${serviceTypeId.slice(0, 8)}`,
    order_number: Math.floor(Math.random() * 1_000_000), created_at: db.fn.now(), updated_at: db.fn.now(),
  });
}, 180_000);

afterAll(async () => { await db?.destroy(); });

describe('Products-only AUD contract: wizard total == stored valuation == engine', () => {
  it('all three paths say $2,154.90 AUD per (monthly) period; wizard persists no placeholder zero', async () => {
    const a = await seedProduct('M365 A', 16098, 0, serviceTypeId);
    const b = await seedProduct('M365 B', 18000, 0, serviceTypeId);
    const c = await seedProduct('M365 C', 9000, 0, serviceTypeId);
    const { contractId, lines } = await createProductsContract([
      { service_id: a, quantity: 5 }, { service_id: b, quantity: 5 }, { service_id: c, quantity: 5 },
    ]);

    // Test 4: wizard persists NULL line rate and no base_rate = 0 bundle placeholder.
    expect(lines).toHaveLength(1);
    expect(lines[0].custom_rate).toBeNull();
    const memberConfigs = await t('contract_line_service_configuration').where({ contract_line_id: lines[0].contract_line_id });
    expect(memberConfigs).toHaveLength(3);
    const fixedConfigs = await t('contract_line_service_fixed_config').whereIn('config_id', memberConfigs.map((m: any) => m.config_id));
    expect(fixedConfigs).toHaveLength(3);
    for (const fc of fixedConfigs) {
      expect(fc.base_rate).toBeNull();
      // Product members bill quantity x rate: persisted as 'unit', never as a bundle allocation.
      expect(fc.pricing_basis).toBe('unit');
    }

    // Stored valuation.
    const stored = (await getContractMonthlyFixedValuesByContract(db, tenantId, [contractId])).get(contractId);
    expect(stored?.monthlyValueCents).toBe(215_490);

    // Wizard total: the Review step prices product_services with this exact resolver.
    const wizardTotal = resolveFixedLineRecurringTotal({
      custom_rate: null,
      members: [[a, 16098], [b, 18000], [c, 9000]].map(([, rate]) => ({ item_kind: 'product', quantity: 5, price_rate: rate as number, default_rate: 0 })),
    }, 'monthly');
    expect(wizardTotal).toBe(215_490);

    // Engine: fed the same rows its loader reads (config quantity, AUD service_prices.rate).
    const prices = await t('service_prices').whereIn('service_id', [a, b, c]).where({ currency_code: 'AUD' });
    const engine = computeRecurringQuantityCharges({
      clientContractLine: { client_contract_line_id: 'x', client_id: 'x', contract_line_id: lines[0].contract_line_id, enable_proration: false } as any,
      client: { client_id: 'x', is_tax_exempt: false } as any,
      timing: { duePosition: 'arrears', servicePeriodStart: '2026-02-01', servicePeriodEnd: '2026-02-28', servicePeriodStartExclusive: '2026-02-01', servicePeriodEndExclusive: '2026-03-01', coverageRatio: 1 },
      chargeType: 'product',
      contractCurrency: 'AUD',
      services: memberConfigs.map((m: any) => ({
        service_id: m.service_id, service_name: m.service_id, default_rate: 0,
        configuration_quantity: m.quantity, configuration_custom_rate: m.custom_rate,
        price_rate: Number(prices.find((p: any) => p.service_id === m.service_id).rate),
      })),
    }, {
      getTaxInfoFromService: () => ({ taxRegion: null, isTaxable: false }),
      getLocationTaxRegionCode: () => null, getClientDefaultTaxRegionCode: () => null,
      isTaxExemptForProfile: () => false, calculateTax: () => ({ taxRate: 0, taxAmount: 0 }),
    });
    expect(engine.charges.reduce((s, ch) => s + ch.total, 0)).toBe(215_490);
    expect(stored?.monthlyValueCents).toBe(wizardTotal);
  });

  it('a line custom_rate of 0 with priced product members is valued at the member rates', async () => {
    const a = await seedProduct('Zero line A', 16098, 0, serviceTypeId);
    const { contractId, lines } = await createProductsContract([{ service_id: a, quantity: 5 }]);
    await t('contract_lines').where({ contract_line_id: lines[0].contract_line_id }).update({ custom_rate: 0, rate_provenance: 'custom' });
    const members = await t('contract_line_service_configuration').where({ contract_line_id: lines[0].contract_line_id });
    await t('contract_line_service_fixed_config').whereIn('config_id', members.map((m: any) => m.config_id)).update({ base_rate: 0, base_rate_basis: 'per_unit', rate_provenance: 'custom' });
    expect((await getContractMonthlyFixedValuesByContract(db, tenantId, [contractId])).get(contractId)?.monthlyValueCents).toBe(80_490);
  });

  it('a product whose catalog price really is 0 totals 0', async () => {
    const free = await seedProduct('Free product', 0, 777, serviceTypeId);
    const { contractId } = await createProductsContract([{ service_id: free, quantity: 5 }]);
    expect((await getContractMonthlyFixedValuesByContract(db, tenantId, [contractId])).get(contractId)?.monthlyValueCents).toBe(0);
  });
});

describe('backfill migration', () => {
  it('rewrites exactly the placeholder-zero product rows, logs counts, leaves non-product zeros alone', async () => {
    const a = await seedProduct('Backfill A', 16098, 0, serviceTypeId);
    const b = await seedProduct('Backfill B', 9000, 0, serviceTypeId);
    const svc = await seedProduct('Backfill plain service', null, 5000, serviceTypeId, 'service');
    const { lines: productLines } = await createProductsContract([{ service_id: a, quantity: 5 }, { service_id: b, quantity: 5 }]);
    const productLineId = productLines[0].contract_line_id;

    // Customer's bad shape.
    await t('contract_lines').where({ contract_line_id: productLineId }).update({ custom_rate: 0, rate_provenance: 'custom' });
    const productMembers = await t('contract_line_service_configuration').where({ contract_line_id: productLineId });
    await t('contract_line_service_fixed_config').whereIn('config_id', productMembers.map((m: any) => m.config_id)).update({ base_rate: 0, base_rate_basis: 'per_unit', pricing_basis: 'bundle', rate_provenance: 'custom' });

    // Step 3 shape: rate-less 'bundle' product members (what the wizard wrote before the basis fix).
    const d = await seedProduct('Backfill D', 18000, 0, serviceTypeId);
    const { lines: nullRateLines } = await createProductsContract([{ service_id: d, quantity: 2 }]);
    const nullRateMembers = await t('contract_line_service_configuration').where({ contract_line_id: nullRateLines[0].contract_line_id });
    await t('contract_line_service_fixed_config').whereIn('config_id', nullRateMembers.map((m: any) => m.config_id)).update({ base_rate: null, base_rate_basis: null, pricing_basis: 'bundle', rate_provenance: 'inherited' });

    // Control: a product member carrying a REAL bundle rate (information, not a placeholder) stays a bundle.
    const { lines: realRateLines } = await createProductsContract([{ service_id: d, quantity: 3 }]);
    const realRateMembers = await t('contract_line_service_configuration').where({ contract_line_id: realRateLines[0].contract_line_id });
    await t('contract_line_service_fixed_config').whereIn('config_id', realRateMembers.map((m: any) => m.config_id)).update({ base_rate: 5000, base_rate_basis: 'per_unit', pricing_basis: 'bundle', rate_provenance: 'custom' });

    // Control: a non-product Fixed line with custom_rate 0 and a 0 bundle member.
    const clientId = uuidv4();
    await t('clients').insert({ tenant: tenantId, client_id: clientId, client_name: `Control ${clientId.slice(0, 6)}`, billing_cycle: 'monthly', is_tax_exempt: false, default_currency_code: 'AUD', created_at: db.fn.now(), updated_at: db.fn.now() });
    const control: any = await createClientContractFromWizard({
      contract_name: 'Control fixed', client_id: clientId, start_date: '2026-01-01', end_date: null, billing_frequency: 'monthly',
      currency_code: 'AUD', enable_proration: false, hourly_services: [], usage_services: [], po_required: false,
      fixed_lines: [{ line_key: 'k', enable_proration: false, base_rate: 10000, services: [{ service_id: svc, quantity: 1, pricing_basis: 'bundle' }] }],
    } as any);
    const controlLine = (await t('contract_lines').where({ contract_id: control.contract_id }))[0];
    await t('contract_lines').where({ contract_line_id: controlLine.contract_line_id }).update({ custom_rate: 0, rate_provenance: 'custom' });
    const controlMembers = await t('contract_line_service_configuration').where({ contract_line_id: controlLine.contract_line_id });
    await t('contract_line_service_fixed_config').whereIn('config_id', controlMembers.map((m: any) => m.config_id)).update({ base_rate: 0, base_rate_basis: 'per_unit', pricing_basis: 'bundle', rate_provenance: 'custom' });

    // Control: a template-flagged line holding a product member with the same 0 / 'bundle' shape.
    const { lines: templateLines } = await createProductsContract([{ service_id: a, quantity: 1 }]);
    const templateLineId = templateLines[0].contract_line_id;
    await t('contract_lines').where({ contract_line_id: templateLineId }).update({ is_template: true });
    const templateMembers = await t('contract_line_service_configuration').where({ contract_line_id: templateLineId });
    await t('contract_line_service_fixed_config').whereIn('config_id', templateMembers.map((m: any) => m.config_id)).update({ base_rate: 0, base_rate_basis: 'per_unit', pricing_basis: 'bundle', rate_provenance: 'custom' });

    // Expected counts for THIS tenant, by the written-out predicate (independent of the migration's code path).
    const expectedLines = Number((await db.raw(
      `SELECT count(DISTINCT cl.contract_line_id) AS n FROM contract_lines cl
         JOIN contract_line_service_configuration c ON c.tenant = cl.tenant AND c.contract_line_id = cl.contract_line_id AND c.configuration_type = 'Fixed'
         JOIN service_catalog s ON s.tenant = c.tenant AND s.service_id = c.service_id AND s.item_kind = 'product'
        WHERE cl.tenant = ? AND cl.custom_rate = 0 AND cl.contract_line_type = 'Fixed' AND cl.contract_id IS NOT NULL AND COALESCE(cl.is_template, false) = false`, [tenantId])).rows[0].n);
    const expectedConfigs = Number((await db.raw(
      `SELECT count(*) AS n FROM contract_line_service_fixed_config f
         JOIN contract_line_service_configuration c ON c.tenant = f.tenant AND c.config_id = f.config_id
         JOIN service_catalog s ON s.tenant = c.tenant AND s.service_id = c.service_id AND s.item_kind = 'product'
         JOIN contract_lines l ON l.tenant = c.tenant AND l.contract_line_id = c.contract_line_id AND l.contract_id IS NOT NULL AND COALESCE(l.is_template, false) = false
        WHERE f.tenant = ? AND f.base_rate = 0 AND f.pricing_basis = 'bundle'`, [tenantId])).rows[0].n);
    const expectedBasisOnly = Number((await db.raw(
      `SELECT count(*) AS n FROM contract_line_service_fixed_config f
         JOIN contract_line_service_configuration c ON c.tenant = f.tenant AND c.config_id = f.config_id
         JOIN service_catalog s ON s.tenant = c.tenant AND s.service_id = c.service_id AND s.item_kind = 'product'
         JOIN contract_lines l ON l.tenant = c.tenant AND l.contract_line_id = c.contract_line_id AND l.contract_id IS NOT NULL AND COALESCE(l.is_template, false) = false
        WHERE f.tenant = ? AND f.base_rate IS NULL AND f.pricing_basis = 'bundle'`, [tenantId])).rows[0].n);
    expect(expectedBasisOnly).toBeGreaterThanOrEqual(1);
    expect(expectedLines).toBeGreaterThanOrEqual(1);
    expect(expectedConfigs).toBeGreaterThanOrEqual(2);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let messages: string[] = [];
    try { await backfill.up(db); messages = log.mock.calls.map((c) => String(c[0])); } finally { log.mockRestore(); }
    const tenantLine = messages.find((m) => m.includes(`tenant ${tenantId}`));
    expect(tenantLine).toContain(`contract_lines.custom_rate 0 -> NULL: ${expectedLines}`);
    expect(tenantLine).toContain(`contract_line_service_fixed_config.base_rate 0 -> NULL (+ pricing_basis unit): ${expectedConfigs}`);
    expect(tenantLine).toContain(`contract_line_service_fixed_config.pricing_basis bundle -> unit (rate already NULL): ${expectedBasisOnly}`);
    expect(messages.some((m) => m.includes('pricing_basis -> unit'))).toBe(true);

    const fixedLine = (await t('contract_lines').where({ contract_line_id: productLineId }).first());
    expect(fixedLine.custom_rate).toBeNull();
    expect(fixedLine.rate_provenance).toBe('inherited');
    const rewritten = await t('contract_line_service_fixed_config').whereIn('config_id', productMembers.map((m: any) => m.config_id));
    expect(rewritten.every((r: any) => r.base_rate === null && r.rate_provenance === 'inherited' && r.pricing_basis === 'unit')).toBe(true);
    const basisOnly = await t('contract_line_service_fixed_config').whereIn('config_id', nullRateMembers.map((m: any) => m.config_id));
    expect(basisOnly.every((r: any) => r.base_rate === null && r.rate_provenance === 'inherited' && r.pricing_basis === 'unit')).toBe(true);
    const realRate = await t('contract_line_service_fixed_config').whereIn('config_id', realRateMembers.map((m: any) => m.config_id));
    expect(realRate.every((r: any) => Number(r.base_rate) === 5000 && r.pricing_basis === 'bundle' && r.rate_provenance === 'custom')).toBe(true);

    // Unrelated rows untouched.
    const untouchedLine = await t('contract_lines').where({ contract_line_id: controlLine.contract_line_id }).first();
    expect(Number(untouchedLine.custom_rate)).toBe(0);
    expect(untouchedLine.rate_provenance).toBe('custom');
    const untouchedConfigs = await t('contract_line_service_fixed_config').whereIn('config_id', controlMembers.map((m: any) => m.config_id));
    expect(untouchedConfigs.every((r: any) => Number(r.base_rate) === 0 && r.pricing_basis === 'bundle')).toBe(true);

    // Template line's product config with 0 / 'bundle' is left untouched.
    const templateConfigs = await t('contract_line_service_fixed_config').whereIn('config_id', templateMembers.map((m: any) => m.config_id));
    expect(templateConfigs).toHaveLength(1);
    expect(templateConfigs.every((r: any) => Number(r.base_rate) === 0 && r.pricing_basis === 'bundle' && r.rate_provenance === 'custom')).toBe(true);

    // Rewritten contract now values at the member rates: 5 x 16098 + 5 x 9000.
    expect((await getContractMonthlyFixedValuesByContract(db, tenantId, [productLines[0].contract_id])).get(productLines[0].contract_id)?.monthlyValueCents).toBe(125_490);
  });
});
