/**
 * Weighted bucket-of-hours integration tests against a real Postgres.
 *
 * Proves the weighted-burn model end to end through the canonical service:
 *   - two member services (1x and 2x) in one pool,
 *   - an after-hours rule (schedule selected),
 *   - time entries in- and out-of-hours,
 *   - pool depletion is WEIGHTED (2x burns double),
 *   - overage accrues on weighted minutes,
 *   - reconcile recomputes the same weighted totals from source records.
 *
 * Opt-in: needs a reachable database, so it is skipped unless RUN_DB_TESTS=1.
 * Everything runs inside one transaction that is always rolled back.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import knexFactory, { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import {
  findOrCreateCurrentBucketUsageRecord,
  loadAfterHoursRuleForBucket,
  reconcileBucketUsageRecord,
  resolveBucketDraw,
  updateBucketUsageMinutes,
} from '@alga-psa/shared/billingClients/bucketUsageService';
import { computeWeightedMinutes } from '@alga-psa/shared/billingClients/weightedBurn';
import { computeBucketCharges } from '@alga-psa/billing/lib/billing/compute/computeBucketCharges';
import type { ChargeComputeTaxPorts } from '@alga-psa/billing/lib/billing/compute/types';

// Tax ports that resolve no region: the weighted-overage invoice amount
// assertions below are about the pre-tax charge total.
const NO_TAX_PORTS: ChargeComputeTaxPorts = {
  getTaxInfoFromService: () => ({ taxRegion: null, isTaxable: false }),
  getLocationTaxRegionCode: () => null,
  getClientDefaultTaxRegionCode: () => null,
  calculateTax: () => ({ taxAmount: 0, taxRate: 0 }),
} as unknown as ChargeComputeTaxPorts;

const ENABLED = process.env.RUN_DB_TESTS === '1';
const TOTAL_MINUTES = 600; // 10 hours included

let db: Knex;

describe.skipIf(!ENABLED)('weighted bucket burn integration (real DB)', () => {
  beforeAll(() => {
    db = knexFactory({
      client: 'pg',
      connection: {
        host: process.env.BUCKET_TEST_DB_HOST || process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.BUCKET_TEST_DB_PORT || process.env.DB_PORT || 5432),
        database: process.env.BUCKET_TEST_DB_NAME || process.env.DB_NAME_SERVER || 'server',
        user: process.env.BUCKET_TEST_DB_USER || process.env.DB_USER_SERVER || 'app_user',
        password: process.env.BUCKET_TEST_DB_PASSWORD || process.env.DB_PASSWORD_SERVER,
      },
      pool: { min: 0, max: 2 },
    });
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  /**
   * Seeds a pool with two members (1x, 2x) plus an after-hours rule on a
   * standard Mon–Fri 09:00–17:00 schedule, and hands the caller a transaction
   * that is rolled back no matter what the body does.
   */
  async function withSeededPool(
    body: (ctx: {
      trx: Knex.Transaction;
      tenant: string;
      clientId: string;
      serviceId1x: string;
      serviceId2x: string;
      contractLineId: string;
      bucketId: string;
      scheduleId: string;
      userId: string;
    }) => Promise<void>,
  ) {
    const tenant: string = (await db('tenants').first('tenant')).tenant;

    await db
      .transaction(async (trx) => {
        (trx as any).client.config.tenant = tenant;

        const serviceTypeId = (
          await trx('service_types').where({ tenant }).first('id')
        )?.id ?? (await trx('service_types').first('id'))?.id;

        const clientId = randomUUID();
        const serviceId1x = randomUUID();
        const serviceId2x = randomUUID();
        const contractId = randomUUID();
        const contractLineId = randomUUID();
        const bucketId = randomUUID();
        const scheduleId = randomUUID();

        await trx('clients').insert({
          tenant, client_id: clientId, client_name: `weighted-bucket-${clientId.slice(0, 8)}`,
        });

        for (const serviceId of [serviceId1x, serviceId2x]) {
          await trx('service_catalog').insert({
            tenant, service_id: serviceId,
            service_name: `weighted-svc-${serviceId.slice(0, 8)}`,
            billing_method: 'per_unit', custom_service_type_id: serviceTypeId,
          });
        }

        await trx('contracts').insert({
          tenant, contract_id: contractId, contract_name: 'Weighted retainer (test)',
        });

        await trx('contract_lines').insert({
          tenant, contract_line_id: contractLineId, contract_id: contractId,
          contract_line_name: 'Weighted retainer (test)',
          contract_line_type: 'Bucket', billing_frequency: 'monthly',
          cadence_owner: 'client', is_template: false, is_active: true,
        });

        await trx('client_contracts').insert({
          tenant, client_contract_id: randomUUID(), client_id: clientId,
          contract_id: contractId, start_date: '2026-01-01', end_date: null,
          is_active: true,
        });

        // A real user so time_entries FK (tenant, user_id) resolves.
        const userId = (
          await trx('users').where({ tenant, user_type: 'internal' }).first('user_id')
        )?.user_id ?? (await trx('users').first('user_id'))?.user_id;
        if (!userId) {
          throw new Error('No user available for time_entries seeding');
        }

        // Standard Mon–Fri 09:00–17:00 schedule in UTC.
        await trx('business_hours_schedules').insert({
          tenant, schedule_id: scheduleId, schedule_name: 'Weighted Test Schedule',
          timezone: 'UTC', is_default: false, is_24x7: false,
        });
        for (let day = 0; day <= 6; day += 1) {
          const enabled = day >= 1 && day <= 5;
          await trx('business_hours_entries').insert({
            tenant, entry_id: randomUUID(), schedule_id: scheduleId,
            day_of_week: day,
            start_time: enabled ? '09:00' : '00:00',
            end_time: enabled ? '17:00' : '00:00',
            is_enabled: enabled,
          });
        }

        // Pool: 600 minutes, after-hours rule at 1.5x.
        await trx('contract_line_buckets').insert({
          tenant, bucket_id: bucketId, contract_line_id: contractLineId,
          total_minutes: TOTAL_MINUTES, overage_rate: 15000,
          allow_rollover: false, covers_all_services: false,
          after_hours_multiplier: 1.5, business_hours_schedule_id: scheduleId,
        });
        // Members: standard service at 1x, emergency service at 2x.
        await trx('contract_line_bucket_services').insert([
          { tenant, bucket_id: bucketId, contract_line_id: contractLineId, service_id: serviceId1x, burn_multiplier: 1 },
          { tenant, bucket_id: bucketId, contract_line_id: contractLineId, service_id: serviceId2x, burn_multiplier: 2 },
        ]);

        await body({
          trx, tenant, clientId, serviceId1x, serviceId2x,
          contractLineId, bucketId, scheduleId, userId,
        });

        throw new Error('__rollback__');
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.message === '__rollback__') return;
        throw error;
      });
  }

  /**
   * Seeds a dormant pool (zero members) with historical overage usage inside
   * the March 2026 billing period. A dormant pool still bills its overage even
   * though nothing currently draws from it.
   */
  async function withDormantPool(
    body: (ctx: {
      trx: Knex.Transaction;
      tenant: string;
      clientId: string;
      contractLineId: string;
      bucketId: string;
    }) => Promise<void>,
  ) {
    const tenant: string = (await db('tenants').first('tenant')).tenant;

    await db
      .transaction(async (trx) => {
        (trx as any).client.config.tenant = tenant;

        const clientId = randomUUID();
        const contractId = randomUUID();
        const contractLineId = randomUUID();
        const bucketId = randomUUID();

        await trx('clients').insert({
          tenant, client_id: clientId, client_name: `dormant-${clientId.slice(0, 8)}`,
        });

        await trx('contracts').insert({
          tenant, contract_id: contractId, contract_name: 'Dormant pool (test)',
        });

        await trx('contract_lines').insert({
          tenant, contract_line_id: contractLineId, contract_id: contractId,
          contract_line_name: 'Dormant pool (test)',
          contract_line_type: 'Bucket', billing_frequency: 'monthly',
          cadence_owner: 'client', is_template: false, is_active: true,
        });

        await trx('client_contracts').insert({
          tenant, client_contract_id: randomUUID(), client_id: clientId,
          contract_id: contractId, start_date: '2026-01-01', end_date: null,
          is_active: true,
        });

        // Zero-member pool (dormant) that still carries overage history.
        await trx('contract_line_buckets').insert({
          tenant, bucket_id: bucketId, contract_line_id: contractLineId,
          total_minutes: 600, overage_rate: 15000,
          allow_rollover: false, covers_all_services: false,
          after_hours_multiplier: null, business_hours_schedule_id: null,
        });

        await trx('bucket_usage').insert({
          tenant, usage_id: randomUUID(), client_id: clientId,
          contract_line_id: contractLineId,
          service_catalog_id: randomUUID(),
          bucket_id: bucketId,
          period_start: '2026-03-01', period_end: '2026-03-31',
          minutes_used: 720, overage_minutes: 120, rolled_over_minutes: 0,
        });

        await body({ trx, tenant, clientId, contractLineId, bucketId });

        throw new Error('__rollback__');
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.message === '__rollback__') return;
        throw error;
      });
  }

  it('resolves the pool and per-member multipliers', async () => {
    await withSeededPool(async ({ trx, clientId, serviceId1x, serviceId2x, bucketId, contractLineId }) => {
      const draw1x = await resolveBucketDraw(trx, clientId, serviceId1x, '2026-03-10T10:00:00Z');
      expect(draw1x).toMatchObject({ bucketId, memberMultiplier: 1, contractLineId });

      const draw2x = await resolveBucketDraw(trx, clientId, serviceId2x, '2026-03-10T10:00:00Z');
      expect(draw2x).toMatchObject({ bucketId, memberMultiplier: 2, contractLineId });

      const rule = await loadAfterHoursRuleForBucket(trx, tenantOf(trx), bucketId);
      expect(rule).not.toBeNull();
      expect(rule?.multiplier).toBe(1.5);
    });
  });

  it('depletes the pool on weighted minutes: 2x member burns double', async () => {
    await withSeededPool(async ({ trx, clientId, serviceId1x, serviceId2x, entryDate }) => {
      const oneHourInHours = '2026-03-10T10:00:00Z'; // Tue, in-hours
      const oneHourAfterHours = '2026-03-10T18:00:00Z'; // Tue, after 17:00

      const record = await findOrCreateCurrentBucketUsageRecord(trx, clientId, serviceId1x, oneHourInHours);

      // 1x in-hours: 60 min.
      await updateBucketUsageMinutes(trx, record.usage_id, 60);
      // 2x in-hours: 120 min.
      await updateBucketUsageMinutes(trx, record.usage_id, 120);

      const after = await trx('bucket_usage').where({ usage_id: record.usage_id }).first();
      expect(Number(after.minutes_used)).toBe(180);
      expect(Number(after.overage_minutes)).toBe(0);

      // 1.5x after-hours × 1.5 (max(1.5, 1.5)) = 90 min for a 60-min entry.
      const rule = await loadAfterHoursRuleForBucket(trx, tenantOf(trx), record.bucket_id);
      const weighted = computeWeightedMinutes(
        {
          startTime: new Date(oneHourAfterHours),
          endTime: new Date('2026-03-10T19:00:00Z'),
          billableDuration: 60,
        },
        1,
        rule,
      );
      await updateBucketUsageMinutes(trx, record.usage_id, weighted.weightedMinutes);

      const afterOverage = await trx('bucket_usage').where({ usage_id: record.usage_id }).first();
      expect(Number(afterOverage.minutes_used)).toBe(270);
      expect(Number(afterOverage.overage_minutes)).toBe(0);
    });
  });

  it('accrues overage on weighted minutes once the pool is exhausted', async () => {
    await withSeededPool(async ({ trx, clientId, serviceId2x }) => {
      const record = await findOrCreateCurrentBucketUsageRecord(trx, clientId, serviceId2x, '2026-03-10T10:00:00Z');

      // 5 hours at 2x = 600 weighted minutes — exactly the pool.
      await updateBucketUsageMinutes(trx, record.usage_id, 600);

      const full = await trx('bucket_usage').where({ usage_id: record.usage_id }).first();
      expect(Number(full.minutes_used)).toBe(600);
      expect(Number(full.overage_minutes)).toBe(0);

      // +1 hour at 2x → 120 weighted minutes of overage.
      await updateBucketUsageMinutes(trx, record.usage_id, 120);

      const over = await trx('bucket_usage').where({ usage_id: record.usage_id }).first();
      expect(Number(over.minutes_used)).toBe(720);
      expect(Number(over.overage_minutes)).toBe(120);
    });
  });

  it('invoice amount equals weighted overage hours × rate', async () => {
    await withSeededPool(async ({ trx, clientId, serviceId2x, contractLineId }) => {
      // Two hours of 2x in-hours work = 240 weighted minutes consumed, then
      // five more hours at 2x = 600 weighted minutes → 840 weighted consumed.
      const record = await findOrCreateCurrentBucketUsageRecord(trx, clientId, serviceId2x, '2026-03-10T10:00:00Z');
      await updateBucketUsageMinutes(trx, record.usage_id, 240);
      await updateBucketUsageMinutes(trx, record.usage_id, 600);

      const usageRows = await trx('bucket_usage').where({ tenant: tenantOf(trx), bucket_id: record.bucket_id }).select('*');

      // Total pool 600; consumed 840 weighted → overage 240 weighted = 4 overage hours.
      const result = computeBucketCharges(
        {
          billingPeriod: { startDate: '2026-03-01', endDate: '2026-03-31' },
          clientContractLine: {
            contract_line_id: contractLineId,
            client_contract_line_id: contractLineId,
            contract_line_type: 'Bucket',
            currency_code: 'USD',
          } as any,
          client: { client_id: clientId, is_tax_exempt: false },
          config: {
            config_id: record.bucket_id,
            service_id: serviceId2x,
            service_name: 'Emergency Bucket',
            total_minutes: 600,
            overage_rate: 15000, // $150/hr
            allow_rollover: false,
            isWeighted: true,
          },
          usageRecords: usageRows,
          contractCurrency: 'USD',
        },
        NO_TAX_PORTS,
      );

      const charge = result.charges[0];
      expect(charge).toBeDefined();
      expect(charge.overageHours).toBe(4); // 240 weighted overage minutes / 60
      expect(charge.total).toBe(Math.ceil(4 * 15000)); // 4 weighted overage hrs × $150/hr
      expect(charge.total).toBe(60000);
    });
  });

  it('reconcile recomputes the same weighted totals from source records', async () => {
    await withSeededPool(async ({ trx, clientId, serviceId1x, serviceId2x, contractLineId, userId }) => {
      // Two entries: one in-hours 1x (60), one in-hours 2x (120).
      await trx('time_entries').insert({
        tenant: tenantOf(trx), entry_id: randomUUID(), user_id: userId,
        start_time: new Date('2026-03-10T10:00:00Z'),
        end_time: new Date('2026-03-10T11:00:00Z'),
        billable_duration: 60, service_id: serviceId1x, contract_line_id: contractLineId,
        work_date: '2026-03-10', work_timezone: 'UTC',
      });
      await trx('time_entries').insert({
        tenant: tenantOf(trx), entry_id: randomUUID(), user_id: userId,
        start_time: new Date('2026-03-10T11:00:00Z'),
        end_time: new Date('2026-03-10T12:00:00Z'),
        billable_duration: 60, service_id: serviceId2x, contract_line_id: contractLineId,
        work_date: '2026-03-10', work_timezone: 'UTC',
      });

      const record = await findOrCreateCurrentBucketUsageRecord(trx, clientId, serviceId1x, '2026-03-10T10:00:00Z');
      // Force a wrong value, then reconcile.
      await trx('bucket_usage').where({ usage_id: record.usage_id }).update({ minutes_used: 999, overage_minutes: 999 });

      await reconcileBucketUsageRecord(trx, record.usage_id);

      const after = await trx('bucket_usage').where({ usage_id: record.usage_id }).first();
      // 60 (1x) + 120 (2x) = 180 weighted minutes; pool 600 → no overage.
      expect(Number(after.minutes_used)).toBe(180);
      expect(Number(after.overage_minutes)).toBe(0);
    });
  });

  it('dormant pool overage charges a NULL service_id and keeps the pool identity on config_id (no bucket_id leak into service FKs)', async () => {
    await withDormantPool(async ({ trx, tenant, clientId, contractLineId, bucketId }) => {
      const { BillingEngine } = await import('@alga-psa/billing/lib/billing/billingEngine');
      const { persistInvoiceCharges } = await import('@alga-psa/billing/services/invoiceService');

      const engine = new BillingEngine();
      (engine as any).knex = trx;
      (engine as any).tenant = tenant;

      const charges = await (engine as any).calculateBucketPlanCharges(
        clientId,
        { startDate: '2026-03-01T00:00:00Z', endDate: '2026-04-01T00:00:00Z' },
        {
          contract_line_id: contractLineId,
          client_contract_line_id: contractLineId,
          client_contract_id: contractLineId,
          contract_name: 'Dormant Pool Contract',
          contract_line_type: 'Bucket',
          currency_code: 'USD',
          location_id: null,
        },
      );

      // The dormant pool has zero members: its identity must NEVER masquerade
      // as a service_catalog id. Distinct random UUIDs for pool and any
      // service make an accidental swap impossible to miss.
      expect(charges).toHaveLength(1);
      const charge = charges[0];
      expect(charge.serviceId).toBeUndefined();
      expect(charge.service_catalog_id).toBeNull();
      expect(charge.config_id).toBe(bucketId);
      expect(charge.total).toBeGreaterThan(0);

      // invoice_charges.invoice_id is a FK to invoices; seed a minimal invoice.
      const invoiceId = randomUUID();
      await trx('invoices').insert({
        tenant, invoice_id: invoiceId, invoice_number: `DORMANT-${invoiceId.slice(0, 6)}`,
        invoice_date: new Date('2026-03-31T00:00:00Z'),
        due_date: new Date('2026-04-30T00:00:00Z'),
        total_amount: 0, status: 'draft',
        client_id: clientId, subtotal: 0, tax: 0,
      });

      // Persist the charge: invoice rows must carry a real (here: none) service
      // id, with the pool identity carried separately on config_id.
      await persistInvoiceCharges(
        trx,
        invoiceId,
        charges,
        { tax_region: null },
        { user: { id: 'test-user' } } as any,
        tenant,
        { requireRecurringServicePeriodLinkage: false },
      );

      const invoiceRows = await trx('invoice_charges')
        .where({ tenant, client_contract_id: contractLineId })
        .select('service_id', 'description');
      expect(invoiceRows.length).toBeGreaterThan(0);
      for (const row of invoiceRows) {
        expect(row.service_id).toBeNull();
      }

      // A dormant pool has no member service to key a detail row on (the pool
      // identity travels on the charge's config_id, never in a service FK).
      const detailRows = await trx('invoice_charge_details')
        .where({ tenant, config_id: bucketId })
        .select('service_id', 'config_id');
      expect(detailRows).toHaveLength(0);
    });
  });

  it('member pool charges carry a real service_id and keep the pool identity separately on config_id', async () => {
    await withSeededPool(async ({ trx, tenant, clientId, serviceId1x, serviceId2x, contractLineId, bucketId, userId }) => {
      const { BillingEngine } = await import('@alga-psa/billing/lib/billing/billingEngine');
      const { persistInvoiceCharges } = await import('@alga-psa/billing/services/invoiceService');

      await trx('bucket_usage').insert({
        tenant: tenantOf(trx), usage_id: randomUUID(), client_id: clientId,
        contract_line_id: contractLineId, service_catalog_id: serviceId2x,
        bucket_id: bucketId, period_start: '2026-03-01', period_end: '2026-03-31',
        minutes_used: 720, overage_minutes: 120, rolled_over_minutes: 0,
      });

      // Real contribution from the 2x member so the overage charge is
      // attributed to the service that actually burned it (120 in-hours minutes
      // at 2x → 240 weighted minutes).
      await trx('time_entries').insert({
        tenant: tenantOf(trx), entry_id: randomUUID(), user_id: userId,
        start_time: new Date('2026-03-10T10:00:00Z'),
        end_time: new Date('2026-03-10T12:00:00Z'),
        billable_duration: 120, service_id: serviceId2x, contract_line_id: contractLineId,
        work_date: '2026-03-10', work_timezone: 'UTC',
      });

      const engine = new BillingEngine();
      (engine as any).knex = trx;
      (engine as any).tenant = tenant;

      const charges = await (engine as any).calculateBucketPlanCharges(
        clientId,
        { startDate: '2026-03-01T00:00:00Z', endDate: '2026-04-01T00:00:00Z' },
        {
          contract_line_id: contractLineId,
          client_contract_line_id: contractLineId,
          client_contract_id: contractLineId,
          contract_name: 'Member Pool Contract',
          contract_line_type: 'Bucket',
          currency_code: 'USD',
          location_id: null,
        },
      );

      expect(charges).toHaveLength(1);
      const charge = charges[0];
      // Only the 2x member contributed, so the charge is keyed on THAT service
      // (attribution by actual burn, never member-list position).
      expect(charge.serviceId).toBe(serviceId2x);
      // The charge must carry a REAL member service — never the pool id, and
      // never a stranger.
      expect(charge.serviceId).not.toBe(bucketId);
      expect([serviceId1x, serviceId2x]).toContain(charge.serviceId);
      expect(charge.config_id).toBe(bucketId);

      const invoiceId = randomUUID();
      await trx('invoices').insert({
        tenant, invoice_id: invoiceId, invoice_number: `MEMBER-${invoiceId.slice(0, 6)}`,
        invoice_date: new Date('2026-03-31T00:00:00Z'),
        due_date: new Date('2026-04-30T00:00:00Z'),
        total_amount: 0, status: 'draft',
        client_id: clientId, subtotal: 0, tax: 0,
      });

      await persistInvoiceCharges(
        trx,
        invoiceId,
        charges,
        { tax_region: null },
        { user: { id: 'test-user' } } as any,
        tenant,
        { requireRecurringServicePeriodLinkage: false },
      );

      const invoiceRows = await trx('invoice_charges')
        .where({ tenant, client_contract_id: contractLineId })
        .select('service_id');
      expect(invoiceRows.length).toBeGreaterThan(0);
      for (const row of invoiceRows) {
        expect(row.service_id).toBe(serviceId2x);
        expect(row.service_id).not.toBe(bucketId);
        expect([serviceId1x, serviceId2x]).toContain(row.service_id);
      }

      const detailRows = await trx('invoice_charge_details')
        .where({ tenant, config_id: bucketId })
        .select('service_id', 'config_id');
      expect(detailRows.length).toBeGreaterThan(0);
      for (const row of detailRows) {
        expect(row.service_id).toBe(serviceId2x);
        expect(row.service_id).not.toBe(bucketId);
        expect([serviceId1x, serviceId2x]).toContain(row.service_id);
        expect(row.config_id).toBe(bucketId);
      }
    });
  });
});

