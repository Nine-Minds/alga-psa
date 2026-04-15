import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { getVisiblePublishedServiceRequestDefinitionDetail } from '../../lib/service-requests/portalDetail';
import { submitPortalServiceRequest } from '../../lib/service-requests/submissionService';
import { validateServiceRequestDefinitionForPublish } from '../../lib/service-requests/definitionValidation';
import {
  registerServiceRequestProviders,
  resetServiceRequestProviderRegistry,
} from '../../lib/service-requests/providers/registry';
import { getServiceRequestEnterpriseProviderRegistrations } from '../../../../ee/server/src/lib/service-requests/providers';

type ColumnInfoMap = Record<string, unknown>;

interface AdvancedFixture {
  tenant: string;
  requesterUserId: string;
  clientId: string;
}

let db: Knex;
let tenantColumns: ColumnInfoMap;
let userColumns: ColumnInfoMap;
let clientColumns: ColumnInfoMap;
const tenantsToCleanup = new Set<string>();

function hasColumn(columns: ColumnInfoMap, columnName: string): boolean {
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

async function createAdvancedFixture(): Promise<AdvancedFixture> {
  const tenant = uuidv4();
  const requesterUserId = uuidv4();
  const clientId = uuidv4();
  tenantsToCleanup.add(tenant);

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
    client_name: `Client ${tenant.slice(0, 8)}`,
    ...(hasColumn(clientColumns, 'is_inactive') ? { is_inactive: false } : {}),
    ...(hasColumn(clientColumns, 'billing_cycle') ? { billing_cycle: 'monthly' } : {}),
    ...(hasColumn(clientColumns, 'is_tax_exempt') ? { is_tax_exempt: false } : {}),
    ...(hasColumn(clientColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(clientColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  return { tenant, requesterUserId, clientId };
}

async function createPublishedAdvancedDefinition(args: {
  tenant: string;
  definitionId: string;
  versionId: string;
  formSchemaSnapshot: Record<string, unknown>;
  formBehaviorConfig: Record<string, unknown>;
}) {
  await db('service_request_definitions').insert({
    tenant: args.tenant,
    definition_id: args.definitionId,
    name: 'Advanced Behavior Request',
    form_schema: args.formSchemaSnapshot,
    execution_provider: 'workflow-only',
    execution_config: { workflowId: 'wf-advanced-form' },
    form_behavior_provider: 'advanced',
    form_behavior_config: args.formBehaviorConfig,
    visibility_provider: 'all-authenticated-client-users',
    visibility_config: {},
    lifecycle_state: 'published',
  });

  await db('service_request_definition_versions').insert({
    tenant: args.tenant,
    version_id: args.versionId,
    definition_id: args.definitionId,
    version_number: 1,
    name: 'Advanced Behavior Request',
    form_schema_snapshot: args.formSchemaSnapshot,
    execution_provider: 'workflow-only',
    execution_config: { workflowId: 'wf-advanced-form' },
    form_behavior_provider: 'advanced',
    form_behavior_config: args.formBehaviorConfig,
    visibility_provider: 'all-authenticated-client-users',
    visibility_config: {},
  });
}

describe('service request advanced form behavior', () => {
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

  it('T036: advanced conditional visibility rules drive field visibility in portal request detail', async () => {
    const fixture = await createAdvancedFixture();
    const definitionId = uuidv4();
    const versionId = uuidv4();

    await createPublishedAdvancedDefinition({
      tenant: fixture.tenant,
      definitionId,
      versionId,
      formSchemaSnapshot: {
        fields: [
          {
            key: 'request_type',
            type: 'select',
            label: 'Request Type',
            required: true,
            defaultValue: 'standard',
            options: [
              { value: 'standard', label: 'Standard' },
              { value: 'hardware', label: 'Hardware' },
            ],
          },
          {
            key: 'hardware_model',
            type: 'short-text',
            label: 'Hardware Model',
            required: false,
          },
        ],
      },
      formBehaviorConfig: {
        visibilityRules: [
          {
            fieldKey: 'hardware_model',
            source: 'payload.request_type',
            operator: 'equals',
            value: 'hardware',
          },
        ],
      },
    });

    const detail = await getVisiblePublishedServiceRequestDefinitionDetail(
      db,
      {
        tenant: fixture.tenant,
        requesterUserId: fixture.requesterUserId,
        clientId: fixture.clientId,
        contactId: null,
      },
      definitionId
    );

    expect(detail).not.toBeNull();
    expect(detail?.initialValues.request_type).toBe('standard');
    expect(detail?.visibleFieldKeys).toContain('request_type');
    expect(detail?.visibleFieldKeys).not.toContain('hardware_model');
  });

  it('T037: required hidden fields do not block submit and invalid advanced conditional config fails publish validation', async () => {
    const fixture = await createAdvancedFixture();
    const definitionId = uuidv4();
    const versionId = uuidv4();

    await createPublishedAdvancedDefinition({
      tenant: fixture.tenant,
      definitionId,
      versionId,
      formSchemaSnapshot: {
        fields: [
          {
            key: 'request_type',
            type: 'select',
            label: 'Request Type',
            required: true,
            options: [
              { value: 'standard', label: 'Standard' },
              { value: 'access', label: 'Access' },
            ],
          },
          {
            key: 'manager_approval',
            type: 'short-text',
            label: 'Manager Approval ID',
            required: true,
          },
        ],
      },
      formBehaviorConfig: {
        visibilityRules: [
          {
            fieldKey: 'manager_approval',
            source: 'payload.request_type',
            operator: 'equals',
            value: 'access',
          },
        ],
      },
    });

    const submitResult = await submitPortalServiceRequest({
      knex: db,
      tenant: fixture.tenant,
      definitionId,
      requesterUserId: fixture.requesterUserId,
      clientId: fixture.clientId,
      payload: {
        request_type: 'standard',
      },
    });

    expect(submitResult.executionStatus).toBe('succeeded');

    const invalidDefinitionId = uuidv4();
    await db('service_request_definitions').insert({
      tenant: fixture.tenant,
      definition_id: invalidDefinitionId,
      name: 'Invalid Advanced Rule Draft',
      form_schema: { fields: [] },
      execution_provider: 'workflow-only',
      execution_config: { workflowId: 'wf-advanced-form' },
      form_behavior_provider: 'advanced',
      form_behavior_config: {
        visibilityRules: [
          {
            fieldKey: 'field_a',
            source: 'payload.toggle',
            operator: 'equals',
          },
        ],
      },
      visibility_provider: 'all-authenticated-client-users',
      visibility_config: {},
      lifecycle_state: 'draft',
    });

    const validation = await validateServiceRequestDefinitionForPublish(
      db,
      fixture.tenant,
      invalidDefinitionId
    );

    expect(validation.isValid).toBe(false);
    expect(validation.errors.some((error) => error.includes('Form behavior:'))).toBe(true);
    expect(validation.errors.some((error) => error.includes('visibilityRules[0].value is required'))).toBe(true);
  });

  it('T038: advanced context-aware defaults resolve requester and client values in portal detail initial values', async () => {
    const fixture = await createAdvancedFixture();
    const definitionId = uuidv4();
    const versionId = uuidv4();

    await createPublishedAdvancedDefinition({
      tenant: fixture.tenant,
      definitionId,
      versionId,
      formSchemaSnapshot: {
        fields: [
          {
            key: 'requester_ref',
            type: 'short-text',
            label: 'Requester Reference',
            required: false,
          },
          {
            key: 'client_ref',
            type: 'short-text',
            label: 'Client Reference',
            required: false,
          },
        ],
      },
      formBehaviorConfig: {
        contextDefaults: {
          requester_ref: '{{requesterUserId}}',
          client_ref: '{{clientId}}',
        },
      },
    });

    const detail = await getVisiblePublishedServiceRequestDefinitionDetail(
      db,
      {
        tenant: fixture.tenant,
        requesterUserId: fixture.requesterUserId,
        clientId: fixture.clientId,
        contactId: null,
      },
      definitionId
    );

    expect(detail).not.toBeNull();
    expect(detail?.initialValues.requester_ref).toBe(fixture.requesterUserId);
    expect(detail?.initialValues.client_ref).toBe(fixture.clientId);
  });
});
