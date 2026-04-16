import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import {
  getServiceRequestSubmissionDetailForDefinition,
  listServiceRequestSubmissionsForDefinition,
} from '../../lib/service-requests/submissionHistory';

describe('service request admin submissions', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('T030: admin can list definition submissions and view payload plus downstream references', async () => {
    const tenant = uuidv4();
    const otherTenant = uuidv4();
    const definitionId = uuidv4();
    const otherDefinitionId = uuidv4();
    const versionId = uuidv4();
    const submissionId = uuidv4();
    const otherSubmissionId = uuidv4();
    const createdTicketId = uuidv4();
    const requesterUserId = uuidv4();
    const clientId = uuidv4();
    const contactId = uuidv4();

    await db('tenants').insert([
      {
        tenant,
        client_name: `Tenant ${tenant.slice(0, 8)}`,
        email: `tenant-${tenant.slice(0, 8)}@example.com`,
      },
      {
        tenant: otherTenant,
        client_name: `Tenant ${otherTenant.slice(0, 8)}`,
        email: `tenant-${otherTenant.slice(0, 8)}@example.com`,
      },
    ]);

    await db('users').insert({
      tenant,
      user_id: requesterUserId,
      username: 'casey.requester',
      hashed_password: 'not-used',
      email: 'casey.requester@example.com',
      first_name: 'Casey',
      last_name: 'Requester',
      user_type: 'internal',
    });

    await db('clients').insert({
      tenant,
      client_id: clientId,
      client_name: 'Emerald City',
    });

    await db('contacts').insert({
      tenant,
      contact_name_id: contactId,
      full_name: 'Casey Parker',
      client_id: clientId,
    });

    await db('tickets').insert({
      tenant,
      ticket_id: createdTicketId,
      ticket_number: 'TIC001036',
      title: 'New Hire Setup: Casey Parker',
      client_id: clientId,
    });

    await db('service_request_definitions').insert([
      {
        tenant,
        definition_id: definitionId,
        name: 'New Hire Onboarding',
        form_schema: { fields: [] },
        execution_provider: 'ticket-only',
        execution_config: {},
        form_behavior_provider: 'basic',
        form_behavior_config: {},
        visibility_provider: 'all-authenticated-client-users',
        visibility_config: {},
        lifecycle_state: 'published',
      },
      {
        tenant,
        definition_id: otherDefinitionId,
        name: 'Access Request',
        form_schema: { fields: [] },
        execution_provider: 'ticket-only',
        execution_config: {},
        form_behavior_provider: 'basic',
        form_behavior_config: {},
        visibility_provider: 'all-authenticated-client-users',
        visibility_config: {},
        lifecycle_state: 'published',
      },
    ]);

    await db('service_request_definition_versions').insert({
      tenant,
      version_id: versionId,
      definition_id: definitionId,
      version_number: 1,
      name: 'New Hire Onboarding',
      form_schema_snapshot: {
        fields: [{ key: 'employee_name', label: 'Employee Name', type: 'short-text' }],
      },
      execution_provider: 'ticket-only',
      execution_config: {},
      form_behavior_provider: 'basic',
      form_behavior_config: {},
      visibility_provider: 'all-authenticated-client-users',
      visibility_config: {},
    });

    await db('service_request_submissions').insert([
      {
        tenant,
        submission_id: submissionId,
        definition_id: definitionId,
        definition_version_id: versionId,
        requester_user_id: requesterUserId,
        client_id: clientId,
        contact_id: contactId,
        request_name: 'New Hire Onboarding',
        submitted_payload: { employee_name: 'Casey Parker', access_level: 'standard' },
        execution_status: 'succeeded',
        created_ticket_id: createdTicketId,
        workflow_execution_id: 'wf_exec_1234',
      },
      {
        tenant,
        submission_id: otherSubmissionId,
        definition_id: otherDefinitionId,
        definition_version_id: versionId,
        requester_user_id: uuidv4(),
        client_id: uuidv4(),
        contact_id: uuidv4(),
        request_name: 'Access Request',
        submitted_payload: { system: 'VPN' },
        execution_status: 'pending',
      },
    ]);

    const definitionSubmissions = await listServiceRequestSubmissionsForDefinition(
      db,
      tenant,
      definitionId
    );

    expect(definitionSubmissions).toHaveLength(1);
    expect(definitionSubmissions[0]).toMatchObject({
      submission_id: submissionId,
      request_name: 'New Hire Onboarding',
      requester_user_id: requesterUserId,
      client_id: clientId,
      contact_id: contactId,
      execution_status: 'succeeded',
      created_ticket_id: createdTicketId,
      workflow_execution_id: 'wf_exec_1234',
    });

    const detail = await getServiceRequestSubmissionDetailForDefinition(
      db,
      tenant,
      definitionId,
      submissionId
    );

    expect(detail).not.toBeNull();
    expect(detail).toMatchObject({
      submission_id: submissionId,
      definition_id: definitionId,
      submitted_payload: {
        employee_name: 'Casey Parker',
        access_level: 'standard',
      },
      requester_user_name: 'Casey Requester',
      client_name: 'Emerald City',
      contact_name: 'Casey Parker',
      created_ticket_display: '#TIC001036 · New Hire Setup: Casey Parker',
      created_ticket_id: createdTicketId,
      workflow_execution_id: 'wf_exec_1234',
    });

    const otherDetail = await getServiceRequestSubmissionDetailForDefinition(
      db,
      tenant,
      definitionId,
      otherSubmissionId
    );
    expect(otherDetail).toBeNull();
  });
});
