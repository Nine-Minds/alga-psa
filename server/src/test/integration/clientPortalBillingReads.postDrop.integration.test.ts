import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createFixedPlanAssignment, createTestService } from '../../../test-utils/billingTestHelpers';
import { setupCommonMocks } from '../../../test-utils/testMocks';

let db: Knex;
let tenantId: string;
let userId: string;
let contactId: string;

let getActiveServicesAction: typeof import('@alga-psa/client-portal/actions/account').getActiveServices;
let getBillingCyclesAction: typeof import('@alga-psa/client-portal/actions/account').getBillingCycles;

vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getConnection: vi.fn(async () => db),
    withTransaction: vi.fn(async (knexOrTrx: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
      callback(knexOrTrx as unknown as Knex.Transaction),
    ),
    requireTenantId: vi.fn(async () => tenantId),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (fn: (...args: any[]) => any) =>
    (...args: any[]) =>
      fn(
        {
          user_id: userId,
          tenant: tenantId,
          contact_id: contactId,
          user_type: 'client',
          roles: [{ role_name: 'Client User' }],
        },
        { tenant: tenantId },
        ...args,
      ),
}));

describe('Client portal billing reads post-drop integration', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_USER_ADMIN = process.env.DB_USER_ADMIN || 'postgres';
    process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'sebastian_test';
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'postpass123';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';

    db = await createTestDbConnection();
    await db.migrate.latest();

    const existing = await db('tenants').first<{ tenant: string }>('tenant');
    if (existing?.tenant) {
      tenantId = existing.tenant;
    } else {
      tenantId = uuidv4();
      await db('tenants').insert({
        tenant: tenantId,
        client_name: 'Client Portal Post-Drop Test Tenant',
        email: 'client-portal-post-drop@test.local',
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
    }

    userId = uuidv4();
    contactId = uuidv4();

    setupCommonMocks({
      tenantId,
      userId,
      permissionCheck: () => true,
    });

    ({
      getActiveServices: getActiveServicesAction,
      getBillingCycles: getBillingCyclesAction,
    } = await import('@alga-psa/client-portal/actions/account'));
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it('T110: client-portal billing/account/services reads avoid client_contract_lines and still render active recurring services', async () => {
    expect(await db.schema.hasTable('client_contract_lines')).toBe(false);

    const clientId = uuidv4();
    await db('clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: `Portal Client ${clientId.slice(0, 8)}`,
      billing_cycle: 'monthly',
      is_tax_exempt: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await db('contacts').insert({
      tenant: tenantId,
      contact_name_id: contactId,
      client_id: clientId,
      full_name: 'Portal Billing Contact',
      email: 'portal-billing-contact@test.local',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await db('users').insert({
      user_id: userId,
      tenant: tenantId,
      username: `portal-user-${userId.slice(0, 8)}`,
      email: `portal-${userId.slice(0, 8)}@test.local`,
      hashed_password: 'test_hash',
      user_type: 'client',
      contact_id: contactId,
      first_name: 'Portal',
      last_name: 'User',
      is_inactive: false,
      created_at: db.fn.now(),
    });

    const serviceId = await createTestService(
      { db, tenantId, clientId } as any,
      {
        service_name: 'Portal Managed Service',
        billing_method: 'fixed',
        default_rate: 14500,
        unit_of_measure: 'month',
      },
    );

    await createFixedPlanAssignment(
      { db, tenantId, clientId } as any,
      serviceId,
      {
        clientId,
        planName: 'Portal Managed Plan',
        startDate: '2026-01-01',
        endDate: null,
        billingTiming: 'arrears',
        cadenceOwner: 'client',
      },
    );

    const observedSql: string[] = [];
    const onQuery = (queryData: { sql?: string }) => {
      if (typeof queryData.sql === 'string') {
        observedSql.push(queryData.sql);
      }
    };

    db.on('query', onQuery);
    const activeServices = await getActiveServicesAction();
    const billingCycles = await getBillingCyclesAction();
    db.removeListener('query', onQuery);

    expect(activeServices.some((service) => service.name === 'Portal Managed Service')).toBe(true);
    expect(billingCycles.length).toBeGreaterThan(0);
    expect(observedSql.some((sql) => /client_contract_lines/i.test(sql))).toBe(false);
  }, 90_000);
});
