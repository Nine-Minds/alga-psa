import { createRequire } from 'node:module';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { listVisibleServiceRequestCatalogItems } from '../../lib/service-requests/portalCatalog';
import { getVisiblePublishedServiceRequestDefinitionDetail } from '../../lib/service-requests/portalDetail';
import { saveServiceRequestDefinitionAudience } from '../../lib/service-requests/definitionManagement';
import { submitPortalServiceRequest } from '../../lib/service-requests/submissionService';
import {
  registerServiceRequestProviders,
  resetServiceRequestProviderRegistry,
} from '../../lib/service-requests/providers/registry';
import { getServiceRequestEnterpriseProviderRegistrations } from '../../../../ee/server/src/lib/service-requests/providers';

const require = createRequire(import.meta.url);
const migration = require('../../../migrations/20261028101041_convert_service_request_advanced_visibility.cjs');

describe('service request advanced visibility migration', () => {
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

  it('uses the published rather than draft configuration for catalog and submit', async () => {
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
      user_type: 'client',
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
      visibility_provider: 'all-authenticated-client-users',
      visibility_config: {
        allowedClientIds: [deniedClientId],
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
        allowedRequesterUserIds: [requesterUserId],
      },
    });

    await migration.up(db);
    const converted = await tenantTable(tenant, 'service_request_definitions').where({ definition_id: definitionId }).first('audience');
    await saveServiceRequestDefinitionAudience({ knex: db, tenant, definitionId, audience: converted.audience });
    const allowedCatalog = await listVisibleServiceRequestCatalogItems(db, {
      tenant,
      requesterUserId,
      clientId: allowedClientId,
      contactId: null,
    });
    expect(allowedCatalog.map((item) => item.definitionId)).toContain(definitionId);

    expect(await getVisiblePublishedServiceRequestDefinitionDetail(db, {
      tenant, requesterUserId: uuidv4(), clientId: allowedClientId, contactId: null,
    }, definitionId)).toBeNull();

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
  it('audience scoping and advanced visibility combine as AND', async () => {
    const tenant = uuidv4();
    tenantsToCleanup.add(tenant);
    const requesterUserId = uuidv4();
    const [clientA, clientB, clientC] = [uuidv4(), uuidv4(), uuidv4()];
    const definitionId = uuidv4();

    await tenantRows().insert({
      tenant,
      ...(hasColumn(tenantColumns, 'company_name')
        ? { company_name: `Tenant ${tenant.slice(0, 8)}` }
        : { client_name: `Tenant ${tenant.slice(0, 8)}` }),
      email: `tenant-${tenant.slice(0, 8)}@example.com`,
    });
    await tenantTable(tenant, 'users').insert({
      tenant,
      user_id: requesterUserId,
      username: `requester-${tenant.slice(0, 8)}`,
      user_type: 'client',
      hashed_password: 'not-used',
      ...(hasColumn(userColumns, 'email') ? { email: `requester-${tenant.slice(0, 8)}@example.com` } : {}),
    });
    for (const [id, name] of [[clientA, 'A'], [clientB, 'B'], [clientC, 'C']] as const) {
      await tenantTable(tenant, 'clients').insert({
        tenant,
        client_id: id,
        client_name: `Client ${name}`,
        ...(hasColumn(clientColumns, 'is_inactive') ? { is_inactive: false } : {}),
        ...(hasColumn(clientColumns, 'billing_cycle') ? { billing_cycle: 'monthly' } : {}),
        ...(hasColumn(clientColumns, 'is_tax_exempt') ? { is_tax_exempt: false } : {}),
      });
    }
    const schema = { fields: [{ key: 'request_title', type: 'short-text', label: 'Request Title', required: true }] };
    const provider = {
      form_schema: schema,
      execution_provider: 'store-only',
      execution_config: {},
      form_behavior_provider: 'basic',
      form_behavior_config: {},
      visibility_provider: 'advanced-visibility',
      visibility_config: { allowedClientIds: [clientA, clientB] },
    };
    await tenantTable(tenant, 'service_request_definitions').insert({
      tenant,
      definition_id: definitionId,
      name: 'AND Request',
      ...provider,
      lifecycle_state: 'published',
      published_at: db.fn.now(),
    });
    await tenantTable(tenant, 'service_request_definition_versions').insert({
      tenant,
      version_id: uuidv4(),
      definition_id: definitionId,
      version_number: 1,
      name: 'AND Request',
      form_schema_snapshot: schema,
      execution_provider: 'store-only',
      execution_config: {},
      form_behavior_provider: 'basic',
      form_behavior_config: {},
      visibility_provider: 'advanced-visibility',
      visibility_config: { allowedClientIds: [clientA, clientB] },
    });
    // Audience admits A and C; advanced admits A and B. Only A passes both.
    await saveServiceRequestDefinitionAudience({
      knex: db,
      tenant,
      definitionId,
      audience: { join: 'or', clauses: [clientA, clientC].map((id) => ({ path: 'client.id', operator: 'in', value: [id] })) },
    });

    await migration.up(db);

    const visibleTo = async (clientId: string) => ({
      catalog: (
        await listVisibleServiceRequestCatalogItems(db, { tenant, requesterUserId, clientId })
      ).some((item) => item.definitionId === definitionId),
      detail:
        (await getVisiblePublishedServiceRequestDefinitionDetail(
          db,
          { tenant, requesterUserId, clientId },
          definitionId
        )) !== null,
    });
    expect(await visibleTo(clientA)).toEqual({ catalog: true, detail: true });
    expect(await visibleTo(clientB)).toEqual({ catalog: false, detail: false }); // advanced ok, audience denies
    expect(await visibleTo(clientC)).toEqual({ catalog: false, detail: false }); // audience ok, advanced denies

    await expect(
      submitPortalServiceRequest({
        knex: db,
        tenant,
        definitionId,
        requesterUserId,
        clientId: clientB,
        payload: { request_title: 'nope' },
      })
    ).rejects.toThrow('not visible');
  });
});
