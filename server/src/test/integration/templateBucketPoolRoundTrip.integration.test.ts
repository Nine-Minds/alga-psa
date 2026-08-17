/**
 * Template pool-config round-trip (real DB).
 *
 * Regression coverage for full pool-config preservation through the template
 * pipeline: contract → template (ensureTemplateLineSnapshot) → clone
 * (cloneTemplateContractLine) → contract. Both a catch-all pool and a
 * multi-member pool must round-trip:
 *   - pool scope (covers_all_services, incl. catch-all),
 *   - multi-member membership with per-service burn multipliers,
 *   - after-hours rule (multiplier + schedule reference),
 *   - pool identity never keyed into a config-id FK.
 *
 * Opt-in: needs a reachable database (RUN_DB_TESTS=1). Everything runs inside
 * one transaction that is always rolled back.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import knexFactory, { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { cloneTemplateContractLine } from '@alga-psa/shared/billingClients/templateClone';
import { ensureTemplateLineSnapshot } from '@alga-psa/billing/actions/contractLineMappingActions';

const ENABLED = process.env.RUN_DB_TESTS === '1';

let db: Knex;

describe.skipIf(!ENABLED)('template bucket pool round-trip (real DB)', () => {
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

  async function withSeededRoundTrip(
    body: (ctx: {
      trx: Knex.Transaction;
      tenant: string;
      templateContractId: string;
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

        const templateContractId = randomUUID();
        const contractId = randomUUID();
        const contractLineId = randomUUID();
        const scheduleId = randomUUID();
        const catchAllBucketId = randomUUID();
        const multiBucketId = randomUUID();
        const serviceA = randomUUID();
        const serviceB = randomUUID();
        const serviceC = randomUUID();

        await trx('contract_templates').insert({
          tenant,
          template_id: templateContractId,
          template_name: `Pool round-trip template ${templateContractId.slice(0, 6)}`,
          template_description: 'Pool round-trip template',
        });

        for (const serviceId of [serviceA, serviceB, serviceC]) {
          await trx('service_catalog').insert({
            tenant, service_id: serviceId,
            service_name: `roundtrip-svc-${serviceId.slice(0, 6)}`,
            billing_method: 'hourly', custom_service_type_id: serviceTypeId,
          });
        }

        await trx('contracts').insert({
          tenant, contract_id: contractId, contract_name: 'Pool round-trip contract',
        });
        await trx('contract_lines').insert({
          tenant, contract_line_id: contractLineId, contract_id: contractId,
          contract_line_name: 'Pool round-trip line',
          contract_line_type: 'Bucket', billing_frequency: 'monthly',
          cadence_owner: 'client', is_template: false, is_active: true,
        });
        await trx('contract_line_services').insert([
          { tenant, contract_line_id: contractLineId, service_id: serviceA },
          { tenant, contract_line_id: contractLineId, service_id: serviceB },
          { tenant, contract_line_id: contractLineId, service_id: serviceC },
        ]);

        // Mon–Fri 09:00–17:00 schedule for the after-hours rule.
        await trx('business_hours_schedules').insert({
          tenant, schedule_id: scheduleId, schedule_name: 'Round-trip schedule',
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
          bucket_name: 'Catch-all pool', total_minutes: 1200, overage_rate: 15000,
          allow_rollover: true, covers_all_services: true,
          after_hours_multiplier: 1.5, business_hours_schedule_id: scheduleId,
        });
        // Member rows are multiplier overrides inside a catch-all.
        await trx('contract_line_bucket_services').insert([
          { tenant, bucket_id: catchAllBucketId, contract_line_id: contractLineId, service_id: serviceA, burn_multiplier: 2 },
        ]);

        // Multi-member member-scoped pool.
        await trx('contract_line_buckets').insert({
          tenant, bucket_id: multiBucketId, contract_line_id: contractLineId,
          bucket_name: 'Multi pool', total_minutes: 600, overage_rate: 18500,
          allow_rollover: false, covers_all_services: false,
          after_hours_multiplier: null, business_hours_schedule_id: null,
        });
        await trx('contract_line_bucket_services').insert([
          { tenant, bucket_id: multiBucketId, contract_line_id: contractLineId, service_id: serviceB, burn_multiplier: 1 },
          { tenant, bucket_id: multiBucketId, contract_line_id: contractLineId, service_id: serviceC, burn_multiplier: 3 },
        ]);

        await body({
          trx, tenant, templateContractId, contractLineId, scheduleId,
          catchAllBucketId, multiBucketId, serviceA, serviceB, serviceC,
        });

        throw new Error('__rollback__');
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.message === '__rollback__') return;
        throw error;
      });
  }

  it('round-trips a catch-all pool and a multi-member pool through template snapshot and clone', async () => {
    await withSeededRoundTrip(async ({
      trx, tenant, templateContractId, contractLineId, scheduleId,
      catchAllBucketId, multiBucketId, serviceA, serviceB, serviceC,
    }) => {
      // Contract → template.
      await ensureTemplateLineSnapshot(trx, tenant, templateContractId, contractLineId);

      const templatePools = await trx('contract_template_line_buckets')
        .where({ tenant, template_line_id: contractLineId })
        .orderBy('created_at', 'asc');
      expect(templatePools).toHaveLength(2);

      const templateCatchAll = templatePools.find((pool) => pool.covers_all_services);
      const templateMulti = templatePools.find((pool) => !pool.covers_all_services);
      expect(templateCatchAll).toBeDefined();
      expect(templateMulti).toBeDefined();
      // Pool identity is a first-class template id, never a config-id FK value.
      expect(templateCatchAll.bucket_id).toBe(catchAllBucketId);
      expect(templateMulti.bucket_id).toBe(multiBucketId);

      // Catch-all pool attributes survive.
      expect(templateCatchAll.bucket_name).toBe('Catch-all pool');
      expect(Number(templateCatchAll.total_minutes)).toBe(1200);
      expect(Number(templateCatchAll.overage_rate)).toBe(15000);
      expect(templateCatchAll.allow_rollover).toBe(true);
      expect(templateCatchAll.covers_all_services).toBe(true);
      expect(Number(templateCatchAll.after_hours_multiplier)).toBe(1.5);
      expect(templateCatchAll.business_hours_schedule_id).toBe(scheduleId);

      // Multi-member pool attributes survive.
      expect(templateMulti.bucket_name).toBe('Multi pool');
      expect(Number(templateMulti.total_minutes)).toBe(600);
      expect(Number(templateMulti.overage_rate)).toBe(18500);
      expect(templateMulti.allow_rollover).toBe(false);
      expect(templateMulti.after_hours_multiplier).toBeNull();
      expect(templateMulti.business_hours_schedule_id).toBeNull();

      // Membership + multipliers survive (catch-all override + 2 members).
      const templateMembers = await trx('contract_template_line_bucket_services')
        .where({ tenant, template_line_id: contractLineId });
      const catchAllMembers = templateMembers.filter((m) => m.bucket_id === catchAllBucketId);
      const multiMembers = templateMembers.filter((m) => m.bucket_id === multiBucketId);
      expect(catchAllMembers).toHaveLength(1);
      expect(catchAllMembers[0].service_id).toBe(serviceA);
      expect(Number(catchAllMembers[0].burn_multiplier)).toBe(2);
      expect(multiMembers).toHaveLength(2);
      const memberB = multiMembers.find((m) => m.service_id === serviceB);
      const memberC = multiMembers.find((m) => m.service_id === serviceC);
      expect(Number(memberB?.burn_multiplier)).toBe(1);
      expect(Number(memberC?.burn_multiplier)).toBe(3);

      // Template → clone → contract.
      const cloneContractId = randomUUID();
      const cloneLineId = randomUUID();
      await trx('contracts').insert({
        tenant, contract_id: cloneContractId, contract_name: 'Cloned contract',
      });
      await trx('contract_lines').insert({
        tenant, contract_line_id: cloneLineId, contract_id: cloneContractId,
        contract_line_name: 'Cloned line', contract_line_type: 'Bucket',
        billing_frequency: 'monthly', cadence_owner: 'client',
        is_template: false, is_active: true,
      });

      await cloneTemplateContractLine(trx, {
        tenant,
        templateContractLineId: contractLineId,
        contractLineId: cloneLineId,
      });

      const clonedPools = await trx('contract_line_buckets')
        .where({ tenant, contract_line_id: cloneLineId })
        .orderBy('created_at', 'asc');
      expect(clonedPools).toHaveLength(2);

      const clonedCatchAll = clonedPools.find((pool) => pool.covers_all_services);
      const clonedMulti = clonedPools.find((pool) => !pool.covers_all_services);
      expect(clonedCatchAll).toBeDefined();
      expect(clonedMulti).toBeDefined();
      // Clone mints fresh pool ids (distinct from the source pools).
      expect(clonedCatchAll.bucket_id).not.toBe(catchAllBucketId);
      expect(clonedMulti.bucket_id).not.toBe(multiBucketId);
      expect(clonedCatchAll.bucket_id).not.toBe(clonedMulti.bucket_id);

      expect(clonedCatchAll.bucket_name).toBe('Catch-all pool');
      expect(Number(clonedCatchAll.total_minutes)).toBe(1200);
      expect(Number(clonedCatchAll.overage_rate)).toBe(15000);
      expect(clonedCatchAll.allow_rollover).toBe(true);
      expect(clonedCatchAll.covers_all_services).toBe(true);
      expect(Number(clonedCatchAll.after_hours_multiplier)).toBe(1.5);
      expect(clonedCatchAll.business_hours_schedule_id).toBe(scheduleId);

      expect(clonedMulti.bucket_name).toBe('Multi pool');
      expect(Number(clonedMulti.total_minutes)).toBe(600);
      expect(Number(clonedMulti.overage_rate)).toBe(18500);
      expect(clonedMulti.allow_rollover).toBe(false);
      expect(clonedMulti.after_hours_multiplier).toBeNull();

      const clonedMembers = await trx('contract_line_bucket_services')
        .where({ tenant, contract_line_id: cloneLineId });
      const clonedCatchAllMembers = clonedMembers.filter((m) => m.bucket_id === clonedCatchAll.bucket_id);
      const clonedMultiMembers = clonedMembers.filter((m) => m.bucket_id === clonedMulti.bucket_id);
      expect(clonedCatchAllMembers).toHaveLength(1);
      expect(clonedCatchAllMembers[0].service_id).toBe(serviceA);
      expect(Number(clonedCatchAllMembers[0].burn_multiplier)).toBe(2);
      expect(clonedMultiMembers).toHaveLength(2);
      const clonedB = clonedMultiMembers.find((m) => m.service_id === serviceB);
      const clonedC = clonedMultiMembers.find((m) => m.service_id === serviceC);
      expect(Number(clonedB?.burn_multiplier)).toBe(1);
      expect(Number(clonedC?.burn_multiplier)).toBe(3);

      // No stray pools were minted by the legacy per-config fallback (which
      // would create a duplicate single-member pool).
      expect(clonedPools).toHaveLength(2);
    });
  });
});
