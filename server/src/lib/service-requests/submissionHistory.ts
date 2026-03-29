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
