import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { publishServiceRequestDefinitionWithValidation } from '../../lib/service-requests/definitionValidation';

describe('service request linked-service publish validation', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('T011: publish allows no linked service and rejects unresolved linked service references', async () => {
    const tenant = uuidv4();
    const actor = uuidv4();
    const noLinkDefinitionId = uuidv4();
    const invalidLinkDefinitionId = uuidv4();
    const staleLinkedServiceId = uuidv4();

    await db('tenants').insert({
      tenant,
      client_name: `Tenant ${tenant.slice(0, 8)}`,
      email: `tenant-${tenant.slice(0, 8)}@example.com`,
    });

    await db('service_request_definitions').insert([
      {
        tenant,
        definition_id: noLinkDefinitionId,
        name: 'No Linked Service',
        linked_service_id: null,
        form_schema: { fields: [] },
        execution_provider: 'ticket-only',
        execution_config: {
          boardId: 'board-123',
          statusId: 'status-123',
          priorityId: 'priority-123',
        },
        form_behavior_provider: 'basic',
        form_behavior_config: {},
        visibility_provider: 'all-authenticated-client-users',
        visibility_config: {},
        lifecycle_state: 'draft',
      },
      {
        tenant,
        definition_id: invalidLinkDefinitionId,
        name: 'Invalid Linked Service',
        linked_service_id: null,
        form_schema: { fields: [] },
        execution_provider: 'ticket-only',
        execution_config: {
          boardId: 'board-456',
          statusId: 'status-456',
          priorityId: 'priority-456',
        },
        form_behavior_provider: 'basic',
        form_behavior_config: {},
        visibility_provider: 'all-authenticated-client-users',
        visibility_config: {},
        lifecycle_state: 'draft',
      },
    ]);

    // Simulate a stale reference from out-of-band corruption/import; normally the FK prevents this.
    await db.schema.raw(`
      ALTER TABLE service_request_definitions
      DROP CONSTRAINT IF EXISTS service_request_definitions_tenant_linked_service_id_foreign
    `);
    await db('service_request_definitions')
      .where({ tenant, definition_id: invalidLinkDefinitionId })
      .update({ linked_service_id: staleLinkedServiceId });

    const published = await publishServiceRequestDefinitionWithValidation({
      knex: db,
      tenant,
      definitionId: noLinkDefinitionId,
      publishedBy: actor,
    });

    expect(published.version_number).toBe(1);

    await expect(
      publishServiceRequestDefinitionWithValidation({
        knex: db,
        tenant,
        definitionId: invalidLinkDefinitionId,
        publishedBy: actor,
      })
    ).rejects.toThrow('Linked service no longer exists');
  });
});
