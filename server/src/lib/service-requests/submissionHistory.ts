import type { Knex } from 'knex';

export interface ServiceRequestSubmissionHistoryDetail {
  tenant: string;
  submission_id: string;
  definition_id: string;
  definition_version_id: string;
  request_name: string;
  submitted_payload: Record<string, unknown>;
  execution_status: 'pending' | 'succeeded' | 'failed';
  execution_error_summary: string | null;
  created_ticket_id: string | null;
  workflow_execution_id: string | null;
  submitted_at: Date;
  category_id: string | null;
  category_name_snapshot: string | null;
  linked_service_id: string | null;
  linked_service_name_snapshot: string | null;
}

export interface ServiceRequestClientSubmissionListRow {
  submission_id: string;
  request_name: string;
  execution_status: 'pending' | 'succeeded' | 'failed';
  submitted_at: Date;
}

export interface ServiceRequestClientSubmissionDetail {
  submission_id: string;
  definition_id: string;
  definition_version_id: string;
  request_name: string;
  submitted_payload: Record<string, unknown>;
  execution_status: 'pending' | 'succeeded' | 'failed';
  execution_error_summary: string | null;
  created_ticket_id: string | null;
  workflow_execution_id: string | null;
  submitted_at: Date;
  form_schema_snapshot: Record<string, unknown>;
  attachments: ServiceRequestSubmissionAttachmentDetail[];
}

export interface ServiceRequestSubmissionAttachmentDetail {
  submission_attachment_id: string;
  field_key: string | null;
  file_id: string;
  file_name: string | null;
  mime_type: string | null;
  file_size: string | null;
  created_at: Date;
}

export interface ServiceRequestAdminDefinitionSubmissionRow {
  submission_id: string;
  request_name: string;
  requester_user_id: string | null;
  client_id: string;
  contact_id: string | null;
  execution_status: 'pending' | 'succeeded' | 'failed';
  created_ticket_id: string | null;
  workflow_execution_id: string | null;
  submitted_at: Date;
}

export interface ServiceRequestAdminDefinitionSubmissionDetail
  extends ServiceRequestAdminDefinitionSubmissionRow {
  definition_id: string;
  definition_version_id: string;
  submitted_payload: Record<string, unknown>;
  execution_error_summary: string | null;
  requester_user_name: string | null;
  client_name: string | null;
  contact_name: string | null;
  created_ticket_display: string | null;
}

export async function listServiceRequestSubmissionsForDefinition(
  knex: Knex,
  tenant: string,
  definitionId: string
): Promise<ServiceRequestAdminDefinitionSubmissionRow[]> {
  const rows = await knex('service_request_submissions')
    .where({
      tenant,
      definition_id: definitionId,
    })
    .orderBy('created_at', 'desc')
    .select(
      'submission_id',
      'request_name',
      'requester_user_id',
      'client_id',
      'contact_id',
      'execution_status',
      'created_ticket_id',
      'workflow_execution_id',
      'created_at as submitted_at'
    );

  return rows as ServiceRequestAdminDefinitionSubmissionRow[];
}

export async function getServiceRequestSubmissionDetailForDefinition(
  knex: Knex,
  tenant: string,
  definitionId: string,
  submissionId: string
): Promise<ServiceRequestAdminDefinitionSubmissionDetail | null> {
  const row = await knex('service_request_submissions as submission')
    .leftJoin('users as requester', function joinRequester() {
      this.on('requester.tenant', '=', 'submission.tenant').andOn(
        'requester.user_id',
        '=',
        'submission.requester_user_id'
      );
    })
    .leftJoin('clients as client', function joinClient() {
      this.on('client.tenant', '=', 'submission.tenant').andOn(
        'client.client_id',
        '=',
        'submission.client_id'
      );
    })
    .leftJoin('contacts as contact', function joinContact() {
      this.on('contact.tenant', '=', 'submission.tenant').andOn(
        'contact.contact_name_id',
        '=',
        'submission.contact_id'
      );
    })
    .leftJoin('tickets as ticket', function joinTicket() {
      this.on('ticket.tenant', '=', 'submission.tenant').andOn(
        'ticket.ticket_id',
        '=',
        'submission.created_ticket_id'
      );
    })
    .where({
      'submission.tenant': tenant,
      'submission.definition_id': definitionId,
      'submission.submission_id': submissionId,
    })
    .first(
      'submission.submission_id',
      'submission.request_name',
      'submission.requester_user_id',
      'submission.client_id',
      'submission.contact_id',
      'submission.definition_id',
      'submission.definition_version_id',
      'submission.submitted_payload',
      'submission.execution_status',
      'submission.execution_error_summary',
      'submission.created_ticket_id',
      'submission.workflow_execution_id',
      'submission.created_at as submitted_at',
      'client.client_name as client_name',
      'contact.full_name as contact_name',
      knex.raw(`
        COALESCE(
          NULLIF(TRIM(CONCAT(COALESCE(requester.first_name, ''), ' ', COALESCE(requester.last_name, ''))), ''),
          requester.username,
          requester.email,
          requester.user_id::text
        ) as requester_user_name
      `),
      knex.raw(`
        CASE
          WHEN ticket.ticket_number IS NOT NULL AND ticket.title IS NOT NULL AND LENGTH(TRIM(ticket.title)) > 0
            THEN CONCAT('#', ticket.ticket_number, ' · ', ticket.title)
          WHEN ticket.ticket_number IS NOT NULL
            THEN CONCAT('#', ticket.ticket_number)
          WHEN ticket.title IS NOT NULL AND LENGTH(TRIM(ticket.title)) > 0
            THEN ticket.title
          ELSE NULL
        END as created_ticket_display
      `)
    );

  return (row as ServiceRequestAdminDefinitionSubmissionDetail | undefined) ?? null;
}

