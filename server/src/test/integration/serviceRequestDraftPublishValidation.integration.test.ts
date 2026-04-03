import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { publishServiceRequestDefinitionWithValidation } from '../../lib/service-requests/definitionValidation';
import { saveServiceRequestDefinitionDraft } from '../../lib/service-requests/definitionManagement';

describe('service request draft save and publish validation', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('T008: incomplete drafts save successfully while publish is blocked by validation errors', async () => {
    const tenant = uuidv4();
    const definitionId = uuidv4();
    const actor = uuidv4();

    await db('tenants').insert({
      tenant,
      client_name: `Tenant ${tenant.slice(0, 8)}`,
      email: `tenant-${tenant.slice(0, 8)}@example.com`,
    });

    await db('service_request_definitions').insert({
      tenant,
      definition_id: definitionId,
      name: 'Draft Only',
      description: null,
      form_schema: { fields: [] },
      execution_provider: 'missing-provider',
      execution_config: {},
      form_behavior_provider: 'basic',
      form_behavior_config: {},
      visibility_provider: 'all-authenticated-client-users',
      visibility_config: {},
      lifecycle_state: 'draft',
    });

    const savedDraft = await saveServiceRequestDefinitionDraft({
      knex: db,
      tenant,
      definitionId,
      updatedBy: actor,
      updates: {
        description: 'Saved as incomplete draft',
      },
    });

    expect(savedDraft.lifecycle_state).toBe('draft');
    expect(savedDraft.description).toBe('Saved as incomplete draft');

    await expect(
      publishServiceRequestDefinitionWithValidation({
        knex: db,
        tenant,
        definitionId,
        publishedBy: actor,
      })
    ).rejects.toThrow('Publish validation failed');
  });

  it('keeps an already-published definition live while draft edits are saved', async () => {
    const tenant = uuidv4();
    const definitionId = uuidv4();
    const versionId = uuidv4();
    const actor = uuidv4();
    const publishedAt = new Date('2026-03-29T10:00:00.000Z');

    await db('tenants').insert({
      tenant,
      client_name: `Tenant ${tenant.slice(0, 8)}`,
      email: `tenant-${tenant.slice(0, 8)}@example.com`,
    });

    await db('service_request_definitions').insert({
      tenant,
      definition_id: definitionId,
      name: 'Published Request',
      description: 'Visible description',
      form_schema: { fields: [] },
      execution_provider: 'ticket-only',
      execution_config: {},
      form_behavior_provider: 'basic',
      form_behavior_config: {},
      visibility_provider: 'all-authenticated-client-users',
      visibility_config: {},
      lifecycle_state: 'published',
      published_by: actor,
      published_at: publishedAt,
    });

    await db('service_request_definition_versions').insert({
      tenant,
      version_id: versionId,
      definition_id: definitionId,
      version_number: 1,
      name: 'Published Request',
      description: 'Visible description',
      form_schema_snapshot: { fields: [] },
      execution_provider: 'ticket-only',
      execution_config: {},
      form_behavior_provider: 'basic',
      form_behavior_config: {},
      visibility_provider: 'all-authenticated-client-users',
      visibility_config: {},
      published_by: actor,
      published_at: publishedAt,
    });

    const savedDraft = await saveServiceRequestDefinitionDraft({
      knex: db,
      tenant,
      definitionId,
      updatedBy: actor,
      updates: {
        description: 'Edited draft description',
      },
    });

    expect(savedDraft.lifecycle_state).toBe('published');
    expect(savedDraft.published_by).toBe(actor);
    expect(new Date(savedDraft.published_at as Date).toISOString()).toBe(
      publishedAt.toISOString()
    );
    expect(savedDraft.description).toBe('Edited draft description');
  });
});
