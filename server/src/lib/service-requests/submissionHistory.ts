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
  const row = await knex('service_request_submissions')
    .where({
      tenant,
      definition_id: definitionId,
      submission_id: submissionId,
    })
    .first(
      'submission_id',
      'request_name',
      'requester_user_id',
      'client_id',
      'contact_id',
      'definition_id',
      'definition_version_id',
      'submitted_payload',
      'execution_status',
      'execution_error_summary',
      'created_ticket_id',
      'workflow_execution_id',
      'created_at as submitted_at'
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

  return (row as ServiceRequestClientSubmissionDetail | undefined) ?? null;
}
