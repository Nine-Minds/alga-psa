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

// getContractOverview must return the EFFECTIVE billing timing (Hourly/Usage are
// always arrears whatever is stored; Fixed keeps its stored value), on both the
// contract-line branch and the template-line branch (alga-2026-0002714).
//
// The schema now has CHECK constraints (*_hourly_usage_not_advance_check) that forbid
// new Hourly/Usage rows stored as 'advance', so those legacy rows are simulated inside
// a transaction that drops the constraint, reads the overview through that same
// transaction, and ALWAYS rolls back (DDL is transactional in Postgres).

let db: Knex;
let tenantId: string;
let createClientContractFromWizard: typeof import('@alga-psa/billing/actions/contractWizardActions').createClientContractFromWizard;
let createContractTemplateFromWizard: typeof import('@alga-psa/billing/actions/contractWizardActions').createContractTemplateFromWizard;
let getContractOverview: typeof import('@alga-psa/billing/actions/contractActions').getContractOverview;

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

class Rollback extends Error {}
// Runs `fn` with the module-level `db` (what the mocked createTenantKnex returns) pointing at a
// transaction in which `constraint` on `table` is dropped; rolls back afterwards.
async function withLegacyRows<T>(table: string, constraint: string, fn: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
  const baseDb = db;
  let result!: T;
  try {
    await baseDb.transaction(async (trx) => {
      await trx.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${constraint}`);
      db = trx;
      result = await fn(trx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  } finally {
    db = baseDb;
  }
  return result;
}

// Wizard actions report expected failures as `{ actionError }` / `{ permissionError }` values,
// not throws; reject those too so a refused submission fails here, not as an undefined id later.
const ok = <T,>(result: T): T => {
  expect(result, JSON.stringify(result)).toBeTruthy();
  // Wizard actions report expected failures as values ({ actionError } / { permissionError }), not throws.
  expect(result).not.toHaveProperty('error');
  expect(result, JSON.stringify(result)).not.toHaveProperty('actionError');
  expect(result).not.toHaveProperty('permissionError');
  return result;
};

describe('getContractOverview effective billing timing', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection();
    await db.migrate.latest();
    tenantId = await ensureFixtureTenant(db);
    setupCommonMocks({ tenantId, userId: 'per-seat-test-user', permissionCheck: () => true });
    ({ createClientContractFromWizard, createContractTemplateFromWizard } = await import('@alga-psa/billing/actions/contractWizardActions'));
    ({ getContractOverview } = await import('@alga-psa/billing/actions/contractActions'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  const seatService = async () => {
    const [svc] = await createSeatCatalog(db, tenantId, [{ name: 'Timing Seat', rateCents: 10000, prices: {} }]);
    return svc;
  };
  const timingsByType = (overview: any) =>
    Object.fromEntries(overview.contractLines.map((l: any) => [l.contract_line_type, l.billing_timing]));

  it('contract branch: Fixed advance stays advance; Hourly/Usage stored as advance read arrears', async () => {
    const svc = await seatService();
    const client = await createSeatClient(db, tenantId);
    const created: any = ok(
      await createClientContractFromWizard({
        contract_name: `Timing ${uuidv4().slice(0, 6)}`,
        client_id: client.clientId,
        start_date: '2024-12-01',
        end_date: '2025-06-30',
        billing_frequency: 'monthly',
        enable_proration: false,
        fixed_services: [{ service_id: svc.serviceId, pricing_basis: 'unit', quantity: 1, unit_rate: 10000 }],
        hourly_services: [],
        usage_services: [],
      } as any),
    );
    const fixed = await tenantTable(db, tenantId, 'contract_lines')
      .where({ tenant: tenantId, contract_line_id: created.contract_line_id })
      .first();
    await tenantTable(db, tenantId, 'contract_lines')
      .where({ tenant: tenantId, contract_line_id: created.contract_line_id })
      .update({ billing_timing: 'advance' });

    const { stored, overview } = await withLegacyRows('contract_lines', 'contract_lines_hourly_usage_not_advance_check', async (trx) => {
      for (const type of ['Hourly', 'Usage']) {
        await trx('contract_lines').insert({
          ...fixed,
          contract_line_id: uuidv4(),
          contract_line_name: `${type} line`,
          contract_line_type: type,
          billing_timing: 'advance',
          display_order: 5,
        });
      }
      const rows = await trx('contract_lines').where({ tenant: tenantId, contract_id: created.contract_id });
      return { stored: rows, overview: ok(await getContractOverview(created.contract_id)) as any };
    });
    // Raw column is 'advance' for all three; the action must not return it for Hourly/Usage.
    expect(stored.map((r: any) => r.billing_timing)).toEqual(['advance', 'advance', 'advance']);
    expect(timingsByType(overview)).toEqual({ Fixed: 'advance', Hourly: 'arrears', Usage: 'arrears' });
  }, HOOK_TIMEOUT);

  it('template branch: Fixed advance stays advance; Hourly/Usage stored as advance read arrears', async () => {
    const svc = await seatService();
    const template: any = ok(
      await createContractTemplateFromWizard({
        contract_name: `Timing template ${uuidv4().slice(0, 6)}`,
        billing_frequency: 'monthly',
        // Templates carry their own base currency and the action rejects a
        // submission without a valid ISO 4217 code.
        currency_code: 'USD',
        fixed_services: [{ service_id: svc.serviceId, pricing_basis: 'unit', quantity: 1, unit_rate: 10000 }],
      } as any),
    );
    const fixed = await tenantTable(db, tenantId, 'contract_template_lines')
      .where({ tenant: tenantId, template_line_id: template.contract_line_id })
      .first();
    await tenantTable(db, tenantId, 'contract_template_lines')
      .where({ tenant: tenantId, template_line_id: template.contract_line_id })
      .update({ billing_timing: 'advance' });
    const overview: any = await withLegacyRows('contract_template_lines', 'contract_template_lines_hourly_usage_not_advance_check', async (trx) => {
      for (const type of ['Hourly', 'Usage']) {
        await trx('contract_template_lines').insert({
          ...fixed,
          template_line_id: uuidv4(),
          template_line_name: `${type} line`,
          line_type: type,
          billing_timing: 'advance',
          display_order: 5,
        });
      }
      return ok(await getContractOverview(template.contract_id));
    });
    expect(timingsByType(overview)).toEqual({ Fixed: 'advance', Hourly: 'arrears', Usage: 'arrears' });
  }, HOOK_TIMEOUT);
});
