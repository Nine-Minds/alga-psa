import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import {
  getClientServiceRequestSubmissionDetail,
  listClientServiceRequestSubmissions,
} from '../../lib/service-requests/submissionHistory';

describe('service request portal history', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('T024: My Requests list/detail are client-scoped and include submitted answers via version snapshot fields', async () => {
    const tenant = uuidv4();
    const definitionId = uuidv4();
    const versionId = uuidv4();
    const clientA = uuidv4();
    const clientB = uuidv4();
    const submissionA = uuidv4();
    const submissionB = uuidv4();

    await db('tenants').insert({
      tenant,
      client_name: `Tenant ${tenant.slice(0, 8)}`,
      email: `tenant-${tenant.slice(0, 8)}@example.com`,
    });

    await db('service_request_definitions').insert({
      tenant,
      definition_id: definitionId,
      name: 'Account Access Request',
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
      name: 'Account Access Request',
      form_schema_snapshot: {
        fields: [
          { key: 'system_name', label: 'System Name', type: 'short-text', required: true },
          { key: 'access_level', label: 'Access Level', type: 'short-text', required: true },
        ],
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
        submission_id: submissionA,
        definition_id: definitionId,
        definition_version_id: versionId,
        requester_user_id: uuidv4(),
        client_id: clientA,
        contact_id: uuidv4(),
        request_name: 'Account Access Request',
        submitted_payload: { system_name: 'CRM', access_level: 'Read' },
        execution_status: 'succeeded',
      },
      {
        tenant,
        submission_id: submissionB,
        definition_id: definitionId,
        definition_version_id: versionId,
        requester_user_id: uuidv4(),
        client_id: clientB,
        contact_id: uuidv4(),
        request_name: 'Account Access Request',
        submitted_payload: { system_name: 'Payroll', access_level: 'Admin' },
        execution_status: 'pending',
      },
    ]);

    const listForClientA = await listClientServiceRequestSubmissions(db, tenant, clientA);
    expect(listForClientA).toHaveLength(1);
    expect(listForClientA[0]).toMatchObject({
      submission_id: submissionA,
      request_name: 'Account Access Request',
      execution_status: 'succeeded',
    });

    const detailForClientA = await getClientServiceRequestSubmissionDetail(db, tenant, clientA, submissionA);
    expect(detailForClientA).toBeTruthy();
    expect(detailForClientA).toMatchObject({
      submission_id: submissionA,
      request_name: 'Account Access Request',
      submitted_payload: { system_name: 'CRM', access_level: 'Read' },
    });
    expect(Array.isArray((detailForClientA?.form_schema_snapshot as any)?.fields)).toBe(true);
    expect((detailForClientA?.form_schema_snapshot as any).fields[0]).toMatchObject({
      key: 'system_name',
      label: 'System Name',
    });

    const forbiddenDetail = await getClientServiceRequestSubmissionDetail(db, tenant, clientA, submissionB);
    expect(forbiddenDetail).toBeNull();
  });

  it('T025: submission detail includes attachment references when uploaded files were linked', async () => {
    const tenant = uuidv4();
    const definitionId = uuidv4();
    const versionId = uuidv4();
    const submissionId = uuidv4();
    const clientId = uuidv4();
    const attachmentFileId = uuidv4();

    await db('tenants').insert({
      tenant,
      client_name: `Tenant ${tenant.slice(0, 8)}`,
      email: `tenant-${tenant.slice(0, 8)}@example.com`,
    });

    await db('service_request_definitions').insert({
      tenant,
      definition_id: definitionId,
      name: 'Hardware Request',
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
      name: 'Hardware Request',
      form_schema_snapshot: {
        fields: [{ key: 'purchase_quote', label: 'Purchase Quote', type: 'file-upload', required: true }],
      },
      execution_provider: 'ticket-only',
      execution_config: {},
      form_behavior_provider: 'basic',
      form_behavior_config: {},
      visibility_provider: 'all-authenticated-client-users',
      visibility_config: {},
    });

    await db('service_request_submissions').insert({
      tenant,
      submission_id: submissionId,
      definition_id: definitionId,
      definition_version_id: versionId,
      requester_user_id: uuidv4(),
      client_id: clientId,
      contact_id: uuidv4(),
      request_name: 'Hardware Request',
      submitted_payload: {},
      execution_status: 'pending',
    });

    await db('service_request_submission_attachments').insert({
      tenant,
      submission_id: submissionId,
      file_id: attachmentFileId,
      file_name: 'quote.pdf',
      mime_type: 'application/pdf',
      file_size: 1024,
    });

    const detail = await getClientServiceRequestSubmissionDetail(db, tenant, clientId, submissionId);
    expect(detail).toBeTruthy();
    expect(detail?.attachments).toEqual([
      expect.objectContaining({
        file_id: attachmentFileId,
        file_name: 'quote.pdf',
        mime_type: 'application/pdf',
      }),
    ]);
  });
});
