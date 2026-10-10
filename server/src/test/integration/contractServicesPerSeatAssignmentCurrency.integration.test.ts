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

// getContractAssignments must report each assignment's own contract currency
// (the template detail page formats PO amounts with it).

let db: Knex;
let tenantId: string;
let createClientContractFromWizard: typeof import('@alga-psa/billing/actions/contractWizardActions').createClientContractFromWizard;
let getContractAssignments: typeof import('@alga-psa/billing/actions/contractActions').getContractAssignments;


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

describe('getContractAssignments currency', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection();
    await db.migrate.latest();
    tenantId = await ensureFixtureTenant(db);
    setupCommonMocks({ tenantId, userId: 'per-seat-test-user', permissionCheck: () => true });
    ({ createClientContractFromWizard } = await import('@alga-psa/billing/actions/contractWizardActions'));
    ({ getContractAssignments } = await import('@alga-psa/billing/actions/contractActions'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it("returns the assigned contract's own non-USD currency alongside the PO amount", async () => {
    const client = await createSeatClient(db, tenantId, { currencyCode: 'GBP' });
    const [seat] = await createSeatCatalog(db, tenantId, [
      { name: 'Assignment Currency Seat', rateCents: 10000, prices: { GBP: 9000 } },
    ]);
    const result: any = await createClientContractFromWizard({
      contract_name: `Assignment currency ${uuidv4().slice(0, 6)}`,
      client_id: client.clientId,
      start_date: '2025-01-01',
      end_date: '2025-06-30',
      billing_frequency: 'monthly',
      enable_proration: false,
      fixed_services: [{ service_id: seat.serviceId, pricing_basis: 'unit', quantity: 2, unit_rate: 9000 }] as any,
      hourly_services: [],
      usage_services: [],
      po_required: true,
      po_number: 'PO-GBP-1',
      po_amount: 123400,
    } as any);
    expect(result, JSON.stringify(result)).toHaveProperty('contract_id');

    // Make the stored currency explicit regardless of how the wizard derived it.
    await tenantTable(db, tenantId, 'contracts')
      .where({ contract_id: result.contract_id })
      .update({ currency_code: 'GBP' });

    const assignments: any = await getContractAssignments(result.contract_id);
    expect(assignments, JSON.stringify(assignments)).toHaveLength(1);
    // pg returns the bigint column as a string; the UI wraps it in Number().
    expect(Number(assignments[0].po_amount)).toBe(123400);
    expect(assignments[0]).toMatchObject({
      client_id: client.clientId,
      po_required: true,
      currency_code: 'GBP',
    });
  }, HOOK_TIMEOUT);
});