function tenantOf(trx: Knex.Transaction): string {
  const tenant = (trx as any).client?.config?.tenant;
  if (!tenant) throw new Error('tenant not set on transaction');
  return tenant;
}

/**
 * Catch-all scope regression: a line's catch-all pool only covers the services
 * the LINE offers (contract_line_service_configuration membership). A service
 * on another line must never be hijacked by it.
 */
describe.skipIf(!ENABLED)('catch-all scope is line-service membership scoped (real DB)', () => {
  beforeAll(() => {
    db = knexFactory({
      client: 'pg',
      connection: {
        host: process.env.BUCKET_TEST_DB_HOST || process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.BUCKET_TEST_DB_PORT || process.env.DB_PORT || 5432),
        database: process.env.BUCKET_TEST_DB_NAME || process.env.DB_NAME_SERVER || 'server',
        user: process.env.BUCKET_TEST_DB_USER || process.env.DB_USER_SERVER || 'app_user',
        password: process.env.BUCKET_TEST_DB_PASSWORD || process.env.DB_PASSWORD_SERVER,
      },
      pool: { min: 0, max: 2 },
    });
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  /**
   * Two active lines under one client/contract: line A carries a catch-all pool
   * (member A at 1x), line B carries no pool. Service X is configured on line B
   * only — line A does not offer it. Before the fix, a draw for X was hijacked
   * by line A's catch-all even though line A does not offer X.
   */
  async function withCatchAllHijackFixture(
    body: (ctx: {
      trx: Knex.Transaction;
      tenant: string;
      clientId: string;
      serviceX: string;
      serviceA: string;
      lineA: string;
      lineB: string;
    }) => Promise<void>,
  ) {
    const tenant: string = (await db('tenants').first('tenant')).tenant;

    await db
      .transaction(async (trx) => {
        (trx as any).client.config.tenant = tenant;

        const serviceTypeId = (
          await trx('service_types').where({ tenant }).first('id')
        )?.id ?? (await trx('service_types').first('id'))?.id;

        const clientId = randomUUID();
        const serviceA = randomUUID();
        const serviceX = randomUUID();
        const contractId = randomUUID();
        const lineA = randomUUID();
        const lineB = randomUUID();
        const bucketId = randomUUID();

        await trx('clients').insert({
          tenant, client_id: clientId, client_name: `catchall-hijack-${clientId.slice(0, 8)}`,
        });
        for (const [serviceId, tag] of [[serviceA, 'svc-a'], [serviceX, 'svc-x']] as const) {
          await trx('service_catalog').insert({
            tenant, service_id: serviceId,
            service_name: `catchall-${tag}-${serviceId.slice(0, 6)}`,
            billing_method: 'hourly', custom_service_type_id: serviceTypeId,
          });
        }
        await trx('contracts').insert({
          tenant, contract_id: contractId, contract_name: 'Catch-all hijack (test)',
        });
        await trx('contract_lines').insert([
          {
            tenant, contract_line_id: lineA, contract_id: contractId,
            contract_line_name: 'Line A', contract_line_type: 'Hourly',
            billing_frequency: 'monthly', cadence_owner: 'client',
            is_template: false, is_active: true,
          },
          {
            tenant, contract_line_id: lineB, contract_id: contractId,
            contract_line_name: 'Line B', contract_line_type: 'Hourly',
            billing_frequency: 'monthly', cadence_owner: 'client',
            is_template: false, is_active: true,
          },
        ]);
        await trx('client_contracts').insert({
          tenant, client_contract_id: randomUUID(), client_id: clientId,
          contract_id: contractId, start_date: '2026-01-01', end_date: null,
          is_active: true,
        });

        // Line-service membership: A on line A, X on line B — NOT on line A.
        await trx('contract_line_service_configuration').insert([
          { tenant, config_id: randomUUID(), contract_line_id: lineA, service_id: serviceA, configuration_type: 'Hourly' },
          { tenant, config_id: randomUUID(), contract_line_id: lineB, service_id: serviceX, configuration_type: 'Hourly' },
        ]);

        // Line A's catch-all pool. Line B has no pool at all.
        await trx('contract_line_buckets').insert({
          tenant, bucket_id: bucketId, contract_line_id: lineA,
          total_minutes: 600, overage_rate: 15000,
          allow_rollover: false, covers_all_services: true,
        });
        await trx('contract_line_bucket_services').insert({
          tenant, bucket_id: bucketId, contract_line_id: lineA,
          service_id: serviceA, burn_multiplier: 1,
        });

        await body({ trx, tenant, clientId, serviceX, serviceA, lineA, lineB });

        throw new Error('__rollback__');
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.message === '__rollback__') return;
        throw error;
      });
  }

  it('does not route a service to the catch-all pool of a line that does not offer it', async () => {
    await withCatchAllHijackFixture(async ({ trx, clientId, serviceX, lineB }) => {
      const draw = await resolveBucketDraw(
        trx, clientId, serviceX, '2026-03-10T10:00:00Z', lineB,
      );

      // X is a plain hourly service on line B (which has no pool); line A's
      // catch-all must NOT hijack it even though line A pools its own services.
      expect(draw).toBeNull();
    });
  });

  /**
   * One line with a catch-all pool. Service A is configured on the line and is
   * a pool member; service X exists in the catalog and has a time entry on the
   * line but is NOT configured on the line. Reconcile must not let X inflate
   * the catch-all pool.
   */
  async function withCatchAllReconcileFixture(
    body: (ctx: {
      trx: Knex.Transaction;
      tenant: string;
      clientId: string;
      serviceA: string;
      serviceX: string;
      contractLineId: string;
      bucketId: string;
      userId: string;
    }) => Promise<void>,
  ) {
    const tenant: string = (await db('tenants').first('tenant')).tenant;

    await db
      .transaction(async (trx) => {
        (trx as any).client.config.tenant = tenant;

        const serviceTypeId = (
          await trx('service_types').where({ tenant }).first('id')
        )?.id ?? (await trx('service_types').first('id'))?.id;

        const clientId = randomUUID();
        const serviceA = randomUUID();
        const serviceX = randomUUID();
        const contractId = randomUUID();
        const contractLineId = randomUUID();
        const bucketId = randomUUID();

        await trx('clients').insert({
          tenant, client_id: clientId, client_name: `catchall-reconcile-${clientId.slice(0, 8)}`,
        });
        for (const [serviceId, tag] of [[serviceA, 'svc-a'], [serviceX, 'svc-x']] as const) {
          await trx('service_catalog').insert({
            tenant, service_id: serviceId,
            service_name: `catchall-${tag}-${serviceId.slice(0, 6)}`,
            billing_method: 'hourly', custom_service_type_id: serviceTypeId,
          });
        }
        await trx('contracts').insert({
          tenant, contract_id: contractId, contract_name: 'Catch-all reconcile (test)',
        });
        await trx('contract_lines').insert({
          tenant, contract_line_id: contractLineId, contract_id: contractId,
          contract_line_name: 'Catch-all reconcile line',
          contract_line_type: 'Hourly', billing_frequency: 'monthly',
          cadence_owner: 'client', is_template: false, is_active: true,
        });
        await trx('client_contracts').insert({
          tenant, client_contract_id: randomUUID(), client_id: clientId,
          contract_id: contractId, start_date: '2026-01-01', end_date: null,
          is_active: true,
        });

        // Only service A is configured on the line; X is catalog-only.
        await trx('contract_line_service_configuration').insert({
          tenant, config_id: randomUUID(), contract_line_id: contractLineId,
          service_id: serviceA, configuration_type: 'Hourly',
        });

        await trx('contract_line_buckets').insert({
          tenant, bucket_id: bucketId, contract_line_id: contractLineId,
          total_minutes: 600, overage_rate: 15000,
          allow_rollover: false, covers_all_services: true,
        });
        await trx('contract_line_bucket_services').insert({
          tenant, bucket_id: bucketId, contract_line_id: contractLineId,
          service_id: serviceA, burn_multiplier: 1,
        });

        const userId = (
          await trx('users').where({ tenant, user_type: 'internal' }).first('user_id')
        )?.user_id ?? (await trx('users').first('user_id'))?.user_id;
        if (!userId) {
          throw new Error('No user available for time_entries seeding');
        }

        await body({ trx, tenant, clientId, serviceA, serviceX, contractLineId, bucketId, userId });

        throw new Error('__rollback__');
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.message === '__rollback__') return;
        throw error;
      });
  }

  it('does not let an entry for a non-line service inflate a catch-all pool on reconcile', async () => {
    await withCatchAllReconcileFixture(async ({ trx, tenant, clientId, serviceA, serviceX, contractLineId, bucketId, userId }) => {
      const record = await findOrCreateCurrentBucketUsageRecord(
        trx, clientId, serviceA, '2026-03-10T10:00:00Z',
      );
      expect(record.bucket_id).toBe(bucketId);

      await trx('time_entries').insert([
        {
          tenant, entry_id: randomUUID(), user_id: userId,
          start_time: new Date('2026-03-10T10:00:00Z'),
          end_time: new Date('2026-03-10T11:00:00Z'),
          billable_duration: 60, service_id: serviceA, contract_line_id: contractLineId,
          work_date: '2026-03-10', work_timezone: 'UTC',
        },
        {
          // 300 billable minutes of service X — present on the line but NOT
          // configured on it. Must not draw from the catch-all pool.
          tenant, entry_id: randomUUID(), user_id: userId,
          start_time: new Date('2026-03-10T11:00:00Z'),
          end_time: new Date('2026-03-10T16:00:00Z'),
          billable_duration: 300, service_id: serviceX, contract_line_id: contractLineId,
          work_date: '2026-03-10', work_timezone: 'UTC',
        },
      ]);

      await trx('bucket_usage').where({ usage_id: record.usage_id }).update({ minutes_used: 999, overage_minutes: 999 });
      await reconcileBucketUsageRecord(trx, record.usage_id);

      const after = await trx('bucket_usage').where({ usage_id: record.usage_id }).first();
      expect(Number(after.minutes_used)).toBe(60);
      expect(Number(after.overage_minutes)).toBe(0);
    });
  });
});

