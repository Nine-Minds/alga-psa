/*
 * Regression coverage for alga0002175, against a real Postgres.
 *
 * The unit suite mocks the transaction, so it proves the resolution logic but
 * cannot prove the SQL: whether `configuration_type` and `created_at` exist on
 * `contract_line_service_configuration`, or whether the ordered, filtered query
 * actually runs. This exercises the shipped
 * `findOrCreateCurrentBucketUsageRecord` against the live schema with the
 * failing shape — an Hourly contract line carrying a Bucket overlay on the same
 * service, i.e. "7 hours included, overage above that".
 *
 * Required integration coverage against the isolated migrated test database.
 * Everything runs inside one transaction that is always rolled back.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { randomUUID } from 'node:crypto';
import {
  findOrCreateCurrentBucketUsageRecord,
  updateBucketUsageMinutes,
} from '@alga-psa/shared/billingClients/bucketUsageService';

const TOTAL_MINUTES = 420; // 7 hours included

let db: Knex;

describe('bucket usage with an Hourly + Bucket overlay (real DB)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  /**
   * Seeds the failing shape and hands the caller a transaction that is rolled
   * back no matter what the body does.
   */
  async function withSeededOverlay(
    body: (ctx: {
      trx: Knex.Transaction;
      tenant: string;
      clientId: string;
      serviceId: string;
      contractLineId: string;
      bucketConfigId: string;
      hourlyConfigId: string;
      entryDate: string;
    }) => Promise<void>,
  ) {
    const tenant: string = (await db('tenants').first('tenant')).tenant;

    await db
      .transaction(async (trx) => {
        // bucketUsageService reads the tenant off the transaction.
        (trx as any).client.config.tenant = tenant;

        const serviceTypeId = (
          await trx('service_types').where({ tenant }).first('id')
        )?.id ?? (await trx('service_types').first('id'))?.id;

        const clientId = randomUUID();
        const serviceId = randomUUID();
        const contractId = randomUUID();
        const contractLineId = randomUUID();
        const bucketConfigId = randomUUID();
        const hourlyConfigId = randomUUID();

        await trx('clients').insert({
          tenant, client_id: clientId, client_name: `bucket-overlay-${clientId.slice(0, 8)}`,
        });

        await trx('service_catalog').insert({
          tenant, service_id: serviceId,
          service_name: `bucket-overlay-svc-${serviceId.slice(0, 8)}`,
          billing_method: 'per_unit', custom_service_type_id: serviceTypeId,
        });

        await trx('contracts').insert({
          tenant, contract_id: contractId, contract_name: 'Retainer with overage (test)',
        });

        await trx('contract_lines').insert({
          tenant, contract_line_id: contractLineId, contract_id: contractId,
          contract_line_name: 'Retainer with overage (test) - Hourly',
          contract_line_type: 'Hourly', billing_frequency: 'monthly',
          cadence_owner: 'client', is_template: false, is_active: true,
        });

        // Assignment starts before the entry date so period resolution succeeds.
        await trx('client_contracts').insert({
          tenant, client_contract_id: randomUUID(), client_id: clientId,
          contract_id: contractId, start_date: '2026-01-01', end_date: null,
          is_active: true,
        });

        // THE SHAPE: two configurations on one (line, service). The Hourly row
        // is written FIRST so an unqualified `.first()` tends to return it --
        // that is precisely the alga0002175 failure.
        await trx('contract_line_service_configuration').insert({
          tenant, config_id: hourlyConfigId, contract_line_id: contractLineId,
          service_id: serviceId, configuration_type: 'Hourly',
          created_at: new Date('2026-01-01T00:00:00Z'),
        });
        await trx('contract_line_service_configuration').insert({
          tenant, config_id: bucketConfigId, contract_line_id: contractLineId,
          service_id: serviceId, configuration_type: 'Bucket',
          created_at: new Date('2026-01-01T00:00:01Z'),
        });

        // Only the Bucket configuration gets a detail row.
        await trx('contract_line_service_bucket_config').insert({
          tenant, config_id: bucketConfigId, total_minutes: TOTAL_MINUTES,
          overage_rate: 18500, allow_rollover: false,
        });

        // Pool-keyed model (weighted-burn): seed the single-member 1x pool the
        // scope-resolution rule resolves.
        await trx('contract_line_buckets').insert({
          tenant, bucket_id: bucketConfigId, contract_line_id: contractLineId,
          total_minutes: TOTAL_MINUTES, overage_rate: 18500,
          allow_rollover: false, covers_all_services: false,
        });
        await trx('contract_line_bucket_services').insert({
          tenant, bucket_id: bucketConfigId, contract_line_id: contractLineId,
          service_id: serviceId, burn_multiplier: 1,
        });

        await body({
          trx, tenant, clientId, serviceId, contractLineId,
          bucketConfigId, hourlyConfigId, entryDate: '2026-03-10T09:00:00Z',
        });

        throw new Error('__rollback__');
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.message === '__rollback__') return;
        throw error;
      });
  }

  it('resolves the Bucket configuration and records usage', async () => {
    await withSeededOverlay(async ({ trx, clientId, serviceId, contractLineId, entryDate }) => {
      const record = await findOrCreateCurrentBucketUsageRecord(
        trx, clientId, serviceId, entryDate,
      );

      expect(record.contract_line_id).toBe(contractLineId);
      expect(record.service_catalog_id).toBe(serviceId);
      expect(Number(record.minutes_used)).toBe(0);

      // 60 billable minutes, well inside the 420-minute bucket.
      await updateBucketUsageMinutes(trx, record.usage_id, 60);

      const after = await trx('bucket_usage').where({ usage_id: record.usage_id }).first();
      expect(Number(after.minutes_used)).toBe(60);
      expect(Number(after.overage_minutes)).toBe(0);
    });
  });

  it('accrues overage once usage passes the included minutes', async () => {
    await withSeededOverlay(async ({ trx, clientId, serviceId, entryDate }) => {
      const record = await findOrCreateCurrentBucketUsageRecord(
        trx, clientId, serviceId, entryDate,
      );

      await updateBucketUsageMinutes(trx, record.usage_id, TOTAL_MINUTES + 30);

      const after = await trx('bucket_usage').where({ usage_id: record.usage_id }).first();
      expect(Number(after.minutes_used)).toBe(TOTAL_MINUTES + 30);
      expect(Number(after.overage_minutes)).toBe(30);
    });
  });

  it('reuses the existing usage record for a second entry in the same period', async () => {
    await withSeededOverlay(async ({ trx, clientId, serviceId, entryDate }) => {
      const first = await findOrCreateCurrentBucketUsageRecord(trx, clientId, serviceId, entryDate);
      await updateBucketUsageMinutes(trx, first.usage_id, 100);

      const second = await findOrCreateCurrentBucketUsageRecord(
        trx, clientId, serviceId, '2026-03-20T09:00:00Z',
      );
      expect(second.usage_id).toBe(first.usage_id);

      await updateBucketUsageMinutes(trx, second.usage_id, 50);
      const after = await trx('bucket_usage').where({ usage_id: first.usage_id }).first();
      expect(Number(after.minutes_used)).toBe(150);
    });
  });
});
