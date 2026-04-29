import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { exportWorkflowAuditLogsAction } from '@alga-psa/workflows/actions';
import { createTenantKnex, getCurrentTenantId } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/auth';

let tenantId = '';
let userId = '';

vi.mock('@alga-psa/authorization/kernel', () => ({
  BuiltinAuthorizationKernelProvider: class {},
  BundleAuthorizationKernelProvider: class {},
  RequestLocalAuthorizationCache: class {},
  createAuthorizationKernel: vi.fn()
}), { virtual: true });

vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn().mockReturnValue([])
}), { virtual: true });

vi.mock('@alga-psa/db/workDate', () => ({
  computeWorkDateFields: vi.fn(),
  resolveUserTimeZone: vi.fn().mockResolvedValue('UTC')
}), { virtual: true });

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(),
    getCurrentTenantId: vi.fn(),
    auditLog: vi.fn().mockResolvedValue(undefined)
  };
});

vi.mock('@alga-psa/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/auth')>();
  const withAuth = (action: (user: any, ctx: { tenant: string }, input: unknown) => Promise<any>) =>
    async (input: unknown) => action({ user_id: userId, tenant: tenantId, roles: ['admin'] }, { tenant: tenantId }, input);

  return {
    ...actual,
    withAuth,
    hasPermission: vi.fn().mockResolvedValue(true),
    getCurrentUser: vi.fn()
  };
});

const mockedCreateTenantKnex = vi.mocked(createTenantKnex);
const mockedGetCurrentTenantId = vi.mocked(getCurrentTenantId);
const mockedGetCurrentUser = vi.mocked(getCurrentUser);

let db: Knex;
type ColumnMap = Record<string, unknown>;
let tenantColumns: ColumnMap;
let userColumns: ColumnMap;
let workflowColumns: ColumnMap;
let dbAvailable = true;

function hasColumn(columns: ColumnMap, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns, name);
}

describe('workflow audit export integration', () => {
  beforeAll(async () => {
    try {
      db = await createTestDbConnection();
      tenantColumns = await db('tenants').columnInfo();
      userColumns = await db('users').columnInfo();
      workflowColumns = await db('workflow_definitions').columnInfo();
    } catch {
      dbAvailable = false;
    }
  }, 180_000);

  beforeEach(async () => {
    if (!dbAvailable) {
      return;
    }
    tenantId = uuidv4();
    userId = uuidv4();

    mockedCreateTenantKnex.mockResolvedValue({ knex: db, tenant: tenantId });
    mockedGetCurrentTenantId.mockReturnValue(tenantId);
    mockedGetCurrentUser.mockResolvedValue({ user_id: userId, tenant: tenantId, roles: ['admin'] } as any);

    await db('tenants').insert({
      tenant: tenantId,
      ...(hasColumn(tenantColumns, 'company_name')
        ? { company_name: `Tenant ${tenantId.slice(0, 8)}` }
        : { client_name: `Tenant ${tenantId.slice(0, 8)}` }),
      email: `tenant-${tenantId.slice(0, 8)}@example.com`,
      ...(hasColumn(tenantColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(tenantColumns, 'updated_at') ? { updated_at: db.fn.now() } : {})
    });

    await db('users').insert({
      tenant: tenantId,
      user_id: userId,
      username: `user-${tenantId.slice(0, 8)}`,
      first_name: 'Ava',
      last_name: 'Admin',
      email: `ava-${tenantId.slice(0, 8)}@example.com`,
      hashed_password: 'not-used',
      ...(hasColumn(userColumns, 'role') ? { role: 'admin' } : {}),
      ...(hasColumn(userColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(userColumns, 'updated_at') ? { updated_at: db.fn.now() } : {})
    });
  });

  afterAll(async () => {
    if (dbAvailable) {
      await db.destroy();
    }
  });

  it('T008: CSV export returns business-readable columns and JSON export remains raw redacted rows', async () => {
    if (!dbAvailable) {
      return;
    }
    const workflowId = uuidv4();

    await db('workflow_definitions').insert({
      workflow_id: workflowId,
      tenant_id: tenantId,
      name: 'Quarterly Review',
      key: 'quarterly.review',
      description: null,
      payload_schema_ref: 'payload.Empty.v1',
      draft_definition: { id: workflowId, name: 'Quarterly Review', version: 2, steps: [] },
      draft_version: 2,
      published_definition: { id: workflowId, name: 'Quarterly Review', version: 1, steps: [] },
      published_version: 1,
      status: 'published',
      ...(hasColumn(workflowColumns, 'created_by') ? { created_by: userId } : {}),
      ...(hasColumn(workflowColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(workflowColumns, 'updated_at') ? { updated_at: db.fn.now() } : {})
    });

    await db('audit_logs').insert({
      timestamp: db.fn.now(),
      user_id: userId,
      table_name: 'workflow_definitions',
      record_id: workflowId,
      tenant_id: tenantId,
      operation: 'workflow_definition_publish',
      changed_data: { published_version: 1, reason: 'Ready to ship', secretRef: 'super-secret' },
      details: { source: 'workflow_designer', release_notes: 'Customer requested rollout' }
    });

    const csvResult = await exportWorkflowAuditLogsAction({
      tableName: 'workflow_definitions',
      recordId: workflowId,
      format: 'csv'
    });

    expect(csvResult.contentType).toBe('text/csv');
    expect(csvResult.filename).toBe(`workflow-definition-${workflowId}-audit.csv`);

    const csvLines = csvResult.body.split('\n');
    expect(csvLines[0]).toBe(
      'timestamp,event,actor,source,workflow_name,workflow_key,workflow_version,run_status,reason,step_path,action,changed_fields,summary,additional_details,actor_user_id,workflow_id,run_id,record_type,operation,audit_id'
    );
    expect(csvLines[1]).toContain('Workflow published');
    expect(csvLines[1]).toContain('Ava Admin <ava-');
    expect(csvLines[1]).toContain('workflow_designer');
    expect(csvLines[1]).toContain('Quarterly Review');

    const jsonResult = await exportWorkflowAuditLogsAction({
      tableName: 'workflow_definitions',
      recordId: workflowId,
      format: 'json'
    });

    expect(jsonResult.contentType).toBe('application/json');
    expect(jsonResult.filename).toBe(`workflow-definition-${workflowId}-audit.json`);

    const parsed = JSON.parse(jsonResult.body);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].operation).toBe('workflow_definition_publish');
    expect(parsed[0].changed_data.secretRef).toBe('***');
    expect(parsed[0].details.release_notes).toBe('Customer requested rollout');
  });
});
