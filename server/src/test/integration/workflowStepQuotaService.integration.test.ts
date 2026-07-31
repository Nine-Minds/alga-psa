import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import type { Knex } from 'knex';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { workflowStepQuotaService } from '../../../../shared/workflow/runtime/services/workflowStepQuotaService';
import logger from '@alga-psa/core/logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const stripeMigration = require(path.resolve(__dirname, '../../../../ee/server/migrations/20251014120000_create_stripe_integration_tables.cjs')) as {
  up: (knex: Knex) => Promise<void>;
};

let db: Knex;

async function ensureStripeTables(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('stripe_subscriptions'))) {
    await stripeMigration.up(knex);
  }
}

function tenantTable(knex: Knex, tenant: string, table: string) {
  return tenantDb(knex, tenant).table(table);
}

function tenantRows(knex: Knex, tenant: string) {
  return tenantDb(knex, tenant).unscoped('tenants', 'workflow step quota test fixture creates tenant rows');
}

async function seedTenant(knex: Knex, tenant: string, plan: 'solo' | 'pro' | 'premium' = 'pro'): Promise<void> {
  const hasCompanyName = await knex.schema.hasColumn('tenants', 'company_name');
  const hasClientName = await knex.schema.hasColumn('tenants', 'client_name');
  const hasEmail = await knex.schema.hasColumn('tenants', 'email');
  const payload: Record<string, unknown> = {
    tenant,
    plan,
  };
  if (hasCompanyName) payload.company_name = 'Quota Test Co';
  if (hasClientName) payload.client_name = 'Quota Test Co';
  if (hasEmail) payload.email = `${tenant}@example.com`;
  await tenantRows(knex, tenant).insert(payload);
}

async function seedStripePeriod(knex: Knex, tenant: string, args: {
  status: 'trialing' | 'active' | 'past_due' | 'unpaid';
  workflowStepLimitPrice?: unknown;
  workflowStepLimitProduct?: unknown;
  start: string;
  end: string;
}): Promise<void> {
  const customerId = uuidv4();
  const productId = uuidv4();
  const priceId = uuidv4();
  const subscriptionId = uuidv4();

  await tenantTable(knex, tenant, 'stripe_customers').insert({
    tenant,
    stripe_customer_id: customerId,
    stripe_customer_external_id: `cus_${uuidv4()}`,
    email: 'billing@example.com',
    name: 'Billing',
  });

  await tenantTable(knex, tenant, 'stripe_products').insert({
    tenant,
    stripe_product_id: productId,
    stripe_product_external_id: `prod_${uuidv4()}`,
    name: 'Plan Product',
    product_type: 'license',
    metadata: args.workflowStepLimitProduct == null ? {} : { workflow_step_limit: args.workflowStepLimitProduct },
  });

  await tenantTable(knex, tenant, 'stripe_prices').insert({
    tenant,
    stripe_price_id: priceId,
    stripe_price_external_id: `price_${uuidv4()}`,
    stripe_product_id: productId,
    unit_amount: 1000,
    metadata: args.workflowStepLimitPrice == null ? {} : { workflow_step_limit: args.workflowStepLimitPrice },
  });

  await tenantTable(knex, tenant, 'stripe_subscriptions').insert({
    tenant,
    stripe_subscription_id: subscriptionId,
    stripe_subscription_external_id: `sub_${uuidv4()}`,
    stripe_customer_id: customerId,
    stripe_price_id: priceId,
    quantity: 1,
    status: args.status,
    current_period_start: args.start,
    current_period_end: args.end,
  });
}

beforeAll(async () => {
  db = await createTestDbConnection({ runSeeds: false });
  await ensureStripeTables(db);
});

