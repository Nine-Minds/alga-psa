import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { submitPortalServiceRequest } from '../../lib/service-requests/submissionService';

describe('service request submission attachments', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('T020: required file-upload requests persist submission row and attachment links on successful submit', async () => {
    const tenant = uuidv4();
    const definitionId = uuidv4();
    const versionId = uuidv4();
    const requesterUserId = uuidv4();
    const clientId = uuidv4();
    const contactId = uuidv4();
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
        fields: [
          { key: 'device_model', type: 'short-text', label: 'Device Model', required: true },
          { key: 'purchase_quote', type: 'file-upload', label: 'Purchase Quote', required: true },
        ],
      },
      execution_provider: 'ticket-only',
      execution_config: {},
      form_behavior_provider: 'basic',
      form_behavior_config: {},
      visibility_provider: 'all-authenticated-client-users',
      visibility_config: {},
    });

    const result = await submitPortalServiceRequest({
      knex: db,
      tenant,
      definitionId,
      requesterUserId,
      clientId,
      contactId,
      payload: {
        device_model: 'ThinkPad X1',
      },
      attachments: [
        {
          fieldKey: 'purchase_quote',
          fileId: attachmentFileId,
          fileName: 'quote.pdf',
          mimeType: 'application/pdf',
          fileSize: 2048,
        },
      ],
    });

    const submission = await db('service_request_submissions')
      .where({ tenant, submission_id: result.submissionId })
      .first();
    expect(submission).toBeDefined();
    expect(submission).toMatchObject({
      definition_id: definitionId,
      definition_version_id: versionId,
      request_name: 'Hardware Request',
      execution_status: 'pending',
    });
    expect(submission.submitted_payload).toEqual({
      device_model: 'ThinkPad X1',
    });

    const attachmentRows = await db('service_request_submission_attachments')
      .where({ tenant, submission_id: result.submissionId })
      .select('file_id', 'file_name', 'mime_type', 'file_size');
    expect(attachmentRows).toEqual([
      {
        file_id: attachmentFileId,
        file_name: 'quote.pdf',
        mime_type: 'application/pdf',
        file_size: '2048',
      },
    ]);
  });

  it('T021: required-field validation blocks submission against the published snapshot', async () => {
    const tenant = uuidv4();
    const definitionId = uuidv4();
    const versionId = uuidv4();
    const requesterUserId = uuidv4();
    const clientId = uuidv4();
    const contactId = uuidv4();

    await db('tenants').insert({
      tenant,
      client_name: `Tenant ${tenant.slice(0, 8)}`,
      email: `tenant-${tenant.slice(0, 8)}@example.com`,
    });

    await db('service_request_definitions').insert({
      tenant,
      definition_id: definitionId,
      name: 'Access Request (Draft Diverged)',
      form_schema: {
        fields: [{ key: 'ignored_draft_field', type: 'short-text', required: false }],
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
      name: 'Access Request',
      form_schema_snapshot: {
        fields: [
          { key: 'access_target', type: 'short-text', label: 'Access Target', required: true },
        ],
      },
      execution_provider: 'ticket-only',
      execution_config: {},
      form_behavior_provider: 'basic',
      form_behavior_config: {},
      visibility_provider: 'all-authenticated-client-users',
      visibility_config: {},
    });

    await expect(
      submitPortalServiceRequest({
        knex: db,
        tenant,
        definitionId,
        requesterUserId,
        clientId,
        contactId,
        payload: {},
      })
    ).rejects.toThrow('Required field missing: "access_target"');

    const submissions = await db('service_request_submissions').where({ tenant, definition_id: definitionId });
    expect(submissions).toHaveLength(0);
  });
});
