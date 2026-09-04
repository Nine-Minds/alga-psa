/**
 * Weighted bucket draw adjustment on time-entry edit/reassignment (real DB).
 *
 * Regression coverage for the per-side draw rule: when a time entry is edited
 * or reassigned, the reversal of the OLD draw and the application of the NEW
 * draw must each be resolved from THAT record side's own context — client
 * (derived from that side's own work item), contract line, pool membership,
 * multiplier, and schedule. The old draw must never be reversed under the new
 * context (or vice versa).
 *
 * These tests drive the shipped `saveTimeEntry` action end to end:
 *   - reassignment across clients and lines,
 *   - service change that changes the per-member multiplier,
 *   - time-of-day change that changes the after-hours multiplier,
 * and assert `bucket_usage` deltas on BOTH sides.
 *
 * Opt-in: needs a reachable database (RUN_DB_TESTS=1).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { randomUUID } from 'node:crypto';

import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';
import { tenantDb } from '@alga-psa/db';

vi.mock('server/src/lib/utils/getSecret', () => ({
  getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
    (envVar && process.env[envVar]) || fallback || ''),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
    (envVar && process.env[envVar]) || fallback || ''),
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: async () => '',
  })),
  secretProvider: {
    getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
    (envVar && process.env[envVar]) || fallback || ''),
  },
}));

vi.mock('@alga-psa/core/logger', () => {
  const stub = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return { default: stub, logger: stub };
});

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => {}),
  publishWorkflowEvent: vi.fn(async () => {}),
}));

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(async () => {}),
}));

vi.mock('server/src/lib/eventBus', () => ({
  getEventBus: vi.fn(() => ({
    publish: vi.fn(async () => {}),
  })),
}));

vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: {
    capture: vi.fn(),
  },
}));

let mockCurrentUser: any = null;

vi.mock('@alga-psa/auth', async () => {
  const rbac = await vi.importActual<typeof import('@alga-psa/auth/rbac')>('@alga-psa/auth/rbac');
  const requireMockUser = () => {
    if (!mockCurrentUser) {
      throw new Error('User not authenticated');
    }
    return mockCurrentUser;
  };
  return {
    ...rbac,
    getSession: vi.fn(async () => ({ user: undefined })),
    withAuth: (action: any) => async (...args: any[]) => {
      const user = requireMockUser();
      const { runWithTenant } = await import('@alga-psa/db');
      return runWithTenant(user.tenant, () => action(user, { tenant: user.tenant }, ...args));
    },
    withOptionalAuth: (action: any) => async (...args: any[]) => {
      const user = mockCurrentUser;
      if (!user) return action(null, null, ...args);
      const { runWithTenant } = await import('@alga-psa/db');
      return runWithTenant(user.tenant, () => action(user, { tenant: user.tenant }, ...args));
    },
    withAuthCheck: (action: any) => async (...args: any[]) => {
      const user = requireMockUser();
      return action(user, ...args);
    },
  };
});

vi.mock('@alga-psa/users/actions', async () => ({
  getCurrentUser: vi.fn(async () => mockCurrentUser),
}));

const ENABLED = process.env.RUN_DB_TESTS === '1';

let db: Knex;
let tenantId: string;
let userId: string;
let saveTimeEntry: any;

interface PoolSeed {
  bucketId: string;
  contractLineId: string;
}

interface ClientSeed {
  clientId: string;
  ticketId: string;
  pools: Map<string, PoolSeed>;
}

async function grantTimeEntryPermissions(connection: Knex, tenant: string, userId: string) {
  const roleId = uuidv4();
  const scopedDb = tenantDb(connection, tenant);
  await scopedDb.table('roles').insert({
    tenant,
    role_id: roleId,
    role_name: `Bucket Draw Test Role ${uuidv4().slice(0, 8)}`,
    description: 'Test role for weighted bucket draw adjustment integration',
    msp: true,
    client: false,
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });

  for (const perm of [
    { resource: 'time_entry', action: 'create' },
    { resource: 'time_entry', action: 'update' },
    { resource: 'time_entry', action: 'delete' },
  ]) {
    const existingPerm = await scopedDb.table('permissions')
      .where({ resource: perm.resource, action: perm.action })
      .first<{ permission_id: string }>('permission_id');
    const permissionId = existingPerm?.permission_id ?? uuidv4();
    if (!existingPerm) {
      await scopedDb.table('permissions').insert({
        tenant,
        permission_id: permissionId,
        resource: perm.resource,
        action: perm.action,
        msp: true,
        client: false,
        created_at: connection.fn.now(),
      });
    }
    await scopedDb.table('role_permissions')
      .insert({
        tenant,
        role_id: roleId,
        permission_id: permissionId,
        created_at: connection.fn.now(),
      })
      .onConflict(['tenant', 'role_id', 'permission_id'])
      .ignore();
  }

  await scopedDb.table('user_roles')
    .insert({ tenant, user_id: userId, role_id: roleId, created_at: connection.fn.now() })
    .onConflict(['tenant', 'user_id', 'role_id'])
    .ignore();
}

describe.skipIf(!ENABLED)('time-entry edit/reassignment resolves weighted draws per record side (real DB)', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection();
    tenantId = await createTenant(db, 'Weighted draw adjustment tenant');
    userId = await createUser(db, tenantId, {
      email: `draw-${uuidv4().slice(0, 8)}@example.com`,
      first_name: 'Draw',
      last_name: 'Tester',
      user_type: 'internal',
    });
    await grantTimeEntryPermissions(db, tenantId, userId);
    mockCurrentUser = {
      user_id: userId,
      tenant: tenantId,
      user_type: 'internal',
    };
    ({ saveTimeEntry } = await import('@alga-psa/scheduling/actions/timeEntryActions'));
  }, 180_000);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  /**
   * Seeds a fresh client with a Bucket contract line and a configurable set of
   * pools (members at a burn_multiplier, optional after-hours rule) plus a
   * ticket that resolves to this client. Returns the seed handles.
   */
  async function seedClient(ctx: {
    pools: Array<{
      key: string;
      serviceId: string;
      multiplier: number;
      afterHours?: { multiplier: number; scheduleId: string };
      /** Pool size in minutes (default 6000, matching the fixed seed). */
      totalMinutes?: number;
      /** Whether unused minutes roll over into the next period (default false). */
      allowRollover?: boolean;
    }>;
  }): Promise<ClientSeed> {
    const scopedDb = tenantDb(db, tenantId);
    const clientId = await createClient(db, tenantId, `Draw client ${uuidv4().slice(0, 6)}`);
    const contractId = randomUUID();
    const contractLineId = randomUUID();

    let serviceTypeId = (await scopedDb.table('service_types').first('id'))?.id;
    if (!serviceTypeId) {
      await scopedDb.table('service_types').insert({
        id: randomUUID(),
        tenant: tenantId,
        name: `Draw service type ${uuidv4().slice(0, 6)}`,
        is_active: true,
      });
      serviceTypeId = (await scopedDb.table('service_types').first('id'))?.id;
    }

    await scopedDb.table('contracts').insert({
      tenant: tenantId,
      contract_id: contractId,
      contract_name: `Draw contract ${clientId.slice(0, 6)}`,
    });
    await scopedDb.table('contract_lines').insert({
      tenant: tenantId,
      contract_line_id: contractLineId,
      contract_id: contractId,
      contract_line_name: `Draw line ${clientId.slice(0, 6)}`,
      contract_line_type: 'Bucket',
      billing_frequency: 'monthly',
      cadence_owner: 'client',
      is_template: false,
      is_active: true,
    });
    await scopedDb.table('client_contracts').insert({
      tenant: tenantId,
      client_contract_id: randomUUID(),
      client_id: clientId,
      contract_id: contractId,
      start_date: '2026-01-01',
      end_date: null,
      is_active: true,
    });

    const pools = new Map<string, PoolSeed>();
    for (const poolDef of ctx.pools) {
      const serviceId = randomUUID();
      await scopedDb.table('service_catalog').insert({
        tenant: tenantId,
        service_id: serviceId,
        service_name: `draw-svc-${serviceId.slice(0, 6)}`,
        billing_method: 'hourly',
        custom_service_type_id: serviceTypeId,
      });
      const bucketId = randomUUID();
      await scopedDb.table('contract_line_buckets').insert({
        tenant: tenantId,
        bucket_id: bucketId,
        contract_line_id: contractLineId,
        total_minutes: poolDef.totalMinutes ?? 6000,
        overage_rate: 15000,
        allow_rollover: poolDef.allowRollover ?? false,
        covers_all_services: false,
        after_hours_multiplier: poolDef.afterHours?.multiplier ?? null,
        business_hours_schedule_id: poolDef.afterHours?.scheduleId ?? null,
      });
      await scopedDb.table('contract_line_bucket_services').insert({
        tenant: tenantId,
        bucket_id: bucketId,
        contract_line_id: contractLineId,
        service_id: serviceId,
        burn_multiplier: poolDef.multiplier,
      });
      pools.set(poolDef.key, { bucketId, contractLineId, serviceId: serviceId as unknown as string });
      (pools.get(poolDef.key) as any).serviceId = serviceId;
    }

    const ticketId = randomUUID();
    await scopedDb.table('tickets').insert({
      tenant: tenantId,
      ticket_id: ticketId,
      ticket_number: `DRW-${uuidv4().slice(0, 6)}`,
      title: `Draw ticket ${clientId.slice(0, 6)}`,
      client_id: clientId,
    });

    return { clientId, ticketId, pools };
  }

  async function seedSchedule(): Promise<string> {
    const scheduleId = randomUUID();
    await tenantDb(db, tenantId).table('business_hours_schedules').insert({
      tenant: tenantId,
      schedule_id: scheduleId,
      schedule_name: 'Draw test schedule',
      timezone: 'UTC',
      is_default: false,
      is_24x7: false,
    });
    for (let day = 0; day <= 6; day += 1) {
      const enabled = day >= 1 && day <= 5;
      await tenantDb(db, tenantId).table('business_hours_entries').insert({
        tenant: tenantId,
        entry_id: randomUUID(),
        schedule_id: scheduleId,
        day_of_week: day,
        start_time: enabled ? '09:00' : '00:00',
        end_time: enabled ? '17:00' : '00:00',
        is_enabled: enabled,
      });
    }
    return scheduleId;
  }

  async function usageMinutes(clientId: string, bucketId: string): Promise<number> {
    const row = await tenantDb(db, tenantId).table('bucket_usage')
      .where({ tenant: tenantId, client_id: clientId, bucket_id: bucketId })
      .first<{ minutes_used: number | string }>('minutes_used');
    return Number(row?.minutes_used ?? 0);
  }

  async function usageRecordForPeriod(
    clientId: string,
    bucketId: string,
    periodStart: string,
  ): Promise<{ minutes_used: number | string; rolled_over_minutes: number | string; period_start: string } | undefined> {
    return tenantDb(db, tenantId).table('bucket_usage')
      .where({ tenant: tenantId, client_id: clientId, bucket_id: bucketId, period_start: periodStart })
      .first('minutes_used', 'rolled_over_minutes', 'period_start');
  }

  function entryPayload(params: {
    ticketId: string;
    serviceId: string;
    contractLineId: string;
    startIso: string;
    endIso: string;
    billableDuration: number;
    entryId?: string;
  }) {
    return {
      entry_id: params.entryId ?? null,
      work_item_id: params.ticketId,
      work_item_type: 'ticket',
      start_time: params.startIso,
      end_time: params.endIso,
      created_at: params.startIso,
      updated_at: params.startIso,
      billable_duration: params.billableDuration,
      notes: 'weighted draw adjustment test',
      user_id: userId,
      approval_status: 'DRAFT',
      service_id: params.serviceId,
      contract_line_id: params.contractLineId,
    };
  }

  it('reverses the old draw under the OLD client/line and applies the new draw under the NEW client/line on reassignment', async () => {
    const scheduleId = await seedSchedule();
    const clientA = await seedClient({
      pools: [{ key: 'a1', serviceId: '', multiplier: 1, afterHours: { multiplier: 1.5, scheduleId } }],
    });
    const clientB = await seedClient({
      pools: [{ key: 'b1', serviceId: '', multiplier: 1 }],
    });
    const poolA1 = clientA.pools.get('a1')!;
    const poolB1 = clientB.pools.get('b1')!;

    const created = await saveTimeEntry(entryPayload({
      ticketId: clientA.ticketId,
      serviceId: (poolA1 as any).serviceId,
      contractLineId: poolA1.contractLineId,
      startIso: '2026-03-10T10:00:00Z', // Tue, in-hours
      endIso: '2026-03-10T11:00:00Z',
      billableDuration: 60,
    }));
    expect(created.entry_id).toBeTruthy();
    expect(await usageMinutes(clientA.clientId, poolA1.bucketId)).toBe(60);

    // Reassign to client B's ticket + line + service.
    await saveTimeEntry(entryPayload({
      entryId: created.entry_id,
      ticketId: clientB.ticketId,
      serviceId: (poolB1 as any).serviceId,
      contractLineId: poolB1.contractLineId,
      startIso: '2026-03-10T10:00:00Z',
      endIso: '2026-03-10T11:00:00Z',
      billableDuration: 60,
    }));

    // Old side fully reversed under client A; new side applied under client B.
    expect(await usageMinutes(clientA.clientId, poolA1.bucketId)).toBe(0);
    expect(await usageMinutes(clientB.clientId, poolB1.bucketId)).toBe(60);
  });

  it('reverses the old draw when the edit changes the service multiplier within the same client', async () => {
    const clientA = await seedClient({
      pools: [
        { key: 'a1', serviceId: '', multiplier: 1 },
        { key: 'a2', serviceId: '', multiplier: 2 },
      ],
    });
    const poolA1 = clientA.pools.get('a1')!;
    const poolA2 = clientA.pools.get('a2')!;

    const created = await saveTimeEntry(entryPayload({
      ticketId: clientA.ticketId,
      serviceId: (poolA1 as any).serviceId,
      contractLineId: poolA1.contractLineId,
      startIso: '2026-03-10T10:00:00Z',
      endIso: '2026-03-10T11:00:00Z',
      billableDuration: 60,
    }));
    expect(await usageMinutes(clientA.clientId, poolA1.bucketId)).toBe(60);

    // Same client, same line, different service → 2x multiplier.
    await saveTimeEntry(entryPayload({
      entryId: created.entry_id,
      ticketId: clientA.ticketId,
      serviceId: (poolA2 as any).serviceId,
      contractLineId: poolA2.contractLineId,
      startIso: '2026-03-10T10:00:00Z',
      endIso: '2026-03-10T11:00:00Z',
      billableDuration: 60,
    }));

    expect(await usageMinutes(clientA.clientId, poolA1.bucketId)).toBe(0);
    expect(await usageMinutes(clientA.clientId, poolA2.bucketId)).toBe(120);
  });

  it('reverses the old draw and applies the new draw when time-of-day changes the after-hours multiplier', async () => {
    const scheduleId = await seedSchedule();
    const clientA = await seedClient({
      pools: [{ key: 'a1', serviceId: '', multiplier: 1, afterHours: { multiplier: 1.5, scheduleId } }],
    });
    const poolA1 = clientA.pools.get('a1')!;
    const serviceId = (poolA1 as any).serviceId;

    // In-hours: 60 min at 1x.
    const created = await saveTimeEntry(entryPayload({
      ticketId: clientA.ticketId,
      serviceId,
      contractLineId: poolA1.contractLineId,
      startIso: '2026-03-10T10:00:00Z',
      endIso: '2026-03-10T11:00:00Z',
      billableDuration: 60,
    }));
    expect(await usageMinutes(clientA.clientId, poolA1.bucketId)).toBe(60);

    // After-hours (18:00 > 17:00): reversal of the in-hours 60, then 60 × 1.5.
    await saveTimeEntry(entryPayload({
      entryId: created.entry_id,
      ticketId: clientA.ticketId,
      serviceId,
      contractLineId: poolA1.contractLineId,
      startIso: '2026-03-10T18:00:00Z',
      endIso: '2026-03-10T19:00:00Z',
      billableDuration: 60,
    }));

    expect(await usageMinutes(clientA.clientId, poolA1.bucketId)).toBe(90);
  });

  it('reverses the old draw BEFORE computing the new period rollover when an edit moves an entry across billing periods', async () => {
    const clientA = await seedClient({
      pools: [{ key: 'a1', serviceId: '', multiplier: 1, totalMinutes: 100, allowRollover: true }],
    });
    const poolA1 = clientA.pools.get('a1')!;
    const serviceId = (poolA1 as any).serviceId;

    // July entry: 60 weighted minutes drawn from a 100-minute rollover pool.
    const created = await saveTimeEntry(entryPayload({
      ticketId: clientA.ticketId,
      serviceId,
      contractLineId: poolA1.contractLineId,
      startIso: '2026-07-10T10:00:00Z',
      endIso: '2026-07-10T11:00:00Z',
      billableDuration: 60,
    }));
    expect(created.entry_id).toBeTruthy();
    const julyAfterCreate = await usageRecordForPeriod(clientA.clientId, poolA1.bucketId, '2026-07-01');
    expect(julyAfterCreate).toBeDefined();
    expect(Number(julyAfterCreate!.minutes_used)).toBe(60);

    // Move the entry into August. The August record's rolled_over_minutes is
    // computed from July's minutes_used at the moment the August record is
    // created. Correct ordering (reverse old first) leaves July at 0 and
    // carries the full 100 minutes over; the stale-ordering bug (apply new
    // first) snapshots July's pre-reversal 60 and rolls only 40 over.
    await saveTimeEntry(entryPayload({
      entryId: created.entry_id,
      ticketId: clientA.ticketId,
      serviceId,
      contractLineId: poolA1.contractLineId,
      startIso: '2026-08-10T10:00:00Z',
      endIso: '2026-08-10T11:00:00Z',
      billableDuration: 60,
    }));

    // Old side fully reversed: July is back to zero (the 60 moved to August).
    const julyAfterEdit = await usageRecordForPeriod(clientA.clientId, poolA1.bucketId, '2026-07-01');
    expect(julyAfterEdit).toBeDefined();
    expect(Number(julyAfterEdit!.minutes_used)).toBe(0);

    // The August record's rollover must reflect POST-reversal July state: the
    // whole 100 minutes carries over. (With apply-before-reverse ordering this
    // is 40, so the test fails against the pre-fix path.)
    const august = await usageRecordForPeriod(clientA.clientId, poolA1.bucketId, '2026-08-01');
    expect(august).toBeDefined();
    expect(Number(august!.minutes_used)).toBe(60);
    expect(Number(august!.rolled_over_minutes)).toBe(100);
  });
});
