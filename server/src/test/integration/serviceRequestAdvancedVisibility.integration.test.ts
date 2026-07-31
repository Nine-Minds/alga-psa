import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { listVisibleServiceRequestCatalogItems } from '../../lib/service-requests/portalCatalog';
import { submitPortalServiceRequest } from '../../lib/service-requests/submissionService';
import {
  registerServiceRequestProviders,
  resetServiceRequestProviderRegistry,
} from '../../lib/service-requests/providers/registry';
import { getServiceRequestEnterpriseProviderRegistrations } from '../../../../ee/server/src/lib/service-requests/providers';

describe('service request advanced visibility provider', () => {
  let db: Knex;
  const tenantsToCleanup = new Set<string>();
  let tenantColumns: Record<string, unknown>;
  let userColumns: Record<string, unknown>;
  let clientColumns: Record<string, unknown>;

  function hasColumn(columns: Record<string, unknown>, columnName: string): boolean {
    return Object.prototype.hasOwnProperty.call(columns, columnName);
  }

  function tenantTable(tenant: string, table: string) {
    return tenantDb(db, tenant).table(table);
  }

  function tenantRows() {
    return tenantDb(db, '__test_tenant_fixture__')
      .unscoped('tenants', 'test fixture creates and removes tenant rows');
  }

  function schemaTable(table: string) {
    return tenantDb(db, '__test_schema__')
      .unscoped(table, 'columnInfo reads schema metadata, not tenant rows');
  }

  async function cleanupTenant(tenant: string): Promise<void> {
    await tenantTable(tenant, 'service_request_submission_attachments').del();
    await tenantTable(tenant, 'service_request_submissions').del();
    await tenantTable(tenant, 'service_request_definition_versions').del();
    await tenantTable(tenant, 'service_request_definitions').del();
    await tenantTable(tenant, 'clients').del();
    await tenantTable(tenant, 'users').del();
    await tenantRows().where({ tenant }).del();
  }

  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
    tenantColumns = await schemaTable('tenants').columnInfo();
    userColumns = await schemaTable('users').columnInfo();
    clientColumns = await schemaTable('clients').columnInfo();
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

  it('T039: advanced visibility blocks unauthorized clients from catalog listing and direct submit', async () => {
    const tenant = uuidv4();
    tenantsToCleanup.add(tenant);

    const requesterUserId = uuidv4();
    const allowedClientId = uuidv4();
    const deniedClientId = uuidv4();
    const definitionId = uuidv4();
    const versionId = uuidv4();

    await tenantRows().insert({
      tenant,
      ...(hasColumn(tenantColumns, 'company_name')
        ? { company_name: `Tenant ${tenant.slice(0, 8)}` }
        : { client_name: `Tenant ${tenant.slice(0, 8)}` }),
      email: `tenant-${tenant.slice(0, 8)}@example.com`,
      ...(hasColumn(tenantColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(tenantColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    });

    await tenantTable(tenant, 'users').insert({
      tenant,
      user_id: requesterUserId,
      username: `requester-${tenant.slice(0, 8)}`,
      hashed_password: 'not-used',
      ...(hasColumn(userColumns, 'role') ? { role: 'admin' } : {}),
      ...(hasColumn(userColumns, 'email') ? { email: `requester-${tenant.slice(0, 8)}@example.com` } : {}),
      ...(hasColumn(userColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(userColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    });

    await tenantTable(tenant, 'clients').insert([
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
        client_id: deniedClientId,
        client_name: 'Denied Client',
        ...(hasColumn(clientColumns, 'is_inactive') ? { is_inactive: false } : {}),
        ...(hasColumn(clientColumns, 'billing_cycle') ? { billing_cycle: 'monthly' } : {}),
        ...(hasColumn(clientColumns, 'is_tax_exempt') ? { is_tax_exempt: false } : {}),
        ...(hasColumn(clientColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
        ...(hasColumn(clientColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
      },
    ]);

    await tenantTable(tenant, 'service_request_definitions').insert({
      tenant,
      definition_id: definitionId,
      name: 'Restricted Workflow Request',
      form_schema: {
        fields: [{ key: 'request_title', type: 'short-text', label: 'Request Title', required: true }],
      },
      execution_provider: 'workflow-only',
      execution_config: { workflowId: 'wf-restricted' },
      form_behavior_provider: 'basic',
      form_behavior_config: {},
      visibility_provider: 'advanced-visibility',
      visibility_config: {
        allowedClientIds: [allowedClientId],
      },
      lifecycle_state: 'published',
      published_at: db.fn.now(),
    });

    await tenantTable(tenant, 'service_request_definition_versions').insert({
      tenant,
      version_id: versionId,
      definition_id: definitionId,
      version_number: 1,
      name: 'Restricted Workflow Request',
      form_schema_snapshot: {
        fields: [{ key: 'request_title', type: 'short-text', label: 'Request Title', required: true }],
      },
      execution_provider: 'workflow-only',
      execution_config: { workflowId: 'wf-restricted' },
      form_behavior_provider: 'basic',
      form_behavior_config: {},
      visibility_provider: 'advanced-visibility',
      visibility_config: {
        allowedClientIds: [allowedClientId],
      },
    });

    const allowedCatalog = await listVisibleServiceRequestCatalogItems(db, {
      tenant,
      requesterUserId,
      clientId: allowedClientId,
      contactId: null,
    });
    expect(allowedCatalog.map((item) => item.definitionId)).toContain(definitionId);

    const deniedCatalog = await listVisibleServiceRequestCatalogItems(db, {
      tenant,
      requesterUserId,
      clientId: deniedClientId,
      contactId: null,
    });
    expect(deniedCatalog.map((item) => item.definitionId)).not.toContain(definitionId);

    await expect(
      submitPortalServiceRequest({
        knex: db,
        tenant,
        definitionId,
        requesterUserId,
        clientId: deniedClientId,
        payload: {
          request_title: 'Denied Submit',
        },
      })
    ).rejects.toThrow('Service request is not visible or not published');

    const submissions = await tenantTable(tenant, 'service_request_submissions')
      .where({ definition_id: definitionId })
      .select('submission_id');
    expect(submissions).toHaveLength(0);
  });
});
