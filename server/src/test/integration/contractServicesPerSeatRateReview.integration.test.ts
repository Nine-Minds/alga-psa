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
let generateInvoice: typeof import('@alga-psa/billing/actions/invoiceGeneration').generateInvoice;
let syncRecurringServicePeriodsForContractLine: typeof import('@alga-psa/billing/actions/recurringServicePeriodSync').syncRecurringServicePeriodsForContractLine;
let scheduleUnitPricingRevision: typeof import('@alga-psa/billing/actions/contractLineUnitPricingActions').scheduleUnitPricingRevision;
let resetContractLineRateToStandard: typeof import('@alga-psa/billing/actions/rateReviewActions').resetContractLineRateToStandard;

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

async function memberRows(contractLineId: string) {
  const rows = await tenantTable(db, tenantId, 'contract_line_service_configuration as c')
    .join('contract_line_service_fixed_config as f', function join() {
      this.on('f.config_id', 'c.config_id').andOn('f.tenant', 'c.tenant');
    })
    .where({ 'c.tenant': tenantId, 'c.contract_line_id': contractLineId })
    .select('c.config_id', 'c.service_id', 'c.quantity', 'f.base_rate', 'f.pricing_basis', 'f.rate_provenance');
  return new Map(rows.map((row: any) => [row.service_id as string, row]));
}

async function revisionRows(contractLineId: string) {
  return tenantTable(db, tenantId, 'contract_line_unit_pricing_revisions')
    .where({ tenant: tenantId, contract_line_id: contractLineId })
    .orderBy('effective_period_start')
    .select('revision_id', 'service_id', 'config_id', 'quantity', 'unit_rate_cents', 'price_policy', 'effective_period_start', 'version');
}

describe('rate-review reset on a mixed bundle + per-seat line', () => {
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
    ({ resetContractLineRateToStandard } = await import('@alga-psa/billing/actions/rateReviewActions'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it("reprices the bundle members to the catalog and leaves the seat member's rate, quantity and revisions untouched", async () => {
    const [endpoint, location, user] = await createSeatCatalog(db, tenantId, [
      { name: 'Managed Endpoint', rateCents: 5000 },
      { name: 'Managed Location', rateCents: 20000 },
      { name: 'Managed User', rateCents: 10000 },
    ]);
    const client = await createSeatClient(db, tenantId);
    const januaryCycle = await client.addMonthlyCycle(JANUARY_START, FEBRUARY_START);
    const result: any = await createClientContractFromWizard({
      contract_name: `Reset mixed ${uuidv4().slice(0, 6)}`,
      client_id: client.clientId,
      start_date: DECEMBER_START,
      end_date: '2025-06-30',
      billing_frequency: 'monthly',
      enable_proration: false,
      // $400 negotiated bundle (catalog says 1 x $50 + 3 x $200 = $650) + 5 seats at $100.
      fixed_base_rate: 40000,
      fixed_services: [
        { service_id: endpoint.serviceId, pricing_basis: 'bundle', quantity: 1 },
        { service_id: location.serviceId, pricing_basis: 'bundle', quantity: 3 },
        { service_id: user.serviceId, pricing_basis: 'unit', quantity: 5, unit_rate: 10000 },
      ],
      hourly_services: [],
      usage_services: [],
    } as any);
    expect(result, JSON.stringify(result)).toHaveProperty('contract_line_id');
    const lineId: string = result.contract_line_id;

    // A dated seat revision (5 -> 8 seats at $110 from February) exists before the reset.
    const before = await memberRows(lineId);
    const userBefore: any = before.get(user.serviceId);
    const scheduled: any = await scheduleUnitPricingRevision({
      contract_line_id: lineId,
      service_id: user.serviceId,
      config_id: userBefore.config_id,
      quantity: 8,
      unit_rate_cents: 11000,
      effective_period_start: FEBRUARY_START,
    });
    expect(scheduled, JSON.stringify(scheduled)).not.toHaveProperty('actionError');
    const revisionsBefore = await revisionRows(lineId);
    expect(revisionsBefore).toHaveLength(1);
    expect(Number(userBefore.base_rate)).toBe(10000);
    expect(userBefore.rate_provenance).toBe('custom');
    const bundleBefore: any = before.get(endpoint.serviceId);
    expect(Number(bundleBefore.base_rate)).toBe(10000);
    expect(bundleBefore.rate_provenance).not.toBe('inherited');

    const reset: any = await resetContractLineRateToStandard(lineId);
    expect(reset, JSON.stringify(reset)).toHaveProperty('applied');
    expect(reset.refused).toEqual([]);
    expect(reset.applied).toEqual([{ contractLineId: lineId, target: 'inherited' }]);

    // The line total and the bundle members follow the catalog again.
    const line: any = await tenantTable(db, tenantId, 'contract_lines')
      .where({ tenant: tenantId, contract_line_id: lineId }).first();
    expect(line.custom_rate).toBeNull();
    expect(line.rate_provenance).toBe('inherited');
    const after = await memberRows(lineId);
    for (const bundleService of [endpoint, location]) {
      const member: any = after.get(bundleService.serviceId);
      expect(member.base_rate, bundleService.name).toBeNull();
      expect(member.rate_provenance, bundleService.name).toBe('inherited');
      expect(member.pricing_basis ?? 'bundle').not.toBe('unit');
    }

    // The seat member is exactly as it was.
    const userAfter: any = after.get(user.serviceId);
    expect(userAfter.pricing_basis).toBe('unit');
    expect(Number(userAfter.base_rate)).toBe(10000);
    expect(userAfter.rate_provenance).toBe('custom');
    expect(Number(userAfter.quantity)).toBe(5);
    expect(await revisionRows(lineId)).toEqual(revisionsBefore);

    // Billing: the bundle is now the catalog $650; the seats still bill 5 x $100.
    await db.transaction((trx) =>
      syncRecurringServicePeriodsForContractLine(trx, { tenant: tenantId, contractLineId: lineId, sourceRunPrefix: 'per-seat-reset-test' }),
    );
    const invoice: any = await generateInvoice(januaryCycle);
    expect(invoice, JSON.stringify(invoice)).not.toHaveProperty('error');
    expect(Number(invoice.subtotal)).toBe(65000 + 50000);
  }, HOOK_TIMEOUT);
});
