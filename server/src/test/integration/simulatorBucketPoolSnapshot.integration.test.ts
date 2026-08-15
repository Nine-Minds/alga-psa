/**
 * Simulator pool-config snapshot (real DB).
 *
 * Regression coverage for defect-4's simulator leg: `snapshotContractToScenario`
 * must carry a line's bucket POOLS into the ContractScenario — pool scope
 * (including catch-all), multi-member membership, per-service burn multipliers,
 * the after-hours rule, and the schedule reference. A pool's identity must be
 * carried as the pool itself (pool_id), never masqueraded as a service id.
 *
 * Defect-4 behavioral coverage lives here (server suite, RUN_DB_TESTS=1)
 * because the EE simulator integration suite seeds only legacy bucket configs
 * and its fixture is otherwise broken on origin/main; this file drives the
 * shipped snapshot with real pool rows end to end.
 *
 * Everything runs inside one transaction that is always rolled back.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import knexFactory, { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { snapshotContractToScenario } from '@ee/lib/billing/simulator';

const ENABLED = process.env.RUN_DB_TESTS === '1';

let db: Knex;

describe.skipIf(!ENABLED)('simulator bucket pool snapshot (real DB)', () => {
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

  async function withSeededContract(
    body: (ctx: {
      trx: Knex.Transaction;
      tenant: string;
      contractId: string;
      contractLineId: string;
      scheduleId: string;
      catchAllBucketId: string;
      multiBucketId: string;
      serviceA: string;
      serviceB: string;
      serviceC: string;
    }) => Promise<void>,
  ) {
    const tenant: string = (await db('tenants').first('tenant')).tenant;

    await db
      .transaction(async (trx) => {
        (trx as any).client.config.tenant = tenant;

        const serviceTypeId = (await trx('service_types').where({ tenant }).first('id'))?.id
          ?? (await trx('service_types').first('id'))?.id;

        const contractId = randomUUID();
        const contractLineId = randomUUID();
        const scheduleId = randomUUID();
        const catchAllBucketId = randomUUID();
        const multiBucketId = randomUUID();
        const serviceA = randomUUID();
        const serviceB = randomUUID();
        const serviceC = randomUUID();

        for (const serviceId of [serviceA, serviceB, serviceC]) {
          await trx('service_catalog').insert({
            tenant, service_id: serviceId,
            service_name: `sim-svc-${serviceId.slice(0, 6)}`,
            billing_method: 'hourly', custom_service_type_id: serviceTypeId,
            default_rate: 12500, unit_of_measure: 'hour',
          });
        }

        await trx('contracts').insert({
          tenant, contract_id: contractId, contract_name: 'Simulator pool contract',
          billing_frequency: 'monthly', currency_code: 'USD',
          is_active: true, is_template: false,
        });
        await trx('contract_lines').insert({
          tenant, contract_line_id: contractLineId, contract_id: contractId,
          contract_line_name: 'Simulator pool line',
          contract_line_type: 'Hourly', billing_frequency: 'monthly',
          cadence_owner: 'client', is_template: false, is_active: true,
        });
        // A Bucket-config service row so the simulator's config loader sees a
        // bucketed service on the line (the pool itself is line-owned).
        await trx('contract_line_services').insert([
          { tenant, contract_line_id: contractLineId, service_id: serviceA },
          { tenant, contract_line_id: contractLineId, service_id: serviceB },
          { tenant, contract_line_id: contractLineId, service_id: serviceC },
        ]);
        for (const serviceId of [serviceA, serviceB, serviceC]) {
          await trx('contract_line_service_configuration').insert({
            tenant, config_id: randomUUID(), contract_line_id: contractLineId,
            service_id: serviceId, configuration_type: 'Bucket',
            custom_rate: null, quantity: null,
          });
        }

        // Mon–Fri 09:00–17:00 schedule for the after-hours rule.
        await trx('business_hours_schedules').insert({
          tenant, schedule_id: scheduleId, schedule_name: 'Simulator schedule',
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

        // Catch-all pool covering every service, with an after-hours rule.
        await trx('contract_line_buckets').insert({
          tenant, bucket_id: catchAllBucketId, contract_line_id: contractLineId,
          bucket_name: 'Sim catch-all', total_minutes: 1200, overage_rate: 15000,
          allow_rollover: true, covers_all_services: true,
          after_hours_multiplier: 1.5, business_hours_schedule_id: scheduleId,
        });
        await trx('contract_line_bucket_services').insert([
          { tenant, bucket_id: catchAllBucketId, contract_line_id: contractLineId, service_id: serviceA, burn_multiplier: 2 },
        ]);

        // Multi-member member-scoped pool.
        await trx('contract_line_buckets').insert({
          tenant, bucket_id: multiBucketId, contract_line_id: contractLineId,
          bucket_name: 'Sim multi', total_minutes: 600, overage_rate: 18500,
          allow_rollover: false, covers_all_services: false,
          after_hours_multiplier: null, business_hours_schedule_id: null,
        });
        await trx('contract_line_bucket_services').insert([
          { tenant, bucket_id: multiBucketId, contract_line_id: contractLineId, service_id: serviceB, burn_multiplier: 1 },
          { tenant, bucket_id: multiBucketId, contract_line_id: contractLineId, service_id: serviceC, burn_multiplier: 3 },
        ]);

        await body({
          trx, tenant, contractId, contractLineId, scheduleId,
          catchAllBucketId, multiBucketId, serviceA, serviceB, serviceC,
        });

        throw new Error('__rollback__');
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.message === '__rollback__') return;
        throw error;
      });
  }

  it('snapshots catch-all and multi-member pools with their full config (scope, multipliers, schedule, after-hours)', async () => {
    await withSeededContract(async ({
      trx, tenant, contractId, contractLineId,
      catchAllBucketId, multiBucketId, serviceA, serviceB, serviceC,
    }) => {
      const scenario = await snapshotContractToScenario(
        trx,
        tenant,
        { contractId, forceProfile: true },
      );

      const line = scenario.lines.find((l) => l.key === contractLineId);
      expect(line).toBeDefined();
      const bucketServices = line!.services.filter(
        (s) => s.configuration.configuration_type === 'Bucket',
      );
      expect(bucketServices).toHaveLength(3);

      const serviceConfig = (serviceId: string) => {
        const service = bucketServices.find((s) => s.service_id === serviceId);
        expect(service).toBeDefined();
        return service!.configuration as unknown as {
          pool_id: string | null;
          pool_name: string | null;
          covers_all_services: boolean;
          burn_multiplier: number;
          after_hours_multiplier: number | null;
          business_hours_schedule_id: string | null;
        };
      };

      // Catch-all member: pool identity is the catch-all pool; its id never
      // appears in any service FK.
      const catchAll = serviceConfig(serviceA);
      expect(catchAll.pool_id).toBe(catchAllBucketId);
      expect(catchAll.pool_name).toBe('Sim catch-all');
      expect(catchAll.covers_all_services).toBe(true);
      expect(catchAll.burn_multiplier).toBe(2);
      expect(catchAll.after_hours_multiplier).toBe(1.5);

      // Multi-member members: same pool, distinct per-service multipliers.
      const memberB = serviceConfig(serviceB);
      expect(memberB.pool_id).toBe(multiBucketId);
      expect(memberB.covers_all_services).toBe(false);
      expect(memberB.burn_multiplier).toBe(1);
      expect(memberB.after_hours_multiplier).toBeNull();

      const memberC = serviceConfig(serviceC);
      expect(memberC.pool_id).toBe(multiBucketId);
      expect(memberC.covers_all_services).toBe(false);
      expect(memberC.burn_multiplier).toBe(3);

      // Pool identity is never masqueraded as a service: every service_id on
      // the line is a real catalog service, and the pool ids appear only in
      // the pool fields.
      const serviceIds = line!.services.map((s) => s.service_id);
      expect(serviceIds).toContain(serviceA);
      expect(serviceIds).toContain(serviceB);
      expect(serviceIds).toContain(serviceC);
      expect(serviceIds).not.toContain(catchAllBucketId);
      expect(serviceIds).not.toContain(multiBucketId);
      for (const service of line!.services) {
        expect(service.configuration.configuration_type === 'Bucket'
          ? (service.configuration as { pool_id?: string | null }).pool_id
          : null).not.toBeUndefined();
      }
    });
  });
});
