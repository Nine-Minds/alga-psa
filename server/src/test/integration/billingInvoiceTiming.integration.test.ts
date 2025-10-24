import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import type { Knex } from 'knex';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import {
  setupClientTaxConfiguration,
  assignServiceTaxRate,
  createTestService,
  createFixedPlanAssignment,
  ensureClientPlanBundlesTable,
  ensureDefaultBillingSettings
} from '../../../test-utils/billingTestHelpers';
import { setupCommonMocks } from '../../../test-utils/testMocks';
import { Temporal } from '@js-temporal/polyfill';
import { BillingEngine } from 'server/src/lib/billing/billingEngine';

let db: Knex;
let tenantId: string;
let generateInvoice: typeof import('server/src/lib/actions/invoiceGeneration').generateInvoice;

vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant, fn: () => Promise<any>) => fn())
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null)
}));

describe('Billing Invoice Timing Integration', () => {
  const HOOK_TIMEOUT = 180_000;

  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_USER_ADMIN = process.env.DB_USER_ADMIN || 'postgres';
    process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'sebastian_test';
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'postpass123';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';

    db = await createTestDbConnection();
    await runMigrationsAndSeeds(db);
    tenantId = await ensureTenant(db);
    ({ generateInvoice } = await import('server/src/lib/actions/invoiceGeneration'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('books arrears contract lines onto the following invoice with prior-period service dates', async () => {
    setupCommonMocks({ tenantId, userId: 'test-user', permissionCheck: () => true });

    const clientId = uuidv4();
    await db('clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: 'Timing Integration Client',
      billing_cycle: 'monthly',
      is_tax_exempt: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    const contextLike = {
      db,
      tenantId,
      clientId
    } as any;

    await ensureDefaultBillingSettings(contextLike);
    await ensureClientPlanBundlesTable(contextLike);
    await setupClientTaxConfiguration(contextLike, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'New York Tax',
      startDate: '2024-01-01T00:00:00.000Z',
      taxPercentage: 8.875
    });
    await assignServiceTaxRate(contextLike, '*', 'US-NY', { onlyUnset: true });

    const baseRateCents = 20000;
    const serviceId = await createTestService(contextLike, {
      service_name: 'Integration Arrears Support',
      billing_method: 'fixed',
      default_rate: baseRateCents,
      unit_of_measure: 'seat',
      tax_region: 'US-NY'
    });

    const { clientContractLineId } = await createFixedPlanAssignment(contextLike, serviceId, {
      planName: 'Integration Arrears Plan',
      baseRateCents,
      startDate: '2024-12-01',
      clientId
    });

    await db('client_contract_line_pricing')
      .insert({
        tenant: tenantId,
        client_contract_line_id: clientContractLineId,
        custom_rate: baseRateCents,
        created_at: db.fn.now(),
        updated_at: db.fn.now()
      })
      .onConflict(['tenant', 'client_contract_line_id'])
      .merge({
        custom_rate: baseRateCents,
        updated_at: db.fn.now()
      });

    if (await db.schema.hasColumn('client_contract_line_terms', 'billing_timing')) {
      await db('client_contract_line_terms')
        .insert({
          tenant: tenantId,
          client_contract_line_id: clientContractLineId,
          billing_frequency: 'monthly',
          billing_timing: 'arrears',
          created_at: db.fn.now(),
          updated_at: db.fn.now()
        })
        .onConflict(['tenant', 'client_contract_line_id'])
        .merge({
          billing_frequency: 'monthly',
          billing_timing: 'arrears',
          updated_at: db.fn.now()
        });
    }

    const decemberStart = '2024-12-01T00:00:00Z';
    const januaryStart = '2025-01-01T00:00:00Z';
    const februaryStart = '2025-02-01T00:00:00Z';

    await db('client_billing_cycles').insert({
      billing_cycle_id: uuidv4(),
      tenant: tenantId,
      client_id: clientId,
      billing_cycle: 'monthly',
      effective_date: decemberStart,
      period_start_date: decemberStart,
      period_end_date: januaryStart,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    const januaryCycleId = uuidv4();
    await db('client_billing_cycles').insert({
      billing_cycle_id: januaryCycleId,
      tenant: tenantId,
      client_id: clientId,
      billing_cycle: 'monthly',
      effective_date: januaryStart,
      period_start_date: januaryStart,
      period_end_date: februaryStart,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    const engine = new BillingEngine();
    const billingResult = await engine.calculateBilling(
      clientId,
      januaryStart,
      februaryStart,
      januaryCycleId
    );

    // A fixed arrears line should produce at least one charge for the following cycle.
    expect(billingResult.charges.length).toBeGreaterThan(0);
    const fixedCharge = billingResult.charges.find((charge) => charge.type === 'fixed');
    expect(fixedCharge).toBeTruthy();
    // The charge should be tagged as arrears and include the previous cycle's balance.
    expect(fixedCharge?.billingTiming).toBe('arrears');
    expect((fixedCharge?.total ?? 0) > 0).toBe(true);

    const expectedStart = Temporal.PlainDate.from(januaryStart.slice(0, 10))
      .subtract({ months: 1 })
      .toString();
    const expectedEnd = Temporal.PlainDate.from(januaryStart.slice(0, 10))
      .subtract({ days: 1 })
      .toString();
    expect(fixedCharge?.servicePeriodStart).toBe(expectedStart);
    expect(fixedCharge?.servicePeriodEnd).toBe(expectedEnd);
  }, HOOK_TIMEOUT);
});

async function runMigrationsAndSeeds(connection: Knex): Promise<void> {
  await connection.raw('DROP SCHEMA IF EXISTS public CASCADE');
  await connection.raw('CREATE SCHEMA public');
  await connection.raw('GRANT ALL ON SCHEMA public TO public');
  await connection.raw(`GRANT ALL ON SCHEMA public TO ${process.env.DB_USER_ADMIN || 'postgres'}`);

  await connection.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
  await connection.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  try {
    await connection.raw('CREATE EXTENSION IF NOT EXISTS "vector"');
  } catch (error) {
    console.warn('[billingInvoiceTiming.integration] pgvector extension unavailable:', error);
  }

  const migrationsDir = path.resolve(process.cwd(), 'server', 'migrations');
  const seedsDir = path.resolve(process.cwd(), 'server', 'seeds', 'dev');

  await connection.migrate.rollback({ directory: migrationsDir, loadExtensions: ['.cjs', '.js'] }, true);
  await connection.migrate.latest({ directory: migrationsDir, loadExtensions: ['.cjs', '.js'] });
  await connection.seed.run({ directory: seedsDir, loadExtensions: ['.cjs', '.js'] });
}

async function ensureTenant(connection: Knex): Promise<string> {
  const existing = await connection('tenants').first<{ tenant: string }>('tenant');
  if (existing?.tenant) {
    return existing.tenant;
  }

  const newTenantId = uuidv4();
  await connection('tenants').insert({
    tenant: newTenantId,
    client_name: 'Billing Timing Integration Tenant',
    email: 'billing-timing@test.co',
    created_at: connection.fn.now(),
    updated_at: connection.fn.now()
  });
  return newTenantId;
}
