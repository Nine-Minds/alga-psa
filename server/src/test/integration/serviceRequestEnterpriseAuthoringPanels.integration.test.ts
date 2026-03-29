import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { getServiceRequestDefinitionEditorData } from '../../lib/service-requests/definitionEditor';
import {
  registerServiceRequestProviders,
  resetServiceRequestProviderRegistry,
} from '../../lib/service-requests/providers/registry';
import { getServiceRequestEnterpriseProviderRegistrations } from '../../../../ee/server/src/lib/service-requests/providers';

describe('service request enterprise authoring panel gating', () => {
  let db: Knex;
  let tenantColumns: Record<string, unknown>;

  function hasColumn(columns: Record<string, unknown>, columnName: string): boolean {
    return Object.prototype.hasOwnProperty.call(columns, columnName);
  }

  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
    tenantColumns = await db('tenants').columnInfo();
  });

  afterAll(async () => {
    resetServiceRequestProviderRegistry();
    if (db) {
      await db.destroy();
    }
  });

  it('T040: provider-specific EE config panels are enabled only when corresponding EE providers are registered', async () => {
    resetServiceRequestProviderRegistry();
    registerServiceRequestProviders(await getServiceRequestEnterpriseProviderRegistrations());

    const tenant = uuidv4();
    const definitionId = uuidv4();

    await db('tenants').insert({
      tenant,
      ...(hasColumn(tenantColumns, 'company_name')
        ? { company_name: `Tenant ${tenant.slice(0, 8)}` }
        : { client_name: `Tenant ${tenant.slice(0, 8)}` }),
      email: `tenant-${tenant.slice(0, 8)}@example.com`,
      ...(hasColumn(tenantColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(tenantColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    });

    await db('service_request_definitions').insert({
      tenant,
      definition_id: definitionId,
      name: 'EE Authoring Panel Request',
      form_schema: { fields: [] },
      execution_provider: 'workflow-only',
      execution_config: { workflowId: 'wf-ee-panel' },
      form_behavior_provider: 'advanced',
      form_behavior_config: {},
      visibility_provider: 'all-authenticated-client-users',
      visibility_config: {},
      lifecycle_state: 'draft',
    });

    const editorData = await getServiceRequestDefinitionEditorData(db, tenant, definitionId);
    expect(editorData).not.toBeNull();

    const executionProviderKeys =
      editorData?.execution.availableExecutionProviders.map((provider) => provider.key) ?? [];
    const formBehaviorProviderKeys =
      editorData?.execution.availableFormBehaviorProviders.map((provider) => provider.key) ?? [];

    expect(executionProviderKeys).toContain('workflow-only');
    expect(formBehaviorProviderKeys).toContain('advanced');
    expect(editorData?.execution.showWorkflowExecutionConfigPanel).toBe(true);
    expect(editorData?.execution.showAdvancedFormBehaviorConfigPanel).toBe(true);
  });

  it('T041: CE authoring hides workflow and advanced-form panels when EE registrations are absent', async () => {
    resetServiceRequestProviderRegistry();

    const tenant = uuidv4();
    const definitionId = uuidv4();

    await db('tenants').insert({
      tenant,
      ...(hasColumn(tenantColumns, 'company_name')
        ? { company_name: `Tenant ${tenant.slice(0, 8)}` }
        : { client_name: `Tenant ${tenant.slice(0, 8)}` }),
      email: `tenant-${tenant.slice(0, 8)}@example.com`,
      ...(hasColumn(tenantColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(tenantColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    });

    await db('service_request_definitions').insert({
      tenant,
      definition_id: definitionId,
      name: 'CE Authoring Panel Request',
      form_schema: { fields: [] },
      execution_provider: 'workflow-only',
      execution_config: { workflowId: 'wf-hidden' },
      form_behavior_provider: 'advanced',
      form_behavior_config: {},
      visibility_provider: 'all-authenticated-client-users',
      visibility_config: {},
      lifecycle_state: 'draft',
    });

    const editorData = await getServiceRequestDefinitionEditorData(db, tenant, definitionId);
    expect(editorData).not.toBeNull();

    const executionProviderKeys =
      editorData?.execution.availableExecutionProviders.map((provider) => provider.key) ?? [];
    const formBehaviorProviderKeys =
      editorData?.execution.availableFormBehaviorProviders.map((provider) => provider.key) ?? [];

    expect(executionProviderKeys).toEqual(['ticket-only']);
    expect(formBehaviorProviderKeys).toEqual(['basic']);
    expect(editorData?.execution.showWorkflowExecutionConfigPanel).toBe(false);
    expect(editorData?.execution.showAdvancedFormBehaviorConfigPanel).toBe(false);
  });
});
