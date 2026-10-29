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
} from '../../../test-utils/perSeatFixtures';

// "Reset to standard" (rate review) clears a bundle's stored rate so it follows
// the catalog again. On a mixed line it must reprice the bundle members only:
// a per-seat member's unit rate, seat count and scheduled revisions are
// standing commitments that change through dated revisions, never in place.

let db: Knex;
let tenantId: string;
let createClientContractFromWizard: typeof import('@alga-psa/billing/actions/contractWizardActions').createClientContractFromWizard;
let updateContractLine: typeof import('@alga-psa/billing/actions/contractLineAction').updateContractLine;
let updateConfiguration: typeof import('@alga-psa/billing/actions/contractLineServiceConfigurationActions').updateConfiguration;
let FixedConfigModel: typeof import('@alga-psa/billing/models/contractLineServiceFixedConfig').default;

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
const CONSTRAINT = 'contract_line_service_fixed_config_base_rate_ba_7cbd0636';
const NAMED_ERROR = 'A fixed member base_rate_basis requires base_rate';
const BOUNDARY = '2099-01-01';

const fixedRow = (configId: string) =>
  tenantTable(db, tenantId, 'contract_line_service_fixed_config').where({ tenant: tenantId, config_id: configId }).first();

async function createProductsLine(rateCents = 4200) {
  const [product] = await createSeatCatalog(db, tenantId, [{ name: 'Router', rateCents }]);
  await tenantTable(db, tenantId, 'service_catalog')
    .where({ tenant: tenantId, service_id: product.serviceId }).update({ item_kind: 'product' });
  const client = await createSeatClient(db, tenantId);
  const result: any = await createClientContractFromWizard({
    contract_name: `Products ${uuidv4().slice(0, 6)}`,
    client_id: client.clientId,
    start_date: '2024-12-01',
    end_date: '2099-12-31',
    billing_frequency: 'monthly',
    enable_proration: false,
    fixed_services: [],
    hourly_services: [],
    usage_services: [],
    product_services: [{ service_id: product.serviceId, quantity: 2 }],
  } as any);
  expect(result, JSON.stringify(result)).toHaveProperty('contract_id');
  const lines: any[] = await tenantTable(db, tenantId, 'contract_lines')
    .where({ tenant: tenantId, contract_id: result.contract_id }).select('*');
  const line = lines.find((l) => /Products/.test(l.contract_line_name)) ?? lines[0];
  const config: any = await tenantTable(db, tenantId, 'contract_line_service_configuration')
    .where({ tenant: tenantId, contract_line_id: line.contract_line_id, service_id: product.serviceId }).first();
  expect(config).toBeTruthy();
  return { lineId: line.contract_line_id as string, configId: config.config_id as string, serviceId: product.serviceId };
}

