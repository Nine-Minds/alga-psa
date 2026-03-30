import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { submitPortalServiceRequest } from '../../lib/service-requests/submissionService';
import {
  registerServiceRequestProviders,
  resetServiceRequestProviderRegistry,
} from '../../lib/service-requests/providers/registry';

describe('service request submission attachments', () => {
  let db: Knex;
  let tenantColumns: Record<string, unknown>;
  let userColumns: Record<string, unknown>;

  function hasColumn(columns: Record<string, unknown>, columnName: string): boolean {
    return Object.prototype.hasOwnProperty.call(columns, columnName);
  }

  async function insertTenant(tenant: string): Promise<void> {
    await db('tenants').insert({
      tenant,
      ...(hasColumn(tenantColumns, 'company_name')
        ? { company_name: `Tenant ${tenant.slice(0, 8)}` }
        : { client_name: `Tenant ${tenant.slice(0, 8)}` }),
      email: `tenant-${tenant.slice(0, 8)}@example.com`,
      ...(hasColumn(tenantColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(tenantColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    });
  }

  async function insertUser(tenant: string, userId: string): Promise<void> {
    await db('users').insert({
      tenant,
      user_id: userId,
      username: `requester-${userId.slice(0, 8)}`,
      hashed_password: 'not-used',
      ...(hasColumn(userColumns, 'role') ? { role: 'admin' } : {}),
      ...(hasColumn(userColumns, 'email') ? { email: `requester-${userId.slice(0, 8)}@example.com` } : {}),
      ...(hasColumn(userColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(userColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    });
  }

  async function insertExternalFile(params: {
    tenant: string;
    fileId: string;
    uploadedById: string;
    fileName?: string;
    mimeType?: string;
    fileSize?: number;
  }): Promise<void> {
    await db('external_files').insert({
      tenant: params.tenant,
      file_id: params.fileId,
      file_name: params.fileName ?? 'attachment.bin',
      original_name: params.fileName ?? 'attachment.bin',
      mime_type: params.mimeType ?? 'application/octet-stream',
      file_size: params.fileSize ?? 1024,
      storage_path: `service-requests/${params.fileId}`,
      uploaded_by_id: params.uploadedById,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
  }

  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
    tenantColumns = await db('tenants').columnInfo();
    userColumns = await db('users').columnInfo();
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

    await insertTenant(tenant);
    await insertUser(tenant, requesterUserId);

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

    await insertExternalFile({
      tenant,
      fileId: attachmentFileId,
      uploadedById: requesterUserId,
      fileName: 'quote.pdf',
      mimeType: 'application/pdf',
      fileSize: 2048,
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
    });
    expect(['pending', 'succeeded', 'failed']).toContain(submission.execution_status);
    expect(submission.submitted_payload).toEqual({
      device_model: 'ThinkPad X1',
    });

    const attachmentRows = await db('service_request_submission_attachments')
      .where({ tenant, submission_id: result.submissionId })
      .select('field_key', 'file_id', 'file_name', 'mime_type', 'file_size');
    expect(attachmentRows).toEqual([
      {
        field_key: 'purchase_quote',
        file_id: attachmentFileId,
        file_name: 'quote.pdf',
        mime_type: 'application/pdf',
        file_size: '2048',
      },
    ]);
  });

  it('rejects attachments that do not exist in tenant file storage', async () => {
    const tenant = uuidv4();
    const definitionId = uuidv4();
    const versionId = uuidv4();
    const requesterUserId = uuidv4();
    const clientId = uuidv4();
    const contactId = uuidv4();

    await insertTenant(tenant);

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

    await expect(
      submitPortalServiceRequest({
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
            fileId: uuidv4(),
            fileName: 'quote.pdf',
            mimeType: 'application/pdf',
            fileSize: 2048,
          },
        ],
      })
    ).rejects.toThrow('Submission attachments reference unknown files');

    const submissions = await db('service_request_submissions').where({ tenant, definition_id: definitionId });
    expect(submissions).toHaveLength(0);
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

  it('T022: direct submit to an unauthorized definition is rejected even when bypassing catalog listing', async () => {
    const tenant = uuidv4();
    const definitionId = uuidv4();
    const versionId = uuidv4();
    const requesterUserId = uuidv4();
    const clientId = uuidv4();
    const contactId = uuidv4();
    const denyProviderKey = `deny-all-${uuidv4()}`;

    registerServiceRequestProviders({
      executionProviders: [],
      formBehaviorProviders: [],
      visibilityProviders: [
        {
          key: denyProviderKey,
          displayName: 'Deny all',
          validateConfig: () => ({ isValid: true }),
          canAccessDefinition: async () => false,
        },
      ],
      templateProviders: [],
      adminExtensionProviders: [],
    });

    try {
      await insertTenant(tenant);

      await db('service_request_definitions').insert({
        tenant,
        definition_id: definitionId,
        name: 'Restricted Request',
        form_schema: { fields: [] },
        execution_provider: 'ticket-only',
        execution_config: {},
        form_behavior_provider: 'basic',
        form_behavior_config: {},
        visibility_provider: denyProviderKey,
        visibility_config: {},
        lifecycle_state: 'published',
      });

      await db('service_request_definition_versions').insert({
        tenant,
        version_id: versionId,
        definition_id: definitionId,
        version_number: 1,
        name: 'Restricted Request',
        form_schema_snapshot: {
          fields: [{ key: 'justification', type: 'long-text', label: 'Justification', required: false }],
        },
        execution_provider: 'ticket-only',
        execution_config: {},
        form_behavior_provider: 'basic',
        form_behavior_config: {},
        visibility_provider: denyProviderKey,
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
          payload: {
            justification: 'Attempting direct submit',
          },
        })
      ).rejects.toThrow('Service request is not visible or not published');

      const submissions = await db('service_request_submissions').where({ tenant, definition_id: definitionId });
      expect(submissions).toHaveLength(0);
    } finally {
      resetServiceRequestProviderRegistry();
    }
  });

  it('T023: successful submit returns stable request id and persists durable submission in pending state', async () => {
    const tenant = uuidv4();
    const definitionId = uuidv4();
    const versionId = uuidv4();
    const requesterUserId = uuidv4();
    const clientId = uuidv4();
    const contactId = uuidv4();

    await insertTenant(tenant);

    await db('service_request_definitions').insert({
      tenant,
      definition_id: definitionId,
      name: 'Laptop Setup Request',
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
      name: 'Laptop Setup Request',
      form_schema_snapshot: {
        fields: [{ key: 'employee_name', type: 'short-text', label: 'Employee Name', required: true }],
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
        employee_name: 'Dana Rivera',
      },
    });

    expect(result.submissionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );

    const submission = await db('service_request_submissions')
      .where({ tenant, submission_id: result.submissionId })
      .first();
    expect(submission).toBeDefined();
    expect(submission).toMatchObject({
      definition_id: definitionId,
      definition_version_id: versionId,
      request_name: 'Laptop Setup Request',
    });
    expect(['pending', 'succeeded', 'failed']).toContain(submission.execution_status);
    expect(submission.submitted_payload).toEqual({
      employee_name: 'Dana Rivera',
    });
    expect(submission.created_at).toBeTruthy();
  });
});
