import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

describe('service request domain tables', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('T001: draft -> publish v1 -> submission persists with tenant scoping', async () => {
    const tenantA = uuidv4();
    const tenantB = uuidv4();
    const definitionA = uuidv4();
    const definitionB = uuidv4();
    const versionA = uuidv4();
    const versionB = uuidv4();
    const submissionA = uuidv4();
    const submissionB = uuidv4();

    await db('tenants').insert([
      {
        tenant: tenantA,
        client_name: `Tenant ${tenantA.slice(0, 8)}`,
        email: `tenant-${tenantA.slice(0, 8)}@example.com`,
      },
      {
        tenant: tenantB,
        client_name: `Tenant ${tenantB.slice(0, 8)}`,
        email: `tenant-${tenantB.slice(0, 8)}@example.com`,
      },
    ]);

    await db('service_request_definitions').insert([
      {
        tenant: tenantA,
        definition_id: definitionA,
        name: 'New Hire Intake',
        description: 'Collect onboarding details',
        form_schema: { fields: [{ key: 'employee_name', type: 'short-text' }] },
        lifecycle_state: 'draft',
      },
      {
        tenant: tenantB,
        definition_id: definitionB,
        name: 'Hardware Request',
        description: 'Collect hardware details',
        form_schema: { fields: [{ key: 'device_type', type: 'short-text' }] },
        lifecycle_state: 'draft',
      },
    ]);

    await db('service_request_definition_versions').insert([
      {
        tenant: tenantA,
        version_id: versionA,
        definition_id: definitionA,
        version_number: 1,
        name: 'New Hire Intake',
        description: 'Collect onboarding details',
        form_schema_snapshot: { fields: [{ key: 'employee_name', type: 'short-text' }] },
        execution_provider: 'ticket-only',
        form_behavior_provider: 'basic',
        visibility_provider: 'all-authenticated-client-users',
      },
      {
        tenant: tenantB,
        version_id: versionB,
        definition_id: definitionB,
        version_number: 1,
        name: 'Hardware Request',
        description: 'Collect hardware details',
        form_schema_snapshot: { fields: [{ key: 'device_type', type: 'short-text' }] },
        execution_provider: 'ticket-only',
        form_behavior_provider: 'basic',
        visibility_provider: 'all-authenticated-client-users',
      },
    ]);

    await db('service_request_definitions').where({ tenant: tenantA, definition_id: definitionA }).update({
      lifecycle_state: 'published',
      published_at: db.fn.now(),
    });

    await db('service_request_submissions').insert([
      {
        tenant: tenantA,
        submission_id: submissionA,
        definition_id: definitionA,
        definition_version_id: versionA,
        client_id: uuidv4(),
        request_name: 'New Hire Intake',
        submitted_payload: { employee_name: 'Jane Doe' },
        execution_status: 'pending',
      },
      {
        tenant: tenantB,
        submission_id: submissionB,
        definition_id: definitionB,
        definition_version_id: versionB,
        client_id: uuidv4(),
        request_name: 'Hardware Request',
        submitted_payload: { device_type: 'Laptop' },
        execution_status: 'pending',
      },
    ]);

    const tenantASubmissions = await db('service_request_submissions')
      .where({ tenant: tenantA })
      .select('submission_id', 'definition_id', 'definition_version_id', 'request_name', 'execution_status');

    expect(tenantASubmissions).toHaveLength(1);
    expect(tenantASubmissions[0]).toMatchObject({
      submission_id: submissionA,
      definition_id: definitionA,
      definition_version_id: versionA,
      request_name: 'New Hire Intake',
      execution_status: 'pending',
    });

    const tenantAVersions = await db('service_request_definition_versions')
      .where({ tenant: tenantA, definition_id: definitionA })
      .select('version_number', 'name');

    expect(tenantAVersions).toEqual([
      {
        version_number: 1,
        name: 'New Hire Intake',
      },
    ]);
  });
});
