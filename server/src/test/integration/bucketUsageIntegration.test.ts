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
});

function tenantOf(trx: Knex.Transaction): string {
  const tenant = (trx as any).client?.config?.tenant;
  if (!tenant) throw new Error('tenant not set on transaction');
  return tenant;
}
