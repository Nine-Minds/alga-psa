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
let generateInvoice: typeof import('@alga-psa/billing/actions/invoiceGeneration').generateInvoice;

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
    ({ generateInvoice } = await import('@alga-psa/billing/actions/invoiceGeneration'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('books arrears contract lines onto the following invoice with prior-period service dates', async () => {
    setupCommonMocks({ tenantId, userId: 'test-user', permissionCheck: () => true });

    const {
      contextLike,
      januaryCycleId,
      januaryStart
    } = await createClientWithCycles();

    const februaryStart = Temporal.PlainDate.from(januaryStart).add({ months: 1 }).toString();

    const { clientContractLineId } = await createFixedContractLine(contextLike, {
      serviceName: 'Integration Arrears Support',
      planName: 'Integration Arrears Plan',
      baseRateCents: 20000,
      startDate: '2024-12-01',
      billingTiming: 'arrears'
    });

    const engine = new BillingEngine();
    const billingResult = await engine.calculateBilling(
      contextLike.clientId,
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

  it('persists arrears invoice detail service periods on generated invoices', async () => {
    setupCommonMocks({ tenantId, userId: 'arrears-user', permissionCheck: () => true });

    const {
      contextLike,
      januaryCycleId,
      decemberStart,
      decemberEnd
    } = await createClientWithCycles('Arrears Invoice Client');

    const { serviceId } = await createFixedContractLine(contextLike, {
      serviceName: 'Arrears Invoice Support',
      planName: 'Arrears Invoice Plan',
      baseRateCents: 15000,
      startDate: '2024-12-01',
      billingTiming: 'arrears'
    });

    const invoice = await generateInvoice(januaryCycleId);
    expect(invoice).toBeTruthy();

    const detailRows = await getInvoiceDetailRows(invoice!.invoice_id);
    const arrearsDetail = detailRows.find((row) => row.service_id === serviceId);
    expect(arrearsDetail).toBeTruthy();
    expect(normalizeDateValue(arrearsDetail?.service_period_start)).toBe(decemberStart);
    expect(normalizeDateValue(arrearsDetail?.service_period_end)).toBe(decemberEnd);
    expect(arrearsDetail?.billing_timing).toBe('arrears');
  }, HOOK_TIMEOUT);

  it('persists advance invoice detail service periods for current cycles', async () => {
    setupCommonMocks({ tenantId, userId: 'advance-user', permissionCheck: () => true });

    const {
      contextLike,
      januaryCycleId,
      januaryStart,
      januaryEnd
    } = await createClientWithCycles('Advance Invoice Client');

    const { serviceId } = await createFixedContractLine(contextLike, {
      serviceName: 'Advance Invoice Support',
      planName: 'Advance Invoice Plan',
      baseRateCents: 18000,
      startDate: '2024-12-01',
      billingTiming: 'advance'
    });

    const invoice = await generateInvoice(januaryCycleId);
    expect(invoice).toBeTruthy();

    const detailRows = await getInvoiceDetailRows(invoice!.invoice_id);
    const advanceDetail = detailRows.find((row) => row.service_id === serviceId);
    expect(advanceDetail).toBeTruthy();
    expect(normalizeDateValue(advanceDetail?.service_period_start)).toBe(januaryStart);
    expect(normalizeDateValue(advanceDetail?.service_period_end)).toBe(januaryEnd);
    expect(advanceDetail?.billing_timing).toBe('advance');
  }, HOOK_TIMEOUT);

  it('persists mixed timing invoice detail metadata for arrears and advance lines', async () => {
    setupCommonMocks({ tenantId, userId: 'mixed-user', permissionCheck: () => true });

    const {
      contextLike,
      januaryCycleId,
      decemberStart,
      decemberEnd,
      januaryStart,
      januaryEnd
    } = await createClientWithCycles('Mixed Timing Client');

    const arrearsLine = await createFixedContractLine(contextLike, {
      serviceName: 'Mixed Arrears Service',
      planName: 'Mixed Arrears Plan',
      baseRateCents: 21000,
      startDate: '2024-12-01',
      billingTiming: 'arrears'
    });

    const advanceLine = await createFixedContractLine(contextLike, {
      serviceName: 'Mixed Advance Service',
      planName: 'Mixed Advance Plan',
      baseRateCents: 22000,
      startDate: '2024-12-01',
      billingTiming: 'advance'
    });

    const invoice = await generateInvoice(januaryCycleId);
    expect(invoice).toBeTruthy();

    const detailRows = await getInvoiceDetailRows(invoice!.invoice_id);
    const detailByService = new Map(detailRows.map((row) => [row.service_id, row]));

    const arrearsDetail = detailByService.get(arrearsLine.serviceId);
    const advanceDetail = detailByService.get(advanceLine.serviceId);

    expect(arrearsDetail).toBeTruthy();
    expect(advanceDetail).toBeTruthy();

    expect(normalizeDateValue(arrearsDetail?.service_period_start)).toBe(decemberStart);
    expect(normalizeDateValue(arrearsDetail?.service_period_end)).toBe(decemberEnd);
    expect(arrearsDetail?.billing_timing).toBe('arrears');

    expect(normalizeDateValue(advanceDetail?.service_period_start)).toBe(januaryStart);
    expect(normalizeDateValue(advanceDetail?.service_period_end)).toBe(januaryEnd);
    expect(advanceDetail?.billing_timing).toBe('advance');
  }, HOOK_TIMEOUT);
});

interface ClientSetupResult {
  contextLike: { db: Knex; tenantId: string; clientId: string };
  clientId: string;
  januaryCycleId: string;
  decemberStart: string;
  decemberEnd: string;
  januaryStart: string;
  januaryEnd: string;
}

interface FixedLineOptions {
  serviceName: string;
  planName: string;
  baseRateCents: number;
  startDate: string;
  billingTiming: 'arrears' | 'advance';
  customRateCents?: number;
}

async function createClientWithCycles(clientName = 'Timing Integration Client'): Promise<ClientSetupResult> {
  const clientId = uuidv4();
  await db('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: clientName,
    billing_cycle: 'monthly',
    is_tax_exempt: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });

  const contextLike = {
    db,
    tenantId,
    clientId
  } as const;

  await ensureDefaultBillingSettings(contextLike as any);
  await ensureClientPlanBundlesTable(contextLike as any);
  await setupClientTaxConfiguration(contextLike as any, {
    regionCode: 'US-NY',
    regionName: 'New York',
    description: 'New York Tax',
    startDate: '2024-01-01T00:00:00.000Z',
    taxPercentage: 8.875
  });
  await assignServiceTaxRate(contextLike as any, '*', 'US-NY', { onlyUnset: true });

  const decemberStart = '2024-12-01';
  const januaryStart = '2025-01-01';
  const februaryStart = '2025-02-01';
  const decemberEnd = Temporal.PlainDate.from(januaryStart).subtract({ days: 1 }).toString();
  const januaryEnd = Temporal.PlainDate.from(februaryStart).subtract({ days: 1 }).toString();

  await db('client_billing_cycles').insert({
    billing_cycle_id: uuidv4(),
    tenant: tenantId,
    client_id: clientId,
    billing_cycle: 'monthly',
    effective_date: `${decemberStart}T00:00:00Z`,
    period_start_date: `${decemberStart}T00:00:00Z`,
    period_end_date: `${januaryStart}T00:00:00Z`,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });

  const januaryCycleId = uuidv4();
  await db('client_billing_cycles').insert({
    billing_cycle_id: januaryCycleId,
    tenant: tenantId,
    client_id: clientId,
    billing_cycle: 'monthly',
    effective_date: `${januaryStart}T00:00:00Z`,
    period_start_date: `${januaryStart}T00:00:00Z`,
    period_end_date: `${februaryStart}T00:00:00Z`,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });

  return {
    contextLike: contextLike as any,
    clientId,
    januaryCycleId,
    decemberStart,
    decemberEnd,
    januaryStart,
    januaryEnd
  };
}

async function createFixedContractLine(
  contextLike: { db: Knex; tenantId: string; clientId: string },
  options: FixedLineOptions
): Promise<{ serviceId: string; clientContractLineId: string }> {
  const serviceId = await createTestService(contextLike as any, {
    service_name: options.serviceName,
    billing_method: 'fixed',
    default_rate: options.baseRateCents,
    unit_of_measure: 'seat',
    tax_region: 'US-NY'
  });

  const { clientContractLineId } = await createFixedPlanAssignment(contextLike as any, serviceId, {
    planName: options.planName,
    baseRateCents: options.baseRateCents,
    startDate: options.startDate,
    clientId: contextLike.clientId,
    customRateCents: options.customRateCents
  });

  if (options.customRateCents !== undefined) {
    await contextLike.db('client_contract_line_pricing')
      .insert({
        tenant: contextLike.tenantId,
        client_contract_line_id: clientContractLineId,
        custom_rate: options.customRateCents,
        created_at: contextLike.db.fn.now(),
        updated_at: contextLike.db.fn.now()
      })
      .onConflict(['tenant', 'client_contract_line_id'])
      .merge({
        custom_rate: options.customRateCents,
        updated_at: contextLike.db.fn.now()
      });
  }

  if (await contextLike.db.schema.hasColumn('client_contract_line_terms', 'billing_timing')) {
    await contextLike.db('client_contract_line_terms')
      .insert({
        tenant: contextLike.tenantId,
        client_contract_line_id: clientContractLineId,
        billing_frequency: 'monthly',
        billing_timing: options.billingTiming,
        created_at: contextLike.db.fn.now(),
        updated_at: contextLike.db.fn.now()
      })
      .onConflict(['tenant', 'client_contract_line_id'])
      .merge({
        billing_frequency: 'monthly',
        billing_timing: options.billingTiming,
        updated_at: contextLike.db.fn.now()
      });
  }

  return { serviceId, clientContractLineId };
}

async function getInvoiceDetailRows(invoiceId: string) {
  return db('invoice_charge_details as iid')
    .join('invoice_charges as ii', function () {
      this.on('iid.item_id', '=', 'ii.item_id').andOn('iid.tenant', '=', 'ii.tenant');
    })
    .where('ii.invoice_id', invoiceId)
    .andWhere('iid.tenant', tenantId)
    .select([
      'iid.service_id',
      'iid.service_period_start',
      'iid.service_period_end',
      'iid.billing_timing'
    ]);
}

function normalizeDateValue(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value.slice(0, 10);
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  try {
    return Temporal.PlainDate.from(value as any).toString();
  } catch (error) {
    return null;
  }
}

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
