import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createFixedPlanAssignment, createTestService } from '../../../test-utils/billingTestHelpers';
import { setupCommonMocks } from '../../../test-utils/testMocks';

let db: Knex;
let tenantId: string;

let getClientContractLineAction: typeof import('@alga-psa/clients/actions/clientContractLineAction').getClientContractLine;
let updateClientContractLineAction: typeof import('@alga-psa/clients/actions/clientContractLineAction').updateClientContractLine;

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
          user_id: 'client-billing-post-drop-user',
          tenant: tenantId,
          roles: [{ role_name: 'Admin' }],
        },
        { tenant: tenantId },
        ...args,
      ),
}));

describe('Client billing configuration post-drop integration', () => {
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
        client_name: 'Client Billing Post-Drop Test Tenant',
        email: 'client-billing-post-drop@test.local',
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
    }

    setupCommonMocks({
      tenantId,
      userId: 'client-billing-post-drop-user',
      permissionCheck: () => true,
    });

    ({
      getClientContractLine: getClientContractLineAction,
      updateClientContractLine: updateClientContractLineAction,
    } = await import('@alga-psa/clients/actions/clientContractLineAction'));
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it('T109: admin client billing configuration reads/updates use post-drop contract tables without client_contract_lines queries', async () => {
    expect(await db.schema.hasTable('client_contract_lines')).toBe(false);

    const clientId = uuidv4();
    await db('clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: `Post Drop Client ${clientId.slice(0, 8)}`,
      billing_cycle: 'monthly',
      is_tax_exempt: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const serviceId = await createTestService(
      { db, tenantId, clientId } as any,
      {
        service_name: 'Post Drop Managed Service',
        billing_method: 'fixed',
        default_rate: 12000,
        unit_of_measure: 'month',
      },
    );

    const assignment = await createFixedPlanAssignment(
      { db, tenantId, clientId } as any,
      serviceId,
      {
        clientId,
        planName: 'Post Drop Managed Plan',
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
    const beforeUpdate = await getClientContractLineAction(clientId);
    await updateClientContractLineAction(assignment.contractLineId, {
      cadence_owner: 'contract',
      billing_timing: 'advance',
      custom_rate: 222,
      end_date: '2026-12-31T00:00:00.000Z',
    });
    db.removeListener('query', onQuery);

    expect(beforeUpdate.some((line) => line.contract_line_id === assignment.contractLineId)).toBe(true);
    expect(observedSql.some((sql) => /client_contract_lines/i.test(sql))).toBe(false);

    const updatedLine = await db('contract_lines')
      .where({ tenant: tenantId, contract_line_id: assignment.contractLineId })
      .first('cadence_owner', 'billing_timing', 'custom_rate');

    expect(updatedLine).toMatchObject({
      cadence_owner: 'contract',
      billing_timing: 'advance',
    });
    expect(Number(updatedLine?.custom_rate ?? 0)).toBe(222);
  }, 90_000);
});