export async function getServiceRequestSubmissionHistoryDetail(
  knex: Knex,
  tenant: string,
  submissionId: string
): Promise<ServiceRequestSubmissionHistoryDetail | null> {
  const row = await knex('service_request_submissions as submission')
    .innerJoin('service_request_definition_versions as version', function joinVersion() {
      this.on('version.tenant', '=', 'submission.tenant').andOn(
        'version.version_id',
        '=',
        'submission.definition_version_id'
      );
    })
    .where({
      'submission.tenant': tenant,
      'submission.submission_id': submissionId,
    })
    .first(
      'submission.tenant',
      'submission.submission_id',
      'submission.definition_id',
      'submission.definition_version_id',
      'submission.request_name',
      'submission.submitted_payload',
      'submission.execution_status',
      'submission.execution_error_summary',
      'submission.created_ticket_id',
      'submission.workflow_execution_id',
      'submission.created_at as submitted_at',
      'version.category_id',
      'version.category_name_snapshot',
      'version.linked_service_id',
      'version.linked_service_name_snapshot'
    );

  return (row as ServiceRequestSubmissionHistoryDetail | undefined) ?? null;
}

export async function listClientServiceRequestSubmissions(
  knex: Knex,
  tenant: string,
  clientId: string
): Promise<ServiceRequestClientSubmissionListRow[]> {
  const rows = await knex('service_request_submissions')
    .where({
      tenant,
      client_id: clientId,
    })
    .orderBy('created_at', 'desc')
    .select('submission_id', 'request_name', 'execution_status', 'created_at as submitted_at');

  return rows as ServiceRequestClientSubmissionListRow[];
}

export async function getClientServiceRequestSubmissionDetail(
  knex: Knex,
  tenant: string,
  clientId: string,
  submissionId: string
): Promise<ServiceRequestClientSubmissionDetail | null> {
  const row = await knex('service_request_submissions as submission')
    .innerJoin('service_request_definition_versions as version', function joinVersion() {
      this.on('version.tenant', '=', 'submission.tenant').andOn(
        'version.version_id',
        '=',
        'submission.definition_version_id'
      );
    })
    .where({
      'submission.tenant': tenant,
      'submission.client_id': clientId,
      'submission.submission_id': submissionId,
    })
    .first(
      'submission.submission_id',
      'submission.definition_id',
      'submission.definition_version_id',
      'submission.request_name',
      'submission.submitted_payload',
      'submission.execution_status',
      'submission.execution_error_summary',
      'submission.created_ticket_id',
      'submission.workflow_execution_id',
      'submission.created_at as submitted_at',
      'version.form_schema_snapshot'
    );

  if (!row) {
    return null;
  }

  const attachments = await knex('service_request_submission_attachments')
    .where({
      tenant,
      submission_id: submissionId,
    })
    .orderBy('created_at', 'asc')
    .select(
      'submission_attachment_id',
      'field_key',
      'file_id',
      'file_name',
      'mime_type',
      'file_size',
      'created_at'
    );

  return {
    ...(row as Omit<ServiceRequestClientSubmissionDetail, 'attachments'>),
    attachments: attachments as ServiceRequestSubmissionAttachmentDetail[],
  };
}
