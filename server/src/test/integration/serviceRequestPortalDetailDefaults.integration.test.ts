import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { getVisiblePublishedServiceRequestDefinitionDetail } from '../../lib/service-requests/portalDetail';

describe('service request portal detail defaults', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('T019: static default values are resolved on first render from the published version snapshot', async () => {
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
      name: 'Onboarding',
      form_schema: { fields: [] },
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
      name: 'Onboarding',
      form_schema_snapshot: {
        fields: [
          { key: 'employee_name', type: 'short-text', label: 'Employee Name', defaultValue: 'Casey Parker' },
          { key: 'needs_laptop', type: 'checkbox', label: 'Needs Laptop', defaultValue: true },
          { key: 'start_date', type: 'date', label: 'Start Date', defaultValue: '2026-04-01' },
          {
            key: 'access_level',
            type: 'select',
            label: 'Access Level',
            defaultValue: 'standard',
            options: [
              { label: 'Standard', value: 'standard' },
              { label: 'Admin', value: 'admin' },
            ],
          },
        ],
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
    expect(detail?.initialValues).toEqual({
      employee_name: 'Casey Parker',
      needs_laptop: true,
      start_date: '2026-04-01',
      access_level: 'standard',
    });
  });
});
