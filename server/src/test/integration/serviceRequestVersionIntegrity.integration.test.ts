import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { submitPortalServiceRequest } from '../../lib/service-requests/submissionService';
import { getClientServiceRequestSubmissionDetail } from '../../lib/service-requests/submissionHistory';
import {
  registerServiceRequestProviders,
  resetServiceRequestProviderRegistry,
} from '../../lib/service-requests/providers/registry';
import { getServiceRequestEnterpriseProviderRegistrations } from '../../../../ee/server/src/lib/service-requests/providers';

describe('service request version integrity', () => {
  let db: Knex;
  let tenantColumns: Record<string, unknown>;
  let userColumns: Record<string, unknown>;
  let clientColumns: Record<string, unknown>;
  const tenantsToCleanup = new Set<string>();

  function hasColumn(columns: Record<string, unknown>, columnName: string): boolean {
    return Object.prototype.hasOwnProperty.call(columns, columnName);
  }

  async function cleanupTenant(tenant: string): Promise<void> {
    await db('service_request_submission_attachments').where({ tenant }).del();
    await db('service_request_submissions').where({ tenant }).del();
    await db('service_request_definition_versions').where({ tenant }).del();
    await db('service_request_definitions').where({ tenant }).del();
    await db('clients').where({ tenant }).del();
    await db('users').where({ tenant }).del();
    await db('tenants').where({ tenant }).del();
  }

  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
    tenantColumns = await db('tenants').columnInfo();
    userColumns = await db('users').columnInfo();
    clientColumns = await db('clients').columnInfo();
    resetServiceRequestProviderRegistry();
    registerServiceRequestProviders(await getServiceRequestEnterpriseProviderRegistrations());
  });

  afterEach(async () => {
    for (const tenant of tenantsToCleanup) {
      await cleanupTenant(tenant);
      tenantsToCleanup.delete(tenant);
    }
  });

  afterAll(async () => {
    resetServiceRequestProviderRegistry();
    if (db) {
      await db.destroy();
    }
  });

  it('T045: version 1 submissions continue rendering with version 1 field presentation after version 2 is published', async () => {
    const tenant = uuidv4();
    tenantsToCleanup.add(tenant);

    const requesterUserId = uuidv4();
    const clientId = uuidv4();
    const definitionId = uuidv4();
    const version1Id = uuidv4();
    const version2Id = uuidv4();

    await db('tenants').insert({
      tenant,
      ...(hasColumn(tenantColumns, 'company_name')
        ? { company_name: `Tenant ${tenant.slice(0, 8)}` }
        : { client_name: `Tenant ${tenant.slice(0, 8)}` }),
      email: `tenant-${tenant.slice(0, 8)}@example.com`,
      ...(hasColumn(tenantColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(tenantColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    });

    await db('users').insert({
      tenant,
      user_id: requesterUserId,
      username: `requester-${tenant.slice(0, 8)}`,
      hashed_password: 'not-used',
      ...(hasColumn(userColumns, 'role') ? { role: 'admin' } : {}),
      ...(hasColumn(userColumns, 'email') ? { email: `requester-${tenant.slice(0, 8)}@example.com` } : {}),
      ...(hasColumn(userColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(userColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    });

    await db('clients').insert({
      tenant,
      client_id: clientId,
      client_name: 'Version Integrity Client',
      ...(hasColumn(clientColumns, 'is_inactive') ? { is_inactive: false } : {}),
      ...(hasColumn(clientColumns, 'billing_cycle') ? { billing_cycle: 'monthly' } : {}),
      ...(hasColumn(clientColumns, 'is_tax_exempt') ? { is_tax_exempt: false } : {}),
      ...(hasColumn(clientColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(clientColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    });

    await db('service_request_definitions').insert({
      tenant,
      definition_id: definitionId,
      name: 'Versioned Request',
      form_schema: {
        fields: [{ key: 'employee_name', type: 'short-text', label: 'Employee Name', required: true }],
      },
      execution_provider: 'workflow-only',
      execution_config: { workflowId: 'wf-versioned' },
      form_behavior_provider: 'basic',
      form_behavior_config: {},
      visibility_provider: 'all-authenticated-client-users',
      visibility_config: {},
      lifecycle_state: 'published',
    });

    await db('service_request_definition_versions').insert({
      tenant,
      version_id: version1Id,
      definition_id: definitionId,
      version_number: 1,
      name: 'Versioned Request',
      form_schema_snapshot: {
        fields: [{ key: 'employee_name', type: 'short-text', label: 'Employee Name', required: true }],
      },
      execution_provider: 'workflow-only',
      execution_config: { workflowId: 'wf-versioned' },
      form_behavior_provider: 'basic',
      form_behavior_config: {},
      visibility_provider: 'all-authenticated-client-users',
      visibility_config: {},
    });

    const submission = await submitPortalServiceRequest({
      knex: db,
      tenant,
      definitionId,
      requesterUserId,
      clientId,
      payload: {
        employee_name: 'Alice Version One',
      },
    });

    await db('service_request_definitions')
      .where({ tenant, definition_id: definitionId })
      .update({
        form_schema: {
          fields: [{ key: 'employee_full_name', type: 'short-text', label: 'Employee Full Name', required: true }],
        },
        updated_at: db.fn.now(),
      });

    await db('service_request_definition_versions').insert({
      tenant,
      version_id: version2Id,
      definition_id: definitionId,
      version_number: 2,
      name: 'Versioned Request v2',
      form_schema_snapshot: {
        fields: [{ key: 'employee_full_name', type: 'short-text', label: 'Employee Full Name', required: true }],
      },
      execution_provider: 'workflow-only',
      execution_config: { workflowId: 'wf-versioned' },
      form_behavior_provider: 'basic',
      form_behavior_config: {},
      visibility_provider: 'all-authenticated-client-users',
      visibility_config: {},
    });

    const detail = await getClientServiceRequestSubmissionDetail(
      db,
      tenant,
      clientId,
      submission.submissionId
    );

    expect(detail).not.toBeNull();
    expect(detail?.definition_version_id).toBe(version1Id);
    expect(detail?.submitted_payload).toEqual({
      employee_name: 'Alice Version One',
    });

    const fields = Array.isArray((detail?.form_schema_snapshot as any)?.fields)
      ? ((detail?.form_schema_snapshot as any).fields as any[])
      : [];
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      key: 'employee_name',
      label: 'Employee Name',
    });
  });
});