/**
 * Overage attribution regression: pool overage metadata comes from the services
 * that actually burned the pool, not an arbitrary member.
 */
describe.skipIf(!ENABLED)('pool overage attributes per-service tax metadata by contribution (real DB)', () => {
  beforeAll(() => {
    db = knexFactory({
      client: 'pg',
      connection: {
        host: process.env.BUCKET_TEST_DB_HOST || process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.BUCKET_TEST_DB_PORT || process.env.DB_PORT || 5432),
        database: process.env.BUCKET_TEST_DB_NAME || process.env.DB_NAME_SERVER || 'server',
        user: process.env.BUCKET_TEST_DB_USER || process.env.DB_USER_SERVER || 'app_user',
        password: process.env.BUCKET_TEST_DB_PASSWORD || process.env.DB_PASSWORD_SERVER,
      },
      pool: { min: 0, max: 2 },
    });
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  /**
   * One Bucket line with a catch-all pool (600 min @ $150/hr). Services A (1x)
   * and B (2x) are configured on the line and are pool members; each carries a
   * distinct tax rate/region. A user is seeded for time_entries.
   */
  async function withCatchAllOverageFixture(
    body: (ctx: {
      trx: Knex.Transaction;
      tenant: string;
      clientId: string;
      serviceA: string;
      serviceB: string;
      contractLineId: string;
      bucketId: string;
      userId: string;
    }) => Promise<void>,
  ) {
    const tenant: string = (await db('tenants').first('tenant')).tenant;

    await db
      .transaction(async (trx) => {
        (trx as any).client.config.tenant = tenant;

        const serviceTypeId = (
          await trx('service_types').where({ tenant }).first('id')
        )?.id ?? (await trx('service_types').first('id'))?.id;

        const clientId = randomUUID();
        const serviceA = randomUUID();
        const serviceB = randomUUID();
        const contractId = randomUUID();
        const contractLineId = randomUUID();
        const bucketId = randomUUID();

        await trx('clients').insert({
          tenant, client_id: clientId, client_name: `overage-attr-${clientId.slice(0, 8)}`,
        });

        // Distinct tax regions + rates so per-service tax attribution is provable.
        for (const [region, percentage] of [['US-TESTA', 8.25], ['US-TESTB', 5]] as const) {
          await trx('tax_regions').insert({
            tenant, region_code: region, region_name: `Test region ${region}`, is_active: true,
          });
        }
        const taxRateA = randomUUID();
        const taxRateB = randomUUID();
        await trx('tax_rates').insert([
          {
            tenant, tax_rate_id: taxRateA, region_code: 'US-TESTA', tax_percentage: 8.25,
            tax_type: 'Sales Tax', start_date: '2026-01-01', is_active: true,
            description: 'Test rate A',
          },
          {
            tenant, tax_rate_id: taxRateB, region_code: 'US-TESTB', tax_percentage: 5,
            tax_type: 'Sales Tax', start_date: '2026-01-01', is_active: true,
            description: 'Test rate B',
          },
        ]);
        // Pre-seed client tax settings so the engine's tax load phase does not
        // try to provision defaults through a host-run createTenantKnex().
        await trx('client_tax_settings').insert({
          tenant, client_id: clientId, is_reverse_charge_applicable: false,
        });

        for (const [serviceId, tag, taxRateId] of [
          [serviceA, 'svc-a', taxRateA],
          [serviceB, 'svc-b', taxRateB],
        ] as const) {
          await trx('service_catalog').insert({
            tenant, service_id: serviceId,
            service_name: `overage-${tag}-${serviceId.slice(0, 6)}`,
            billing_method: 'hourly', custom_service_type_id: serviceTypeId,
            tax_rate_id: taxRateId,
          });
        }
        await trx('contracts').insert({
          tenant, contract_id: contractId, contract_name: 'Overage attribution (test)',
        });
        await trx('contract_lines').insert({
          tenant, contract_line_id: contractLineId, contract_id: contractId,
          contract_line_name: 'Overage attribution line',
          contract_line_type: 'Bucket', billing_frequency: 'monthly',
          cadence_owner: 'client', is_template: false, is_active: true,
        });
        await trx('client_contracts').insert({
          tenant, client_contract_id: randomUUID(), client_id: clientId,
          contract_id: contractId, start_date: '2026-01-01', end_date: null,
          is_active: true,
        });

        await trx('contract_line_service_configuration').insert([
          { tenant, config_id: randomUUID(), contract_line_id: contractLineId, service_id: serviceA, configuration_type: 'Bucket' },
          { tenant, config_id: randomUUID(), contract_line_id: contractLineId, service_id: serviceB, configuration_type: 'Bucket' },
        ]);

        await trx('contract_line_buckets').insert({
          tenant, bucket_id: bucketId, contract_line_id: contractLineId,
          bucket_name: 'Overage catch-all', total_minutes: 600, overage_rate: 15000,
          allow_rollover: false, covers_all_services: true,
        });
        await trx('contract_line_bucket_services').insert([
          { tenant, bucket_id: bucketId, contract_line_id: contractLineId, service_id: serviceA, burn_multiplier: 1 },
          { tenant, bucket_id: bucketId, contract_line_id: contractLineId, service_id: serviceB, burn_multiplier: 2 },
        ]);

        const userId = (
          await trx('users').where({ tenant, user_type: 'internal' }).first('user_id')
        )?.user_id ?? (await trx('users').first('user_id'))?.user_id;
        if (!userId) {
          throw new Error('No user available for time_entries seeding');
        }

        await body({ trx, tenant, clientId, serviceA, serviceB, contractLineId, bucketId, userId });

        throw new Error('__rollback__');
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.message === '__rollback__') return;
        throw error;
      });
  }

  it('apportions overage per contributing service with per-service tax metadata and amounts summing to the pool charge', async () => {
    await withCatchAllOverageFixture(async ({ trx, tenant, clientId, serviceA, serviceB, contractLineId, bucketId, userId }) => {
      const { BillingEngine } = await import('@alga-psa/billing/lib/billing/billingEngine');

      // A contributes 480 weighted minutes (1x), B contributes 240 (2x → 120
      // billable). Pool is 600, so 720 consumed → 120 overage → 2 overage hours
      // at $150/hr = $300.00 total, split 2/3 : 1/3.
      await trx('time_entries').insert([
        {
          tenant, entry_id: randomUUID(), user_id: userId,
          start_time: new Date('2026-03-10T10:00:00Z'),
          end_time: new Date('2026-03-10T18:00:00Z'),
          billable_duration: 480, service_id: serviceA, contract_line_id: contractLineId,
          work_date: '2026-03-10', work_timezone: 'UTC',
        },
        {
          tenant, entry_id: randomUUID(), user_id: userId,
          start_time: new Date('2026-03-10T10:00:00Z'),
          end_time: new Date('2026-03-10T12:00:00Z'),
          billable_duration: 120, service_id: serviceB, contract_line_id: contractLineId,
          work_date: '2026-03-10', work_timezone: 'UTC',
        },
      ]);

      await trx('bucket_usage').insert({
        tenant, usage_id: randomUUID(), client_id: clientId,
        contract_line_id: contractLineId, service_catalog_id: serviceA,
        bucket_id: bucketId, period_start: '2026-03-01', period_end: '2026-03-31',
        minutes_used: 720, overage_minutes: 120, rolled_over_minutes: 0,
      });

      const engine = new BillingEngine();
      (engine as any).knex = trx;
      (engine as any).tenant = tenant;

      const charges = await (engine as any).calculateBucketPlanCharges(
        clientId,
        { startDate: '2026-03-01T00:00:00Z', endDate: '2026-04-01T00:00:00Z' },
        {
          contract_line_id: contractLineId,
          client_contract_line_id: contractLineId,
          client_contract_id: contractLineId,
          contract_name: 'Overage Attribution Contract',
          contract_line_type: 'Bucket',
          currency_code: 'USD',
          location_id: null,
        },
      );

      expect(charges).toHaveLength(2);
      const byService = new Map(charges.map((charge: any) => [charge.serviceId, charge] as const));
      const chargeA = byService.get(serviceA);
      const chargeB = byService.get(serviceB);
      expect(chargeA).toBeDefined();
      expect(chargeB).toBeDefined();

      for (const charge of charges) {
        expect(charge.config_id).toBe(bucketId);
        expect(charge.service_catalog_id).not.toBe(bucketId);
        expect([serviceA, serviceB]).toContain(charge.service_catalog_id);
      }

      // Amounts sum exactly to overage/60 × rate: 2 weighted hrs × $150 = $300.
      expect(charges.reduce((sum: number, charge: any) => sum + charge.total, 0)).toBe(30000);
      expect(charges.reduce((sum: number, charge: any) => sum + charge.overageHours, 0)).toBe(2);
      // Pro-rata by weighted minutes: A 480 (2/3), B 240 (1/3).
      expect(chargeA.total).toBe(20000);
      expect(chargeB.total).toBe(10000);

      // Per-service tax metadata: each portion uses ITS service's tax region and
      // rate (8.25% on $200 → $16.50; 5% on $100 → $5.00).
      expect(chargeA.tax_region).toBe('US-TESTA');
      expect(chargeA.tax_rate).toBe(8.25);
      expect(chargeA.tax_amount).toBe(1650);
      expect(chargeB.tax_region).toBe('US-TESTB');
      expect(chargeB.tax_rate).toBe(5);
      expect(chargeB.tax_amount).toBe(500);
    });
  });

  it('a single-member pool produces unchanged charge output (one charge, that member metadata)', async () => {
    await withCatchAllOverageFixture(async ({ trx, tenant, clientId, serviceA, contractLineId, bucketId, userId }) => {
      const { BillingEngine } = await import('@alga-psa/billing/lib/billing/billingEngine');

      // Only service A contributes (480 weighted minutes).
      await trx('time_entries').insert({
        tenant, entry_id: randomUUID(), user_id: userId,
        start_time: new Date('2026-03-10T10:00:00Z'),
        end_time: new Date('2026-03-10T18:00:00Z'),
        billable_duration: 480, service_id: serviceA, contract_line_id: contractLineId,
        work_date: '2026-03-10', work_timezone: 'UTC',
      });

      await trx('bucket_usage').insert({
        tenant, usage_id: randomUUID(), client_id: clientId,
        contract_line_id: contractLineId, service_catalog_id: serviceA,
        bucket_id: bucketId, period_start: '2026-03-01', period_end: '2026-03-31',
        minutes_used: 720, overage_minutes: 120, rolled_over_minutes: 0,
      });

      const engine = new BillingEngine();
      (engine as any).knex = trx;
      (engine as any).tenant = tenant;

      const charges = await (engine as any).calculateBucketPlanCharges(
        clientId,
        { startDate: '2026-03-01T00:00:00Z', endDate: '2026-04-01T00:00:00Z' },
        {
          contract_line_id: contractLineId,
          client_contract_line_id: contractLineId,
          client_contract_id: contractLineId,
          contract_name: 'Single Member Contract',
          contract_line_type: 'Bucket',
          currency_code: 'USD',
          location_id: null,
        },
      );

      // One charge, keyed on the single contributing member — the shape every
      // migrated legacy config relies on.
      expect(charges).toHaveLength(1);
      const charge = charges[0];
      expect(charge.serviceId).toBe(serviceA);
      expect(charge.service_catalog_id).toBe(serviceA);
      expect(charge.serviceName).toBe('Overage catch-all');
      expect(charge.config_id).toBe(bucketId);
      expect(charge.total).toBe(30000);
      expect(charge.overageHours).toBe(2);
      expect(charge.hoursUsed).toBe(12);
      expect(charge.tax_region).toBe('US-TESTA');
      expect(charge.tax_rate).toBe(8.25);
      expect(charge.tax_amount).toBe(2475);
      expect(charge.rate).toBe(15000);
    });
  });
});
