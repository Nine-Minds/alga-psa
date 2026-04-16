import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { publishServiceRequestDefinition } from '../../lib/service-requests/definitionPublishing';
import { saveServiceRequestDefinitionDraft } from '../../lib/service-requests/definitionManagement';
import {
  archiveServiceRequestDefinition,
  createDraftFromLatestPublishedVersion,
  listPublishedServiceRequestDefinitions,
  unarchiveServiceRequestDefinition,
} from '../../lib/service-requests/definitionLifecycle';
import { getVisiblePublishedServiceRequestDefinitionDetail } from '../../lib/service-requests/portalDetail';

describe('service request definition lifecycle', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('T003: archiving preserves versions/submissions while removing definition from published discovery', async () => {
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
      form_schema: { fields: [{ key: 'requested_access', type: 'short-text' }] },
      lifecycle_state: 'draft',
    });

    const published = await publishServiceRequestDefinition({
      knex: db,
      tenant,
      definitionId,
    });

    await db('service_request_submissions').insert({
      tenant,
      submission_id: uuidv4(),
      definition_id: definitionId,
      definition_version_id: published.version_id,
      client_id: uuidv4(),
      request_name: 'Access Request',
      submitted_payload: { requested_access: 'CRM Admin' },
      execution_status: 'pending',
    });

    await archiveServiceRequestDefinition(db, tenant, definitionId);

    const publishedAfterArchive = await listPublishedServiceRequestDefinitions(db, tenant);
    expect(publishedAfterArchive).toHaveLength(0);

    const storedVersions = await db('service_request_definition_versions')
      .where({ tenant, definition_id: definitionId })
      .count<{ count: string }[]>('* as count');
    const storedSubmissions = await db('service_request_submissions')
      .where({ tenant, definition_id: definitionId })
      .count<{ count: string }[]>('* as count');

    expect(Number(storedVersions[0].count)).toBe(1);
    expect(Number(storedSubmissions[0].count)).toBe(1);
  });

  it('unarchiving a previously archived definition clears the live publication marker until republished', async () => {
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
      name: 'Archive / Unarchive Request',
      form_schema: { fields: [] },
      execution_provider: 'ticket-only',
      execution_config: {},
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
    });

    await archiveServiceRequestDefinition(db, tenant, definitionId);
    await unarchiveServiceRequestDefinition(db, tenant, definitionId);

    const definition = await db('service_request_definitions')
      .where({ tenant, definition_id: definitionId })
      .first('lifecycle_state', 'published_at', 'published_by');

    expect(definition).toMatchObject({
      lifecycle_state: 'draft',
      published_at: null,
      published_by: null,
    });

    const liveDefinitions = await listPublishedServiceRequestDefinitions(db, tenant);
    expect(liveDefinitions.map((item) => item.definition_id)).not.toContain(definitionId);
  });

  it('T046: creating a draft from published and republishing yields version 2 while preserving version 1', async () => {
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
      name: 'Hardware Request',
      form_schema: { fields: [{ key: 'device_type', type: 'short-text' }] },
      lifecycle_state: 'draft',
      execution_provider: 'ticket-only',
      execution_config: { boardId: 'hardware' },
      form_behavior_provider: 'basic',
      form_behavior_config: {},
      visibility_provider: 'all-authenticated-client-users',
      visibility_config: {},
    });

    const v1 = await publishServiceRequestDefinition({
      knex: db,
      tenant,
      definitionId,
    });

    await createDraftFromLatestPublishedVersion(db, tenant, definitionId);

    await db('service_request_definitions').where({ tenant, definition_id: definitionId }).update({
      name: 'Hardware Request (Revised)',
      execution_config: { boardId: 'hardware-priority' },
      updated_at: db.fn.now(),
    });

    const v2 = await publishServiceRequestDefinition({
      knex: db,
      tenant,
      definitionId,
    });

    const versions = await db('service_request_definition_versions')
      .where({ tenant, definition_id: definitionId })
      .orderBy('version_number', 'asc')
      .select('version_number', 'name', 'execution_config');

    expect(v1.version_number).toBe(1);
    expect(v2.version_number).toBe(2);
    expect(versions).toEqual([
      {
        version_number: 1,
        name: 'Hardware Request',
        execution_config: { boardId: 'hardware' },
      },
      {
        version_number: 2,
        name: 'Hardware Request (Revised)',
        execution_config: { boardId: 'hardware-priority' },
      },
    ]);
  });

  it('saving a published definition creates draft changes while the published version remains live', async () => {
    const tenant = uuidv4();
    const definitionId = uuidv4();
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
      name: 'Account Access',
      description: 'Published description',
      form_schema: {
        fields: [{ key: 'requested_access', type: 'short-text', label: 'Requested Access' }],
      },
      execution_provider: 'ticket-only',
      execution_config: {},
      form_behavior_provider: 'basic',
      form_behavior_config: {},
      visibility_provider: 'all-authenticated-client-users',
      visibility_config: {},
      lifecycle_state: 'draft',
    });

    const published = await publishServiceRequestDefinition({
      knex: db,
      tenant,
      definitionId,
    });

    const savedDraft = await saveServiceRequestDefinitionDraft({
      knex: db,
      tenant,
      definitionId,
      updates: {
        name: 'Account Access (Draft Changes)',
        description: 'Draft-only description',
      },
    });

    expect(savedDraft.lifecycle_state).toBe('draft');
    expect(savedDraft.name).toBe('Account Access (Draft Changes)');
    expect(savedDraft.published_at).toBeTruthy();

    const liveDefinitions = await listPublishedServiceRequestDefinitions(db, tenant);
    expect(liveDefinitions.map((definition) => definition.definition_id)).toContain(definitionId);

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
    expect(detail?.versionId).toBe(published.version_id);
    expect(detail?.title).toBe('Account Access');
    expect(detail?.description).toBe('Published description');
  });
});
