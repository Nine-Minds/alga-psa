import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { publishServiceRequestDefinition } from '../../lib/service-requests/definitionPublishing';

describe('service request definition publishing', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('T002: publishing snapshots immutable versions while incrementing definition-scoped version numbers', async () => {
    const tenant = uuidv4();
    const definitionId = uuidv4();
    const publisher = uuidv4();

    await db('tenants').insert({
      tenant,
      client_name: `Tenant ${tenant.slice(0, 8)}`,
      email: `tenant-${tenant.slice(0, 8)}@example.com`,
    });

    await db('service_request_definitions').insert({
      tenant,
      definition_id: definitionId,
      name: 'New Hire Intake',
      description: 'Collect onboarding details',
      form_schema: {
        fields: [{ key: 'employee_name', type: 'short-text', label: 'Employee Name' }],
      },
      execution_provider: 'ticket-only',
      execution_config: { boardId: 'board-a' },
      form_behavior_provider: 'basic',
      form_behavior_config: {},
      visibility_provider: 'all-authenticated-client-users',
      visibility_config: {},
      lifecycle_state: 'draft',
    });

    const publishedV1 = await publishServiceRequestDefinition({
      knex: db,
      tenant,
      definitionId,
      publishedBy: publisher,
    });

    await db('service_request_definitions').where({ tenant, definition_id: definitionId }).update({
      name: 'New Hire Intake (Revised)',
      form_schema: {
        fields: [
          { key: 'employee_name', type: 'short-text', label: 'Employee Name' },
          { key: 'start_date', type: 'date', label: 'Start Date' },
        ],
      },
      execution_config: { boardId: 'board-b' },
      updated_at: db.fn.now(),
    });

    const publishedV2 = await publishServiceRequestDefinition({
      knex: db,
      tenant,
      definitionId,
      publishedBy: publisher,
    });

    const allVersions = await db('service_request_definition_versions')
      .where({ tenant, definition_id: definitionId })
      .orderBy('version_number', 'asc')
      .select('version_number', 'name', 'form_schema_snapshot', 'execution_config', 'published_by');

    expect(publishedV1.version_number).toBe(1);
    expect(publishedV2.version_number).toBe(2);
    expect(allVersions).toHaveLength(2);

    expect(allVersions[0]).toMatchObject({
      version_number: 1,
      name: 'New Hire Intake',
      execution_config: { boardId: 'board-a' },
      published_by: publisher,
    });
    expect((allVersions[0].form_schema_snapshot as any).fields).toEqual([
      { key: 'employee_name', type: 'short-text', label: 'Employee Name' },
    ]);

    expect(allVersions[1]).toMatchObject({
      version_number: 2,
      name: 'New Hire Intake (Revised)',
      execution_config: { boardId: 'board-b' },
      published_by: publisher,
    });
    expect((allVersions[1].form_schema_snapshot as any).fields).toEqual([
      { key: 'employee_name', type: 'short-text', label: 'Employee Name' },
      { key: 'start_date', type: 'date', label: 'Start Date' },
    ]);
  });
});
