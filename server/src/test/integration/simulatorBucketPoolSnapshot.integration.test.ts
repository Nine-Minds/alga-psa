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

  /**
   * Seeds a contract with a REAL Hourly line and a REAL Usage line — services
   * carry their own Hourly/Usage configs, and the v1.5 pools are separate
   * line-owned rows (catch-all + member-scoped) with after-hours rules and a
   * shared business-hours schedule. Everything runs inside one transaction
   * that is always rolled back.
   */
  async function withRealPoolFixture(
    body: (ctx: {
      trx: Knex.Transaction;
      tenant: string;
      contractId: string;
      scheduleId: string;
      hourlyLineId: string;
      usageLineId: string;
      hourlyServices: Record<string, string>;
      usageServices: Record<string, string>;
      hCatchAllId: string;
      hMemberId: string;
      uMemberId: string;
      uCatchAllId: string;
    }) => Promise<void>,
  ) {
    const tenant: string = (await db('tenants').first('tenant')).tenant;

    await db
      .transaction(async (trx) => {
        (trx as any).client.config.tenant = tenant;

        const serviceTypeId = (await trx('service_types').where({ tenant }).first('id'))?.id
          ?? (await trx('service_types').first('id'))?.id;

        const contractId = randomUUID();
        const scheduleId = randomUUID();
        const hourlyLineId = randomUUID();
        const usageLineId = randomUUID();
        const hCatchAllId = randomUUID();
        const hMemberId = randomUUID();
        const uMemberId = randomUUID();
        const uCatchAllId = randomUUID();

        await trx('contracts').insert({
          tenant, contract_id: contractId, contract_name: 'Sim real-pool contract',
          billing_frequency: 'monthly', currency_code: 'USD',
          is_active: true, is_template: false,
        });
        await trx('contract_lines').insert([
          {
            tenant, contract_line_id: hourlyLineId, contract_id: contractId,
            contract_line_name: 'Sim hourly line', contract_line_type: 'Hourly',
            billing_frequency: 'monthly', cadence_owner: 'client',
            is_template: false, is_active: true,
          },
          {
            tenant, contract_line_id: usageLineId, contract_id: contractId,
            contract_line_name: 'Sim usage line', contract_line_type: 'Usage',
            billing_frequency: 'monthly', cadence_owner: 'client',
            is_template: false, is_active: true,
          },
        ]);

        // Mon–Fri 09:00–17:00 schedule shared by the after-hours rules.
        await trx('business_hours_schedules').insert({
          tenant, schedule_id: scheduleId, schedule_name: 'Sim real-pool schedule',
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

        const seedService = async (serviceId: string, lineId: string, type: 'Hourly' | 'Usage') => {
          await trx('service_catalog').insert({
            tenant, service_id: serviceId,
            service_name: `sim-rp-${serviceId.slice(0, 6)}`,
            billing_method: type === 'Hourly' ? 'hourly' : 'usage',
            custom_service_type_id: serviceTypeId,
            default_rate: 12500, unit_of_measure: type === 'Usage' ? 'GB' : 'hour',
          });
          await trx('contract_line_services').insert({
            tenant, contract_line_id: lineId, service_id: serviceId,
          });
          const configId = randomUUID();
          await trx('contract_line_service_configuration').insert({
            tenant, config_id: configId, contract_line_id: lineId,
            service_id: serviceId, configuration_type: type,
            custom_rate: null, quantity: null,
          });
          if (type === 'Hourly') {
            await trx('contract_line_service_hourly_configs').insert({
              config_id: configId, tenant,
              hourly_rate: 12500, minimum_billable_time: 15, round_up_to_nearest: 15,
              created_at: trx.fn.now(), updated_at: trx.fn.now(),
            });
          } else {
            await trx('contract_line_service_usage_config').insert({
              config_id: configId, tenant,
              unit_of_measure: 'GB', enable_tiered_pricing: false,
              minimum_usage: 0, base_rate: 12500,
              created_at: trx.fn.now(), updated_at: trx.fn.now(),
            });
          }
        };

        const seedPool = async (
          lineId: string,
          bucketId: string,
          data: {
            bucket_name: string;
            total_minutes: number;
            overage_rate: number;
            allow_rollover: boolean;
            covers_all_services: boolean;
            after_hours_multiplier?: number | null;
            business_hours_schedule_id?: string | null;
          },
          members: Array<{ service_id: string; burn_multiplier: number }>,
        ) => {
          await trx('contract_line_buckets').insert({
            tenant, bucket_id: bucketId, contract_line_id: lineId,
            bucket_name: data.bucket_name,
            total_minutes: data.total_minutes, overage_rate: data.overage_rate,
            allow_rollover: data.allow_rollover, covers_all_services: data.covers_all_services,
            after_hours_multiplier: data.after_hours_multiplier ?? null,
            business_hours_schedule_id: data.business_hours_schedule_id ?? null,
          });
          for (const member of members) {
            await trx('contract_line_bucket_services').insert({
              tenant, bucket_id: bucketId, contract_line_id: lineId,
              service_id: member.service_id, burn_multiplier: member.burn_multiplier,
            });
          }
        };

        const hourlyServices: Record<string, string> = {
          h1: randomUUID(), h2: randomUUID(), h3: randomUUID(), h4: randomUUID(),
        };
        const usageServices: Record<string, string> = {
          u1: randomUUID(), u2: randomUUID(), u3: randomUUID(),
        };
        for (const serviceId of Object.values(hourlyServices)) {
          await seedService(serviceId, hourlyLineId, 'Hourly');
        }
        for (const serviceId of Object.values(usageServices)) {
          await seedService(serviceId, usageLineId, 'Usage');
        }

        // Hourly line: catch-all pool (after-hours 1.5x on the shared schedule,
        // member h1 at 2x) + member-scoped pool (h2 at 1x, h3 at 2.5x); h4 is a
        // non-member drawing from the catch-all at 1x.
        await seedPool(
          hourlyLineId, hCatchAllId,
          {
            bucket_name: 'H catch-all', total_minutes: 1200, overage_rate: 15000,
            allow_rollover: true, covers_all_services: true,
            after_hours_multiplier: 1.5, business_hours_schedule_id: scheduleId,
          },
          [{ service_id: hourlyServices.h1, burn_multiplier: 2 }],
        );
        await seedPool(
          hourlyLineId, hMemberId,
          {
            bucket_name: 'H member', total_minutes: 600, overage_rate: 18500,
            allow_rollover: false, covers_all_services: false,
          },
          [
            { service_id: hourlyServices.h2, burn_multiplier: 1 },
            { service_id: hourlyServices.h3, burn_multiplier: 2.5 },
          ],
        );

        // Usage line: member-scoped pool (u1 at 3x) + catch-all pool
        // (after-hours 2.0x, member u2 at 1.5x); u3 is a non-member drawing
        // from the catch-all at 1x.
        await seedPool(
          usageLineId, uMemberId,
          {
            bucket_name: 'U member', total_minutes: 900, overage_rate: 16000,
            allow_rollover: true, covers_all_services: false,
          },
          [{ service_id: usageServices.u1, burn_multiplier: 3 }],
        );
        await seedPool(
          usageLineId, uCatchAllId,
          {
            bucket_name: 'U catch-all', total_minutes: 2400, overage_rate: 20000,
            allow_rollover: false, covers_all_services: true,
            after_hours_multiplier: 2.0, business_hours_schedule_id: scheduleId,
          },
          [{ service_id: usageServices.u2, burn_multiplier: 1.5 }],
        );

        await body({
          trx, tenant, contractId, scheduleId, hourlyLineId, usageLineId,
          hourlyServices, usageServices, hCatchAllId, hMemberId, uMemberId, uCatchAllId,
        });

        throw new Error('__rollback__');
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.message === '__rollback__') return;
        throw error;
      });
  }

  it('round-trips real Hourly and Usage pool configs (scope, members, multipliers, schedule, after-hours)', async () => {
    await withRealPoolFixture(async ({
      trx, tenant, contractId, scheduleId, hourlyLineId, usageLineId,
      hourlyServices, usageServices, hCatchAllId, hMemberId, uMemberId, uCatchAllId,
    }) => {
      const scenario = await snapshotContractToScenario(
        trx,
        tenant,
        { contractId, forceProfile: true },
      );

      const hourlyLine = scenario.lines.find((line) => line.key === hourlyLineId);
      const usageLine = scenario.lines.find((line) => line.key === usageLineId);
      expect(hourlyLine).toBeDefined();
      expect(usageLine).toBeDefined();

      const configOf = (line: { services: Array<{ service_id: string; configuration: unknown }> }, serviceId: string) => {
        const service = line.services.find((s) => s.service_id === serviceId);
        expect(service).toBeDefined();
        return service!.configuration as Record<string, unknown>;
      };

      // Hourly line — catch-all member carries the pool + rule + schedule.
      const h1 = configOf(hourlyLine!, hourlyServices.h1);
      expect(h1.configuration_type).toBe('Hourly');
      expect(h1.hourly_rate).toBe(12500);
      expect(h1.pool_id).toBe(hCatchAllId);
      expect(h1.pool_name).toBe('H catch-all');
      expect(h1.covers_all_services).toBe(true);
      expect(h1.burn_multiplier).toBe(2);
      expect(h1.after_hours_multiplier).toBe(1.5);
      expect(h1.business_hours_schedule_id).toBe(scheduleId);

      // Hourly line — member-scoped pool members keep distinct multipliers.
      const h2 = configOf(hourlyLine!, hourlyServices.h2);
      expect(h2.pool_id).toBe(hMemberId);
      expect(h2.covers_all_services).toBe(false);
      expect(h2.burn_multiplier).toBe(1);
      expect(h2.after_hours_multiplier).toBeNull();
      expect(h2.business_hours_schedule_id).toBeNull();

      const h3 = configOf(hourlyLine!, hourlyServices.h3);
      expect(h3.pool_id).toBe(hMemberId);
      expect(h3.burn_multiplier).toBe(2.5);

      // Hourly line — non-member draws from the catch-all at 1x with the rule.
      const h4 = configOf(hourlyLine!, hourlyServices.h4);
      expect(h4.pool_id).toBe(hCatchAllId);
      expect(h4.covers_all_services).toBe(true);
      expect(h4.burn_multiplier).toBe(1);
      expect(h4.after_hours_multiplier).toBe(1.5);

      // Usage line — member-scoped pool (no rule) + catch-all pool with rule.
      const u1 = configOf(usageLine!, usageServices.u1);
      expect(u1.configuration_type).toBe('Usage');
      expect(u1.unit_of_measure).toBe('GB');
      expect(u1.pool_id).toBe(uMemberId);
      expect(u1.covers_all_services).toBe(false);
      expect(u1.burn_multiplier).toBe(3);
      expect(u1.after_hours_multiplier).toBeNull();

      const u2 = configOf(usageLine!, usageServices.u2);
      expect(u2.pool_id).toBe(uCatchAllId);
      expect(u2.covers_all_services).toBe(true);
      expect(u2.burn_multiplier).toBe(1.5);
      expect(u2.after_hours_multiplier).toBe(2);
      expect(u2.business_hours_schedule_id).toBe(scheduleId);

      const u3 = configOf(usageLine!, usageServices.u3);
      expect(u3.pool_id).toBe(uCatchAllId);
      expect(u3.covers_all_services).toBe(true);
      expect(u3.burn_multiplier).toBe(1);
      expect(u3.after_hours_multiplier).toBe(2);

      // Restore fidelity: reconstruct the line pools from the scenario configs
      // alone (group services by pool_id) and compare every listed field to the
      // seeded rows — the proof that snapshot → restore is lossless.
      const reconstructPools = (line: { services: Array<{ service_id: string; configuration: unknown }> }) => {
        const pools = new Map<
          string,
          {
            pool_name: string | null;
            covers_all_services: boolean;
            after_hours_multiplier: number | null;
            business_hours_schedule_id: string | null;
            members: Array<{ service_id: string; burn_multiplier: number }>;
          }
        >();
        for (const service of line.services) {
          const config = service.configuration as Record<string, unknown>;
          if (!config.pool_id) continue;
          const entry = pools.get(String(config.pool_id)) ?? {
            pool_name: (config.pool_name as string | null) ?? null,
            covers_all_services: Boolean(config.covers_all_services),
            after_hours_multiplier: (config.after_hours_multiplier as number | null) ?? null,
            business_hours_schedule_id: (config.business_hours_schedule_id as string | null) ?? null,
            members: [],
          };
          entry.members.push({
            service_id: service.service_id,
            burn_multiplier: Number(config.burn_multiplier),
          });
          pools.set(String(config.pool_id), entry);
        }
        return pools;
      };

      const hourlyPools = reconstructPools(hourlyLine!);
      const usagePools = reconstructPools(usageLine!);

      expect(hourlyPools.get(hCatchAllId)).toMatchObject({
        pool_name: 'H catch-all',
        covers_all_services: true,
        after_hours_multiplier: 1.5,
        business_hours_schedule_id: scheduleId,
      });
      expect(hourlyPools.get(hCatchAllId)!.members).toEqual(
        expect.arrayContaining([
          { service_id: hourlyServices.h1, burn_multiplier: 2 },
          { service_id: hourlyServices.h4, burn_multiplier: 1 },
        ]),
      );
      expect(hourlyPools.get(hMemberId)).toMatchObject({
        pool_name: 'H member',
        covers_all_services: false,
        after_hours_multiplier: null,
        business_hours_schedule_id: null,
      });
      expect(hourlyPools.get(hMemberId)!.members).toEqual(
        expect.arrayContaining([
          { service_id: hourlyServices.h2, burn_multiplier: 1 },
          { service_id: hourlyServices.h3, burn_multiplier: 2.5 },
        ]),
      );

      expect(usagePools.get(uMemberId)).toMatchObject({
        pool_name: 'U member',
        covers_all_services: false,
        after_hours_multiplier: null,
        business_hours_schedule_id: null,
      });
      expect(usagePools.get(uMemberId)!.members).toEqual([
        { service_id: usageServices.u1, burn_multiplier: 3 },
      ]);
      expect(usagePools.get(uCatchAllId)).toMatchObject({
        pool_name: 'U catch-all',
        covers_all_services: true,
        after_hours_multiplier: 2,
        business_hours_schedule_id: scheduleId,
      });
      expect(usagePools.get(uCatchAllId)!.members).toEqual(
        expect.arrayContaining([
          { service_id: usageServices.u2, burn_multiplier: 1.5 },
          { service_id: usageServices.u3, burn_multiplier: 1 },
        ]),
      );
    });
  });
});