beforeEach(async () => {
  await db.raw('TRUNCATE workflow_step_usage_periods, stripe_subscriptions, stripe_prices, stripe_products, stripe_customers, tenants RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await db.destroy();
});

describe('workflowStepQuotaService', () => {
  it('enforces uniqueness on (tenant, period_start, period_end) and supports upsert', async () => {
    const tenant = uuidv4();
    await seedTenant(db, tenant, 'pro');
    const periodStart = '2026-04-01T00:00:00.000Z';
    const periodEnd = '2026-05-01T00:00:00.000Z';

    await tenantTable(db, tenant, 'workflow_step_usage_periods').insert({
      tenant,
      period_start: periodStart,
      period_end: periodEnd,
      period_source: 'fallback_calendar',
      stripe_subscription_id: null,
      effective_limit: 750,
      used_count: 1,
      limit_source: 'tier_default',
      tier: 'pro',
    });

    await tenantTable(db, tenant, 'workflow_step_usage_periods')
      .insert({
        tenant,
        period_start: periodStart,
        period_end: periodEnd,
        period_source: 'fallback_calendar',
        stripe_subscription_id: null,
        effective_limit: 750,
        used_count: 2,
        limit_source: 'tier_default',
        tier: 'pro',
      })
      .onConflict(['tenant', 'period_start', 'period_end'])
      .merge({
        used_count: 2,
        updated_at: db.fn.now(),
      });

    const rows = await tenantTable(db, tenant, 'workflow_step_usage_periods')
      .where({ tenant, period_start: periodStart, period_end: periodEnd })
      .select('*');

    expect(rows).toHaveLength(1);
    expect(rows[0].used_count).toBe(2);
  });

  it('uses active Stripe period for resolver with stripe_subscription source', async () => {
    const tenant = uuidv4();
    await seedTenant(db, tenant, 'pro');
    await seedStripePeriod(db, tenant, {
      status: 'active',
      start: '2026-04-01T00:00:00.000Z',
      end: '2026-05-01T00:00:00.000Z',
    });

    const summary = await workflowStepQuotaService.resolveQuotaSummary(db, tenant, new Date('2026-04-15T00:00:00.000Z'));

    expect(summary.periodSource).toBe('stripe_subscription');
    expect(summary.periodStart).toBe('2026-04-01T00:00:00.000Z');
    expect(summary.periodEnd).toBe('2026-05-01T00:00:00.000Z');
  });

  it('falls back to UTC calendar month and tier defaults without valid stripe period', async () => {
    const tenant = uuidv4();
    await seedTenant(db, tenant, 'solo');

    const summary = await workflowStepQuotaService.resolveQuotaSummary(db, tenant, new Date('2026-04-15T10:10:10.000Z'));

    expect(summary.periodSource).toBe('fallback_calendar');
    expect(summary.periodStart).toBe('2026-04-01T00:00:00.000Z');
    expect(summary.periodEnd).toBe('2026-05-01T00:00:00.000Z');
    expect(summary.effectiveLimit).toBe(150);
    expect(summary.limitSource).toBe('tier_default');
  });

  it('applies metadata precedence price > product > tier default and supports unlimited', async () => {
    const tenant = uuidv4();
    await seedTenant(db, tenant, 'premium');
    await seedStripePeriod(db, tenant, {
      status: 'active',
      start: '2026-04-01T00:00:00.000Z',
      end: '2026-05-01T00:00:00.000Z',
      workflowStepLimitProduct: '5000',
      workflowStepLimitPrice: '1200',
    });

    // Pin `now` inside the seeded Stripe period so the test is not wall-clock
    // dependent (the default `now = new Date()` left the April period behind
    // once the real date passed it).
    const now = new Date('2026-04-15T00:00:00.000Z');

    const priceSummary = await workflowStepQuotaService.resolveQuotaSummary(db, tenant, now);
    expect(priceSummary.effectiveLimit).toBe(1200);
    expect(priceSummary.limitSource).toBe('stripe_price_metadata');

    await tenantTable(db, tenant, 'stripe_prices').where({ tenant }).update({ metadata: { workflow_step_limit: 'invalid' } });
    const productSummary = await workflowStepQuotaService.resolveQuotaSummary(db, tenant, now);
    expect(productSummary.effectiveLimit).toBe(5000);
    expect(productSummary.limitSource).toBe('stripe_product_metadata');

    await tenantTable(db, tenant, 'stripe_products').where({ tenant }).update({ metadata: { workflow_step_limit: 'unlimited' } });
    const unlimitedSummary = await workflowStepQuotaService.resolveQuotaSummary(db, tenant, now);
    expect(unlimitedSummary.effectiveLimit).toBeNull();
    expect(unlimitedSummary.limitSource).toBe('unlimited_metadata');
  });

  it('reserves finite quota atomically and rejects at limit without incrementing', async () => {
    const tenant = uuidv4();
    await seedTenant(db, tenant, 'solo');
    await seedStripePeriod(db, tenant, {
      status: 'active',
      start: '2026-04-01T00:00:00.000Z',
      end: '2026-05-01T00:00:00.000Z',
      workflowStepLimitPrice: '2',
    });

    const now = new Date('2026-04-15T00:00:00.000Z');
    const first = await workflowStepQuotaService.reserveStepStart(db, tenant, now);
    const second = await workflowStepQuotaService.reserveStepStart(db, tenant, now);
    const third = await workflowStepQuotaService.reserveStepStart(db, tenant, now);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);

    const row = await tenantTable(db, tenant, 'workflow_step_usage_periods').where({ tenant }).first<{ used_count: number }>();
    expect(row?.used_count).toBe(2);
  });

  it('allows unlimited reservations and still increments used_count', async () => {
    const tenant = uuidv4();
    await seedTenant(db, tenant, 'pro');
    await seedStripePeriod(db, tenant, {
      status: 'active',
      start: '2026-04-01T00:00:00.000Z',
      end: '2026-05-01T00:00:00.000Z',
      workflowStepLimitPrice: 'unlimited',
    });

    const now = new Date('2026-04-15T00:00:00.000Z');
    const results = await Promise.all([
      workflowStepQuotaService.reserveStepStart(db, tenant, now),
      workflowStepQuotaService.reserveStepStart(db, tenant, now),
      workflowStepQuotaService.reserveStepStart(db, tenant, now),
      workflowStepQuotaService.reserveStepStart(db, tenant, now),
    ]);

    expect(results.every((result) => result.allowed)).toBe(true);
    const row = await tenantTable(db, tenant, 'workflow_step_usage_periods').where({ tenant }).first<{ used_count: number; effective_limit: number | null }>();
    expect(row?.effective_limit).toBeNull();
    expect(row?.used_count).toBe(4);
  });

  it('does not allow concurrent finite reservations to exceed effective_limit', async () => {
    const tenant = uuidv4();
    await seedTenant(db, tenant, 'solo');
    await seedStripePeriod(db, tenant, {
      status: 'active',
      start: '2026-04-01T00:00:00.000Z',
      end: '2026-05-01T00:00:00.000Z',
      workflowStepLimitPrice: '3',
    });

    const now = new Date('2026-04-15T00:00:00.000Z');
    const reservations = await Promise.all(
      Array.from({ length: 12 }).map(() => workflowStepQuotaService.reserveStepStart(db, tenant, now))
    );

    const allowedCount = reservations.filter((reservation) => reservation.allowed).length;
    const deniedCount = reservations.length - allowedCount;
    expect(allowedCount).toBe(3);
    expect(deniedCount).toBe(9);

    const row = await tenantTable(db, tenant, 'workflow_step_usage_periods').where({ tenant }).first<{ used_count: number }>();
    expect(row?.used_count).toBe(3);
  });

  it('reports reconciliation drift between usage counter and step ledger', async () => {
    const tenant = uuidv4();
    await seedTenant(db, tenant, 'pro');
    const periodStart = '2026-04-01T00:00:00.000Z';
    const periodEnd = '2026-05-01T00:00:00.000Z';

    await tenantTable(db, tenant, 'workflow_step_usage_periods').insert({
      tenant,
      period_start: periodStart,
      period_end: periodEnd,
      period_source: 'fallback_calendar',
      stripe_subscription_id: null,
      effective_limit: 750,
      used_count: 5,
      limit_source: 'tier_default',
      tier: 'pro',
    });

    const workflowId = uuidv4();
    await tenantTable(db, tenant, 'workflow_definitions').insert({
      workflow_id: workflowId,
      tenant,
      name: 'Quota Drift Workflow',
      payload_schema_ref: 'schema://none',
      draft_definition: {},
      draft_version: 1,
      status: 'published',
    });

    const runId = uuidv4();
    await tenantTable(db, tenant, 'workflow_runs').insert({
      run_id: runId,
      tenant,
      workflow_id: workflowId,
      workflow_version: 1,
      status: 'RUNNING',
      node_path: '0',
      started_at: '2026-04-10T00:00:00.000Z',
      input_json: {},
    });

    // The step ledger is tenant-scoped (runtime writes tenant on every step
    // row); the reconcile query joins on it, so the fixture must set it too.
    await tenantTable(db, tenant, 'workflow_run_steps').insert([
      { step_id: uuidv4(), tenant, run_id: runId, step_path: '0', definition_step_id: 'a', status: 'SUCCEEDED', attempt: 1, started_at: '2026-04-10T00:00:00.000Z' },
      { step_id: uuidv4(), tenant, run_id: runId, step_path: '1', definition_step_id: 'b', status: 'SUCCEEDED', attempt: 1, started_at: '2026-04-10T00:00:01.000Z' },
      { step_id: uuidv4(), tenant, run_id: runId, step_path: '2', definition_step_id: 'c', status: 'SUCCEEDED', attempt: 1, started_at: '2026-04-10T00:00:02.000Z' },
    ]);

    const reconciliation = await workflowStepQuotaService.reconcileUsagePeriod(db, tenant, periodStart, periodEnd);
    expect(reconciliation.counterUsedCount).toBe(5);
    expect(reconciliation.ledgerStepCount).toBe(3);
    expect(reconciliation.drift).toBe(2);
  });

  it('emits structured observability logs for fallback, invalid metadata fallback, reservation, and quota exhaustion', async () => {
    const tenant = uuidv4();
    await seedTenant(db, tenant, 'solo');
    await seedStripePeriod(db, tenant, {
      status: 'active',
      start: '2026-04-01T00:00:00.000Z',
      end: '2026-05-01T00:00:00.000Z',
      workflowStepLimitPrice: 'invalid',
      workflowStepLimitProduct: '1',
    });

    const infoSpy = vi.spyOn(logger, 'info');
    const warnSpy = vi.spyOn(logger, 'warn');
    const debugSpy = vi.spyOn(logger, 'debug');

    const now = new Date('2026-04-20T00:00:00.000Z');
    await workflowStepQuotaService.resolveQuotaSummary(db, tenant, now);
    await workflowStepQuotaService.reserveStepStart(db, tenant, now);
    await workflowStepQuotaService.reserveStepStart(db, tenant, now);

    const fallbackTenant = uuidv4();
    await seedTenant(db, fallbackTenant, 'pro');
    await workflowStepQuotaService.resolveQuotaSummary(db, fallbackTenant, new Date('2026-04-20T00:00:00.000Z'));

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid workflow_step_limit metadata on Stripe price'),
      expect.objectContaining({ tenant })
    );
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('Reserved workflow step quota'),
      expect.objectContaining({ tenant })
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Workflow step quota exceeded at reservation'),
      expect.objectContaining({ tenant })
    );
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('Using fallback calendar period'),
      expect.objectContaining({ tenant: fallbackTenant })
    );

    infoSpy.mockRestore();
    warnSpy.mockRestore();
    debugSpy.mockRestore();
  });
});
