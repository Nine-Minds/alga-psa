import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { getServiceRequestDefinitionEditorData } from '../../lib/service-requests/definitionEditor';
import { publishServiceRequestDefinition } from '../../lib/service-requests/definitionPublishing';

describe('service request definition editor', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('T007: editor data exposes basics, linkage, form, execution, and publish sections with draft-vs-published context', async () => {
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
      name: 'Access Request',
      description: 'Request user and app access',
      icon: 'shield',
      sort_order: 25,
      form_schema: {
        fields: [{ key: 'requested_access', type: 'short-text', label: 'Requested Access' }],
      },
      execution_provider: 'ticket-only',
      execution_config: { boardId: 'security' },
      form_behavior_provider: 'basic',
      form_behavior_config: {},
      visibility_provider: 'all-authenticated-client-users',
      visibility_config: {},
      lifecycle_state: 'draft',
    });

    await publishServiceRequestDefinition({
      knex: db,
      tenant,
      definitionId,
      publishedBy: uuidv4(),
    });

    await db('service_request_definitions').where({ tenant, definition_id: definitionId }).update({
      name: 'Access Request (Draft Revision)',
      execution_config: { boardId: 'security-priority' },
      updated_at: db.fn.now(),
    });

    const editorData = await getServiceRequestDefinitionEditorData(db, tenant, definitionId);

    expect(editorData).not.toBeNull();
    expect(editorData?.basics.name).toBe('Access Request (Draft Revision)');
    expect(editorData?.linkage.linkedServiceId).toBeNull();
    expect((editorData?.form.schema as any).fields).toEqual([
      { key: 'requested_access', type: 'short-text', label: 'Requested Access' },
    ]);
    expect(editorData?.execution.executionProvider).toBe('ticket-only');
    expect(editorData?.execution.executionConfig).toEqual({ boardId: 'security-priority' });
    expect(editorData?.publish.publishedVersionNumber).toBe(1);
    expect(editorData?.publish.publishedAt).toBeTruthy();
  });
});
