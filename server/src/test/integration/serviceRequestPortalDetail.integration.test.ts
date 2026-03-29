import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { getVisiblePublishedServiceRequestDefinitionDetail } from '../../lib/service-requests/portalDetail';

describe('service request portal detail', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('T018: detail view resolves immutable published version snapshot rather than mutable draft schema', async () => {
    const tenant = uuidv4();
    const definitionId = uuidv4();
    const versionId = uuidv4();
    const requesterUserId = uuidv4();
    const clientId = uuidv4();

    await db('tenants').insert({
      tenant,
      client_name: `Tenant ${tenant.slice(0, 8)}`,
      email: `tenant-${tenant.slice(0, 8)}@example.com`,
    });

    await db('service_request_definitions').insert({
      tenant,
      definition_id: definitionId,
      name: 'Draft Name Changed',
      description: 'Draft description that should not be shown on published detail.',
      icon: 'pencil',
      sort_order: 0,
      form_schema: {
        fields: [{ key: 'draft_only_field', label: 'Draft Only', type: 'short-text' }],
      },
      execution_provider: 'ticket-only',
      execution_config: {},
      form_behavior_provider: 'basic',
      form_behavior_config: {},
      visibility_provider: 'all-authenticated-client-users',
      visibility_config: {},
      lifecycle_state: 'published',
    });

    await db('service_request_definition_versions').insert({
      tenant,
      version_id: versionId,
      definition_id: definitionId,
      version_number: 1,
      name: 'Published Name',
      description: 'Published snapshot description',
      icon: 'rocket',
      form_schema_snapshot: {
        fields: [{ key: 'published_field', label: 'Published Field', type: 'short-text' }],
      },
      execution_provider: 'ticket-only',
      execution_config: {},
      form_behavior_provider: 'basic',
      form_behavior_config: {},
      visibility_provider: 'all-authenticated-client-users',
      visibility_config: {},
    });

    const detail = await getVisiblePublishedServiceRequestDefinitionDetail(
      db,
      {
        tenant,
        requesterUserId,
        clientId,
        contactId: null,
      },
      definitionId
    );

    expect(detail).not.toBeNull();
    expect(detail).toMatchObject({
      definitionId,
      versionId,
      versionNumber: 1,
      title: 'Published Name',
      description: 'Published snapshot description',
      icon: 'rocket',
    });
    expect((detail?.formSchema as any).fields).toEqual([
      { key: 'published_field', label: 'Published Field', type: 'short-text' },
    ]);
  });
});
