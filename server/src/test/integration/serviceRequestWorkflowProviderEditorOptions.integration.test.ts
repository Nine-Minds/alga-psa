import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { getServiceRequestDefinitionEditorData } from '../../lib/service-requests/definitionEditor';
import { getServiceRequestEnterpriseProviderRegistrations } from '../../../../ee/server/src/lib/service-requests/providers';
import {
  registerServiceRequestProviders,
  resetServiceRequestProviderRegistry,
} from '../../lib/service-requests/providers/registry';

describe('service request workflow provider editor options', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
    resetServiceRequestProviderRegistry();
    registerServiceRequestProviders(await getServiceRequestEnterpriseProviderRegistrations());
  });

  afterAll(async () => {
    resetServiceRequestProviderRegistry();
    if (db) {
      await db.destroy();
    }
  });

  it('T031: EE startup exposes workflow-only and ticket-plus-workflow execution modes to editor option surfaces', async () => {
    const tenant = uuidv4();
    const definitionId = uuidv4();

    await db('tenants').insert({
      tenant,
      client_name: `Tenant ${tenant.slice(0, 8)}`,
      email: `tenant-${tenant.slice(0, 8)}@example.com`,
    });

    await db('service_request_definitions').insert({
      tenant,
      definition_id: definitionId,
      name: 'Workflow-capable Request',
      form_schema: { fields: [] },
      execution_provider: 'ticket-only',
      execution_config: {},
      form_behavior_provider: 'basic',
      form_behavior_config: {},
      visibility_provider: 'all-authenticated-client-users',
      visibility_config: {},
      lifecycle_state: 'draft',
    });

    const editorData = await getServiceRequestDefinitionEditorData(db, tenant, definitionId);
    expect(editorData).not.toBeNull();

    const executionProviderKeys =
      editorData?.execution.availableExecutionProviders.map((provider) => provider.key) ?? [];

    expect(executionProviderKeys).toContain('ticket-only');
    expect(executionProviderKeys).toContain('workflow-only');
    expect(executionProviderKeys).toContain('ticket-plus-workflow');
  });
});
