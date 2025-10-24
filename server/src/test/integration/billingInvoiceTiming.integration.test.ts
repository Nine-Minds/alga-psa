import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import type { Knex } from 'knex';
import path from 'node:path';
import process from 'node:process';
import { v4 as uuidv4 } from 'uuid';
import { Temporal } from '@js-temporal/polyfill';

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
import { generateInvoice } from 'server/src/lib/actions/invoiceGeneration';

let db: Knex;
let tenantId: string;

vi.mock('@alga-psa/shared/core/secretProvider', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: async () => '',
    getSecret: async (_key: string, _envVar?: string, fallback?: string) => fallback ?? ''
  }))
}));

vi.mock('@alga-psa/shared/core', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

vi.mock('@alga-psa/shared/core/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

vi.mock('@alga-psa/shared/db', () => ({
  withTransaction: vi.fn(async (knex, callback) => callback(knex)),
  withAdminTransaction: vi.fn(async (callback, existing) => callback(existing as any))
}));

vi.mock('server/src/lib/auth/getSession', () => ({
  getSession: vi.fn(async () => ({
    user: {
      id: 'test-user',
      tenant: tenantId
    }
  }))
}));

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true)
}));

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
  getCurrentTenantId: vi.fn(async () => tenantId),
  runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn())
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
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    setupCommonMocks({
      tenantId,
      userId: 'test-user',
      permissionCheck: () => true
    });

    const tablesToClean = [
      'invoice_item_details',
      'invoice_items',
      'invoices',
      'client_billing_cycles',
      'client_contract_line_terms',
      'client_contract_lines',
      'client_contracts',
      'contract_line_service_fixed_config',
      'contract_line_service_configuration',
      'contract_line_services',
      'contract_line_discounts',
      'contract_line_fixed_config',
      'contract_lines',
      'service_catalog'
    ];

    for (const table of tablesToClean) {
      await db(table).where({ tenant: tenantId }).del();
    }
  });

  afterEach(async () => {
    const tablesToClean = [
      'invoice_item_details',
      'invoice_items',
      'invoices',
      'client_billing_cycles',
      'client_contract_line_terms',
      'client_contract_lines',
      'client_contracts',
      'contract_line_service_fixed_config',
      'contract_line_service_configuration',
      'contract_line_services',
      'contract_line_discounts',
      'contract_line_fixed_config',
      'contract_lines',
      'service_catalog'
    ];

    for (const table of tablesToClean) {
      await db(table).where({ tenant: tenantId }).del();
    }
  });

  it('books arrears contract line onto the next invoice with prior service period', async () => {
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

    const invoice = await generateInvoice(januaryCycleId);
    expect(invoice).toBeTruthy();

    const detail = await db('invoice_item_details as iid')
      .join('invoice_items as ii', function joinInvoiceItems() {
        this.on('iid.item_id', '=', 'ii.item_id').andOn('iid.tenant', '=', 'ii.tenant');
      })
      .where('ii.invoice_id', invoice!.invoice_id)
      .andWhere('iid.tenant', tenantId)
      .first([
        'iid.service_period_start',
        'iid.service_period_end',
        'iid.billing_timing',
        'ii.total_price'
      ]);

    expect(detail).toBeTruthy();
    expect(detail?.billing_timing).toBe('arrears');
    expect(Number(detail?.total_price)).toBe(baseRateCents);

    const expectedStart = Temporal.PlainDate.from(januaryStart.slice(0, 10))
      .subtract({ months: 1 })
      .toString();
    const expectedEnd = Temporal.PlainDate.from(januaryStart.slice(0, 10))
      .subtract({ days: 1 })
      .toString();

    expect(detail?.service_period_start).toBe(expectedStart);
    expect(detail?.service_period_end).toBe(expectedEnd);
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