describe('Products contract line save never splits base_rate / base_rate_basis', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection();
    await db.migrate.latest();
    tenantId = await ensureFixtureTenant(db);
    setupCommonMocks({ tenantId, userId: 'per-seat-test-user', permissionCheck: () => true });
    ({ createClientContractFromWizard } = await import('@alga-psa/billing/actions/contractWizardActions'));
    ({ updateContractLine } = await import('@alga-psa/billing/actions/contractLineAction'));
    ({ updateConfiguration } = await import('@alga-psa/billing/actions/contractLineServiceConfigurationActions'));
    FixedConfigModel = (await import('@alga-psa/billing/models/contractLineServiceFixedConfig')).default;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('model: a basis-only update on a NULL-rate member throws the named error and leaves the row unchanged', async () => {
    const { configId } = await createProductsLine();
    const before = await fixedRow(configId);
    expect(before).toMatchObject({ base_rate: null, base_rate_basis: null, pricing_basis: 'unit', rate_provenance: 'inherited' });

    const model = new FixedConfigModel(db, tenantId);
    await expect(model.update(configId, { base_rate_basis: 'per_unit' })).rejects.toThrow(NAMED_ERROR);
    expect(await fixedRow(configId)).toEqual(before);
  }, HOOK_TIMEOUT);

  it('model: on a rate-carrying member a basis-only update writes rate and basis together', async () => {
    const { configId } = await createProductsLine();
    const model = new FixedConfigModel(db, tenantId);
    // Seed an explicit (custom) bundle-share style row: non-seat so 'share' is legal.
    await tenantTable(db, tenantId, 'contract_line_service_fixed_config').where({ tenant: tenantId, config_id: configId })
      .update({ pricing_basis: 'bundle', base_rate: 1500, base_rate_basis: 'per_unit', rate_provenance: 'custom' });
    expect(await model.update(configId, { base_rate_basis: 'share' })).toBe(true);
    const after = await fixedRow(configId);
    expect(Number(after.base_rate)).toBe(1500);
    expect(after.base_rate_basis).toBe('share');
  }, HOOK_TIMEOUT);

  it('incident replay: the old split patch is rejected by name, not SQLSTATE 23514', async () => {
    const { configId } = await createProductsLine();
    const model = new FixedConfigModel(db, tenantId);
    // The exact old write: base_rate_basis='per_unit' with the rate absent from the patch.
    const error: any = await model.update(configId, { base_rate_basis: 'per_unit' }).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(NAMED_ERROR);
    expect(error.code).not.toBe('23514');
    expect(String(error.message)).not.toContain(CONSTRAINT);
    expect(await fixedRow(configId)).toMatchObject({ base_rate: null, base_rate_basis: null });
  }, HOOK_TIMEOUT);

  it('service: a timing-only save commits and the members stay inherited and catalog-priced', async () => {
    const { lineId, configId } = await createProductsLine();
    const before = await fixedRow(configId);
    const timing: any = await updateContractLine(lineId, { billing_timing: 'advance' } as any);
    expect(timing, JSON.stringify(timing)).not.toHaveProperty('actionError');
    // The editor then re-sends every edited member; with the fix a null rate carries no basis.
    const saved: any = await updateConfiguration(configId, {}, { base_rate: null, effective_period_start: BOUNDARY } as any);
    expect(saved, JSON.stringify(saved)).not.toHaveProperty('actionError');

    const line: any = await tenantTable(db, tenantId, 'contract_lines').where({ tenant: tenantId, contract_line_id: lineId }).first();
    expect(line.billing_timing).toBe('advance');
    const after = await fixedRow(configId);
    expect(after).toMatchObject({ base_rate: null, base_rate_basis: null, pricing_basis: 'unit', rate_provenance: 'inherited' });
    expect(after.base_rate).toBe(before.base_rate);
  }, HOOK_TIMEOUT);

  it('service: a quantity change schedules a catalog revision and keeps the current row NULL/NULL', async () => {
    const { lineId, configId } = await createProductsLine();
    const revisions = () => tenantTable(db, tenantId, 'contract_line_unit_pricing_revisions')
      .where({ tenant: tenantId, contract_line_id: lineId }).select('*');
    const before = await fixedRow(configId);

    // Quantity edit plus the pre-fix client's invented basis: the service must drop the
    // basis with the rate (it is stale by construction) instead of forwarding a split pair.
    const saved: any = await updateConfiguration(configId, { quantity: 5 } as any,
      { effective_period_start: BOUNDARY, base_rate_basis: 'per_unit' } as any);
    expect(saved, JSON.stringify(saved)).not.toHaveProperty('actionError');

    const rows: any[] = await revisions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ config_id: configId, price_policy: 'catalog', unit_rate_cents: null });
    expect(Number(rows[0].quantity)).toBe(5);
    expect(String(rows[0].effective_period_start).slice(0, 10) === BOUNDARY || new Date(rows[0].effective_period_start).toISOString().slice(0, 10) === BOUNDARY).toBe(true);

    // The current row keeps NULL/NULL and is not pinned to today's catalog rate.
    const after = await fixedRow(configId);
    expect(after).toMatchObject({ base_rate: null, base_rate_basis: null, rate_provenance: 'inherited', pricing_basis: 'unit' });
    expect(after.base_rate).toBe(before.base_rate);
  }, HOOK_TIMEOUT);
});
