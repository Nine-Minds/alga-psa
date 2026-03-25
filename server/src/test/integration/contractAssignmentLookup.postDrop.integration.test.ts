import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createFixedPlanAssignment, createTestService } from '../../../test-utils/billingTestHelpers';
import { setupCommonMocks } from '../../../test-utils/testMocks';

let db: Knex;
let tenantId: string;
let userId: string;

let getContractAssignmentsAction: typeof import('@alga-psa/billing/actions/contractActions').getContractAssignments;
let getContractSummaryAction: typeof import('@alga-psa/billing/actions/contractActions').getContractSummary;

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

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth:
    (fn: (...args: any[]) => any) =>
    (...args: any[]) =>
      fn(
        {
          user_id: userId,
          tenant: tenantId,
          roles: [{ role_name: 'Admin' }],
        },
        { tenant: tenantId },
        ...args,
      ),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(() => true),
}));

describe('Contract assignment lookup post-drop integration', () => {
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
        client_name: 'Contract assignment post-drop tenant',
        email: 'contract-assignment-post-drop@test.local',
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
    }

    userId = uuidv4();

    setupCommonMocks({
      tenantId,
      userId,
      permissionCheck: () => true,
    });

    ({
      getContractAssignments: getContractAssignmentsAction,
      getContractSummary: getContractSummaryAction,
    } = await import('@alga-psa/billing/actions/contractActions'));
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it('T112: contract assignment lookup rejects template IDs on instantiated paths while template detail summary path remains available', async () => {
    const clientId = uuidv4();
    await db('clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: `Assignment Client ${clientId.slice(0, 8)}`,
      billing_cycle: 'monthly',
      is_tax_exempt: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const contextLike = { db, tenantId, clientId } as const;
    const serviceId = await createTestService(contextLike as any, {
      service_name: 'Template Split Service',
      billing_method: 'fixed',
      default_rate: 18500,
      unit_of_measure: 'month',
    });

    const assignment = await createFixedPlanAssignment(contextLike as any, serviceId, {
      clientId,
      planName: 'Instantiated Contract Plan',
      startDate: '2026-01-01',
      endDate: null,
      billingTiming: 'arrears',
      cadenceOwner: 'client',
    });

    const templateId = uuidv4();
    await db('contract_templates').insert({
      tenant: tenantId,
      template_id: templateId,
      template_name: 'Template Summary Contract',
      template_description: 'Template-only detail path for F084/T112',
      default_billing_frequency: 'monthly',
      template_status: 'active',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await db('contract_template_lines').insert({
      tenant: tenantId,
      template_line_id: uuidv4(),
      template_id: templateId,
      template_line_name: 'Template Summary Line',
      description: 'Template detail coverage line',
      billing_frequency: 'monthly',
      line_type: 'Fixed',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await db('client_contracts')
      .where({
        tenant: tenantId,
        client_contract_id: assignment.clientContractId,
      })
      .update({
        template_contract_id: templateId,
        updated_at: db.fn.now(),
      });

    const instantiatedAssignments = await getContractAssignmentsAction(assignment.contractId);
    expect(instantiatedAssignments.length).toBeGreaterThan(0);
    expect(instantiatedAssignments.some((row) => row.client_contract_id === assignment.clientContractId)).toBe(true);

    const templateAssignments = await getContractAssignmentsAction(templateId);
    expect(templateAssignments).toEqual([]);

    const templateSummary = await getContractSummaryAction(templateId);
    expect(templateSummary.contractLineCount).toBe(1);
    expect(templateSummary.totalClientAssignments).toBe(0);
  }, 90_000);
});
