/**
 * Wizard bucket-pool submission through createClientContractFromWizard (real DB).
 *
 * Regression coverage for the flag-on wizard path: pool drafts authored in the
 * wizard's line-level pool editor travel in `submission.bucket_pools` and are
 * materialized onto the line the wizard created for that service category.
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

vi.mock('@alga-psa/auth/withAuth', async () => {
  const requireMockUser = () => {
    if (!mockCurrentUser) {
      throw new Error('User not authenticated');
    }
    return mockCurrentUser;
  };
  return {
    withAuth: (action: any) => async (...args: any[]) => {
      const user = requireMockUser();
      const { runWithTenant } = await import('@alga-psa/db');
      return runWithTenant(user.tenant, () => action(user, { tenant: user.tenant }, ...args));
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
let createClientContractFromWizard: any;

async function grantBillingPermissions(connection: Knex, tenant: string, userId: string) {
  const roleId = uuidv4();
  const scopedDb = tenantDb(connection, tenant);
  await scopedDb.table('roles').insert({
    tenant,
    role_id: roleId,
    role_name: `Wizard Pool Role ${uuidv4().slice(0, 8)}`,
    description: 'Test role for wizard bucket pool submission',
    msp: true,
    client: false,
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });

  for (const perm of [
    { resource: 'billing', action: 'create' },
    { resource: 'billing', action: 'update' },
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
      .insert({ tenant, role_id: roleId, permission_id: permissionId, created_at: connection.fn.now() })
      .onConflict(['tenant', 'role_id', 'permission_id'])
      .ignore();
  }

  await scopedDb.table('user_roles')
    .insert({ tenant, user_id: userId, role_id: roleId, created_at: connection.fn.now() })
    .onConflict(['tenant', 'user_id', 'role_id'])
    .ignore();
}

describe.skipIf(!ENABLED)('wizard bucket pool submission (real DB)', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection();
    tenantId = await createTenant(db, 'Wizard pool submission tenant');
    userId = await createUser(db, tenantId, {
      email: `wpool-${uuidv4().slice(0, 8)}@example.com`,
      first_name: 'Wizard',
      last_name: 'Pool',
      user_type: 'internal',
    });
    await grantBillingPermissions(db, tenantId, userId);
    mockCurrentUser = {
      user_id: userId,
      tenant: tenantId,
      user_type: 'internal',
    };
    ({ createClientContractFromWizard } = await import('@alga-psa/billing/actions/contractWizardActions'));
  }, 180_000);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  it('materializes wizard pool drafts onto the created hourly line (catch-all and member-scoped)', async () => {
    const scopedDb = tenantDb(db, tenantId);
    const clientId = await createClient(db, tenantId, `Wizard pool client ${uuidv4().slice(0, 6)}`);

    let serviceTypeId = (await scopedDb.table('service_types').first('id'))?.id;
    if (!serviceTypeId) {
      await scopedDb.table('service_types').insert({
        id: randomUUID(),
        tenant: tenantId,
        name: `Wizard pool service type ${uuidv4().slice(0, 6)}`,
        is_active: true,
      });
      serviceTypeId = (await scopedDb.table('service_types').first('id'))?.id;
    }
    const serviceId = randomUUID();
    await scopedDb.table('service_catalog').insert({
      tenant: tenantId,
      service_id: serviceId,
      service_name: `wizard-svc-${serviceId.slice(0, 6)}`,
      billing_method: 'hourly',
      custom_service_type_id: serviceTypeId,
      default_rate: 10000,
    });
    // A second service for the member-scoped pool (one bucket per (line, service)).
    const serviceId2 = randomUUID();
    await scopedDb.table('service_catalog').insert({
      tenant: tenantId,
      service_id: serviceId2,
      service_name: `wizard-svc-${serviceId2.slice(0, 6)}`,
      billing_method: 'hourly',
      custom_service_type_id: serviceTypeId,
      default_rate: 12000,
    });

    const scheduleId = randomUUID();
    await scopedDb.table('business_hours_schedules').insert({
      tenant: tenantId,
      schedule_id: scheduleId,
      schedule_name: 'Wizard pool schedule',
      timezone: 'UTC',
      is_default: false,
      is_24x7: false,
    });
    for (let day = 0; day <= 6; day += 1) {
      const enabled = day >= 1 && day <= 5;
      await scopedDb.table('business_hours_entries').insert({
        tenant: tenantId,
        entry_id: randomUUID(),
        schedule_id: scheduleId,
        day_of_week: day,
        start_time: enabled ? '09:00' : '00:00',
        end_time: enabled ? '17:00' : '00:00',
        is_enabled: enabled,
      });
    }

    const result = await createClientContractFromWizard(
      {
        contract_name: `Wizard pool contract ${uuidv4().slice(0, 6)}`,
        client_id: clientId,
        start_date: '2026-01-15',
        billing_frequency: 'monthly',
        currency_code: 'USD',
        enable_proration: false,
        cadence_owner: 'client',
        billing_timing: 'arrears',
        hourly_services: [
          { service_id: serviceId, service_name: `wizard-svc-${serviceId.slice(0, 6)}`, hourly_rate: 10000 },
          { service_id: serviceId2, service_name: `wizard-svc-${serviceId2.slice(0, 6)}`, hourly_rate: 12000 },
        ],
        hourly_billing_frequency: 'monthly',
        fixed_services: [],
        product_services: [],
        usage_services: [],
        bucket_pools: [
          {
            line_key: 'hourly',
            bucket_name: 'Wizard catch-all pool',
            total_minutes: 1200,
            overage_rate: 15000,
            allow_rollover: true,
            covers_all_services: true,
            after_hours_multiplier: 1.5,
            business_hours_schedule_id: scheduleId,
            members: [{ service_id: serviceId, burn_multiplier: 2 }],
          },
          {
            line_key: 'hourly',
            bucket_name: 'Wizard member pool',
            total_minutes: 600,
            overage_rate: 18500,
            allow_rollover: false,
            covers_all_services: false,
            members: [{ service_id: serviceId2, burn_multiplier: 1 }],
          },
        ],
      },
      { isDraft: true },
    );

    expect(result.contract_id).toBeTruthy();

    // Find the hourly line the wizard created for this contract.
    const line = await scopedDb.table('contract_lines')
      .where({ tenant: tenantId, contract_id: result.contract_id, contract_line_type: 'Hourly' })
      .first('contract_line_id');
    expect(line).toBeTruthy();

    const pools = await scopedDb.table('contract_line_buckets')
      .where({ tenant: tenantId, contract_line_id: line.contract_line_id })
      .orderBy('created_at', 'asc');
    expect(pools).toHaveLength(2);

    const catchAll = pools.find((pool) => pool.covers_all_services);
    const memberPool = pools.find((pool) => !pool.covers_all_services);
    expect(catchAll).toBeDefined();
    expect(memberPool).toBeDefined();

    expect(catchAll.bucket_name).toBe('Wizard catch-all pool');
    expect(Number(catchAll.total_minutes)).toBe(1200);
    expect(Number(catchAll.overage_rate)).toBe(15000);
    expect(catchAll.allow_rollover).toBe(true);
    expect(Number(catchAll.after_hours_multiplier)).toBe(1.5);
    expect(catchAll.business_hours_schedule_id).toBe(scheduleId);

    expect(memberPool.bucket_name).toBe('Wizard member pool');
    expect(Number(memberPool.total_minutes)).toBe(600);
    expect(Number(memberPool.overage_rate)).toBe(18500);
    expect(memberPool.allow_rollover).toBe(false);

    const members = await scopedDb.table('contract_line_bucket_services')
      .where({ tenant: tenantId, contract_line_id: line.contract_line_id });
    const catchAllMembers = members.filter((m) => m.bucket_id === catchAll.bucket_id);
    const memberPoolMembers = members.filter((m) => m.bucket_id === memberPool.bucket_id);
    expect(catchAllMembers).toHaveLength(1);
    expect(catchAllMembers[0].service_id).toBe(serviceId);
    expect(Number(catchAllMembers[0].burn_multiplier)).toBe(2);
    expect(memberPoolMembers).toHaveLength(1);
    expect(memberPoolMembers[0].service_id).toBe(serviceId2);
    expect(Number(memberPoolMembers[0].burn_multiplier)).toBe(1);
  });
});
