import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import knexLib, { type Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { getContractMonthlyFixedValuesByContract } from '@alga-psa/shared/billingClients/contractMonthlyValue';
import { resolveFixedLineRecurringTotal } from '@alga-psa/billing/lib/billing/compute/recurringMemberRate';
import { computeRecurringQuantityCharges } from '@alga-psa/billing/lib/billing/compute/computeRecurringQuantityCharges';

/**
 * alga-2026-0002714 round 2 -- Finish Setup persists end to end against the SHARED dev database.
 *
 * Opt-in (the shared DB is not a CI fixture):
 *   SHARED_DEV_DB_E2E=1 npx vitest run --config ../tools/smoke-sim/alga2714/vitest.sharedDb.config.ts
 *   (run from server/; deliberately not named *.test.ts so no CI lane collects it)
 *
 * It needs main's `contract_lines.start_date` migration applied (Finish Setup used to 500 on
 * `column cl.start_date does not exist`). Everything runs inside ONE transaction that is rolled
 * back, so the shared database is left exactly as it was found. The wizard's own transactions
 * become savepoints of it.
 *
 * Connection: postgres admin on 127.0.0.1:${SHARED_DEV_DB_PORT:-6472}, db `server` (createTestDbConnection
 * refuses that name on purpose, so this test owns its connection). Tenant: SHARED_DEV_TENANT or the first tenant.
 */

const ENABLED = process.env.SHARED_DEV_DB_E2E === '1';

let root: Knex;
let db: Knex.Transaction;
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
      action({ user_id: '00000000-0000-4000-8000-000000002714', tenant: tenantId, roles: [{ role_name: 'Admin' }] } as any, { tenant: tenantId }, ...args),
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


describe.skipIf(!ENABLED)('Finish Setup, Products-only AUD contract, shared dev DB', () => {
  beforeAll(async () => {
    const secret = path.resolve(__dirname, '../../../secrets/postgres_password');
    root = knexLib({
      client: 'pg',
      connection: {
        host: '127.0.0.1', port: Number(process.env.SHARED_DEV_DB_PORT ?? 6472), user: 'postgres',
        password: fs.readFileSync(secret, 'utf8').trim(), database: 'server',
      },
      pool: { min: 0, max: 2 },
    });
    db = await root.transaction();
    tenantId = process.env.SHARED_DEV_TENANT
      ?? (await tenantDb(db, '__fixture__').unscoped('tenants', 'shared dev e2e').first<{ tenant: string }>('tenant'))!.tenant;
    ({ createClientContractFromWizard } = await import('@alga-psa/billing/actions/contractWizardActions'));
  }, 120_000);

  afterAll(async () => {
    await db?.rollback().catch(() => undefined);
    await root?.destroy();
  });

  it('persists the contract and lines; members are unit-priced with a NULL placeholder; wizard total == stored valuation == engine == AUD expected', async () => {
    const startDate = await db.raw(
      `select 1 from information_schema.columns where table_name = 'contract_lines' and column_name = 'start_date'`,
    );
    expect(startDate.rows).toHaveLength(1);

    const serviceTypeId = uuidv4();
    await t('service_types').insert({
      id: serviceTypeId, tenant: tenantId, name: `Finish setup ${serviceTypeId.slice(0, 8)}`,
      order_number: Math.floor(Math.random() * 1_000_000), created_at: db.fn.now(), updated_at: db.fn.now(),
    });
    const a = await seedProduct('FS M365 A', 16098, 0, serviceTypeId);
    const b = await seedProduct('FS M365 B', 18000, 0, serviceTypeId);
    const c = await seedProduct('FS M365 C', 9000, 0, serviceTypeId);

    const clientId = uuidv4();
    await t('clients').insert({
      tenant: tenantId, client_id: clientId, client_name: `Finish Setup e2e ${clientId.slice(0, 6)}`,
      billing_cycle: 'monthly', is_tax_exempt: false, default_currency_code: 'AUD', created_at: db.fn.now(), updated_at: db.fn.now(),
    });

    const result: any = await createClientContractFromWizard({
      contract_name: 'M365 Agreement (Finish Setup e2e)', client_id: clientId, start_date: '2026-01-01', end_date: null,
      billing_frequency: 'monthly', currency_code: 'AUD', enable_proration: false, fixed_lines: [],
      product_services: [{ service_id: a, quantity: 5 }, { service_id: b, quantity: 5 }, { service_id: c, quantity: 5 }],
      hourly_services: [], usage_services: [], po_required: false,
    } as any);
    expect(result.contract_id).toBeDefined();

    // Read back what was persisted.
    const contract = await t('contracts').where({ contract_id: result.contract_id }).first();
    expect(contract).toBeTruthy();
    expect(contract.currency_code).toBe('AUD');
    const lines = await t('contract_lines').where({ contract_id: result.contract_id });
    expect(lines).toHaveLength(1);
    expect(lines[0].custom_rate).toBeNull();
    const members = await t('contract_line_service_configuration').where({ contract_line_id: lines[0].contract_line_id });
    expect(members).toHaveLength(3);
    const fixed = await t('contract_line_service_fixed_config').whereIn('config_id', members.map((m: any) => m.config_id));
    expect(fixed).toHaveLength(3);
    for (const row of fixed) {
      expect(row.pricing_basis).toBe('unit');
      expect(row.base_rate).toBeNull();
      expect(row.rate_provenance).toBe('inherited');
    }

    // contractMonthlyValue
    const stored = (await getContractMonthlyFixedValuesByContract(db, tenantId, [result.contract_id])).get(result.contract_id);
    // wizard total (the Review step's resolver)
    const wizardTotal = resolveFixedLineRecurringTotal({
      custom_rate: null,
      members: [16098, 18000, 9000].map((rate) => ({ item_kind: 'product', quantity: 5, price_rate: rate, default_rate: 0 })),
    }, 'monthly');
    // engine, fed the persisted rows
    const prices = await t('service_prices').whereIn('service_id', [a, b, c]).where({ currency_code: 'AUD' });
    const engine = computeRecurringQuantityCharges({
      clientContractLine: { client_contract_line_id: 'x', client_id: 'x', contract_line_id: lines[0].contract_line_id, enable_proration: false } as any,
      client: { client_id: 'x', is_tax_exempt: false } as any,
      timing: { duePosition: 'arrears', servicePeriodStart: '2026-02-01', servicePeriodEnd: '2026-02-28', servicePeriodStartExclusive: '2026-02-01', servicePeriodEndExclusive: '2026-03-01', coverageRatio: 1 },
      chargeType: 'product',
      contractCurrency: 'AUD',
      services: members.map((m: any) => ({
        service_id: m.service_id, service_name: m.service_id, default_rate: 0,
        configuration_quantity: m.quantity, configuration_custom_rate: m.custom_rate,
        price_rate: Number(prices.find((p: any) => p.service_id === m.service_id).rate),
      })),
    }, {
      getTaxInfoFromService: () => ({ taxRegion: null, isTaxable: false }),
      getLocationTaxRegionCode: () => null, getClientDefaultTaxRegionCode: () => null,
      isTaxExemptForProfile: () => false, calculateTax: () => ({ taxRate: 0, taxAmount: 0 }),
    });
    const engineTotal = engine.charges.reduce((sum, ch) => sum + ch.total, 0);

    const AUD_EXPECTED = 5 * 16098 + 5 * 18000 + 5 * 9000; // A$2,154.90
    expect(AUD_EXPECTED).toBe(215_490);
    expect(stored?.monthlyValueCents).toBe(AUD_EXPECTED);
    expect(wizardTotal).toBe(AUD_EXPECTED);
    expect(engineTotal).toBe(AUD_EXPECTED);
    expect(stored?.linePeriodCentsByLine.get(lines[0].contract_line_id)).toBe(AUD_EXPECTED);
  }, 120_000);
});
