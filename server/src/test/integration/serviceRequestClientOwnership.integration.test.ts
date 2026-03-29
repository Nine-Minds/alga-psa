import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { submitPortalServiceRequest } from '../../lib/service-requests/submissionService';
import {
  getClientServiceRequestSubmissionDetail,
  listClientServiceRequestSubmissions,
} from '../../lib/service-requests/submissionHistory';
import {
  registerServiceRequestProviders,
  resetServiceRequestProviderRegistry,
} from '../../lib/service-requests/providers/registry';
import { getServiceRequestEnterpriseProviderRegistrations } from '../../../../ee/server/src/lib/service-requests/providers';

describe('service request client ownership and attachment authorization', () => {
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

  it('T042/T043: list/detail/submit/attachment access all enforce authenticated client ownership boundaries', async () => {
    const tenant = uuidv4();
    tenantsToCleanup.add(tenant);

    const requesterUserId = uuidv4();
    const allowedClientId = uuidv4();
    const otherClientId = uuidv4();
    const definitionId = uuidv4();
    const versionId = uuidv4();

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

    await db('clients').insert([
      {
        tenant,
        client_id: allowedClientId,
        client_name: 'Allowed Client',
        ...(hasColumn(clientColumns, 'is_inactive') ? { is_inactive: false } : {}),
        ...(hasColumn(clientColumns, 'billing_cycle') ? { billing_cycle: 'monthly' } : {}),
        ...(hasColumn(clientColumns, 'is_tax_exempt') ? { is_tax_exempt: false } : {}),
        ...(hasColumn(clientColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
        ...(hasColumn(clientColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
      },
      {
        tenant,
        client_id: otherClientId,
        client_name: 'Other Client',
        ...(hasColumn(clientColumns, 'is_inactive') ? { is_inactive: false } : {}),
        ...(hasColumn(clientColumns, 'billing_cycle') ? { billing_cycle: 'monthly' } : {}),
        ...(hasColumn(clientColumns, 'is_tax_exempt') ? { is_tax_exempt: false } : {}),
        ...(hasColumn(clientColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
        ...(hasColumn(clientColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
      },
    ]);

    const formSchemaSnapshot = {
      fields: [
        { key: 'request_title', type: 'short-text', label: 'Request Title', required: true },
        { key: 'supporting_file', type: 'file-upload', label: 'Supporting File', required: true },
      ],
    };

    await db('service_request_definitions').insert({
      tenant,
      definition_id: definitionId,
      name: 'Client-Scoped Request',
      form_schema: formSchemaSnapshot,
      execution_provider: 'workflow-only',
      execution_config: { workflowId: 'wf-client-scope' },
      form_behavior_provider: 'basic',
      form_behavior_config: {},
      visibility_provider: 'advanced-visibility',
      visibility_config: {
        allowedClientIds: [allowedClientId],
      },
      lifecycle_state: 'published',
    });

    await db('service_request_definition_versions').insert({
      tenant,
      version_id: versionId,
      definition_id: definitionId,
      version_number: 1,
      name: 'Client-Scoped Request',
      form_schema_snapshot: formSchemaSnapshot,
      execution_provider: 'workflow-only',
      execution_config: { workflowId: 'wf-client-scope' },
      form_behavior_provider: 'basic',
      form_behavior_config: {},
      visibility_provider: 'advanced-visibility',
      visibility_config: {
        allowedClientIds: [allowedClientId],
      },
    });

    await expect(
      submitPortalServiceRequest({
        knex: db,
        tenant,
        definitionId,
        requesterUserId,
        clientId: otherClientId,
        payload: {
          request_title: 'Forbidden Request',
        },
        attachments: [
          {
            fieldKey: 'supporting_file',
            fileId: uuidv4(),
          },
        ],
      })
    ).rejects.toThrow('Service request is not visible or not published');

    const submitResult = await submitPortalServiceRequest({
      knex: db,
      tenant,
      definitionId,
      requesterUserId,
      clientId: allowedClientId,
      payload: {
        request_title: 'Allowed Request',
      },
      attachments: [
        {
          fieldKey: 'supporting_file',
          fileId: uuidv4(),
          fileName: 'notes.txt',
        },
      ],
    });

    const allowedList = await listClientServiceRequestSubmissions(db, tenant, allowedClientId);
    const otherList = await listClientServiceRequestSubmissions(db, tenant, otherClientId);
    expect(allowedList.map((row) => row.submission_id)).toContain(submitResult.submissionId);
    expect(otherList).toHaveLength(0);

    const allowedDetail = await getClientServiceRequestSubmissionDetail(
      db,
      tenant,
      allowedClientId,
      submitResult.submissionId
    );
    const deniedDetail = await getClientServiceRequestSubmissionDetail(
      db,
      tenant,
      otherClientId,
      submitResult.submissionId
    );

    expect(allowedDetail).not.toBeNull();
    expect(allowedDetail?.attachments).toHaveLength(1);
    expect(allowedDetail?.attachments[0].file_name).toBe('notes.txt');
    expect(deniedDetail).toBeNull();
  });
});
