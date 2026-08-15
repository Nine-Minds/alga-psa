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
    await withSeededPool(async ({ trx, tenant, clientId, serviceId1x, serviceId2x, contractLineId, bucketId }) => {
      const { BillingEngine } = await import('@alga-psa/billing/lib/billing/billingEngine');
      const { persistInvoiceCharges } = await import('@alga-psa/billing/services/invoiceService');

      await trx('bucket_usage').insert({
        tenant: tenantOf(trx), usage_id: randomUUID(), client_id: clientId,
        contract_line_id: contractLineId, service_catalog_id: serviceId2x,
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
          contract_name: 'Member Pool Contract',
          contract_line_type: 'Bucket',
          currency_code: 'USD',
          location_id: null,
        },
      );

      expect(charges).toHaveLength(1);
      const charge = charges[0];
      // The pool has two members and the engine keys the charge on the member
      // ordered by service_id asc (both are freshly random UUIDs, so either may
      // sort first). Deterministically model that documented pick instead of
      // assuming a specific member won.
      const expectedServiceId = [serviceId1x, serviceId2x].sort()[0];
      expect(charge.serviceId).toBe(expectedServiceId);
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
        expect(row.service_id).toBe(expectedServiceId);
        expect(row.service_id).not.toBe(bucketId);
        expect([serviceId1x, serviceId2x]).toContain(row.service_id);
      }

      const detailRows = await trx('invoice_charge_details')
        .where({ tenant, config_id: bucketId })
        .select('service_id', 'config_id');
      expect(detailRows.length).toBeGreaterThan(0);
      for (const row of detailRows) {
        expect(row.service_id).toBe(expectedServiceId);
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
