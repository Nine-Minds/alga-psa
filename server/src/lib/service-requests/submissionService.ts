import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { getVisiblePublishedServiceRequestDefinitionDetail } from './portalDetail';
import {
  getServiceRequestExecutionProvider,
  getServiceRequestFormBehaviorProvider,
} from './providers/registry';
import { publishServiceRequestSubmissionSearchEvent } from './searchEvents';
import { recordServiceRequestSubmissionAudit } from './submissionAudit';

export interface ServiceRequestSubmissionAttachmentInput {
  fieldKey: string;
  fileId: string;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
}

export interface SubmitPortalServiceRequestInput {
  knex: Knex;
  tenant: string;
  definitionId: string;
  requesterUserId: string;
  clientId: string;
  contactId?: string | null;
  payload: Record<string, unknown>;
  attachments?: ServiceRequestSubmissionAttachmentInput[];
  /**
   * Opaque idempotency key generated once per rendered portal form attempt and
   * resubmitted unchanged on retries. Scoped per tenant + requester +
   * definition: a repeated key returns the already-created submission instead
   * of inserting a new row or re-running the execution provider. Optional so
   * callers without retry semantics keep their existing behavior.
   */
  clientSubmissionKey?: string | null;
}

export interface SubmitPortalServiceRequestResult {
  submissionId: string;
  executionStatus: 'pending' | 'succeeded' | 'failed';
  createdTicketId?: string;
  workflowExecutionId?: string;
  /**
   * Transient post-submit redirect target surfaced by the execution provider
   * (e.g. a Stripe Checkout URL). Not persisted on the submission.
   */
  redirectUrl?: string;
  /**
   * True when the client submission key matched an existing submission and
   * that submission's stored state was returned without executing the
   * provider again. Replays never carry a redirectUrl.
   */
  replayed?: boolean;
}

const CLIENT_SUBMISSION_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CLIENT_SUBMISSION_KEY_UNIQUE_INDEX = 'service_request_submissions_client_key_unique';

interface ExistingSubmissionByClientKeyRow {
  submission_id: string;
  execution_status: 'pending' | 'succeeded' | 'failed';
  created_ticket_id: string | null;
  workflow_execution_id: string | null;
}

function toReplayedSubmissionResult(
  row: ExistingSubmissionByClientKeyRow
): SubmitPortalServiceRequestResult {
  return {
    submissionId: row.submission_id,
    executionStatus: row.execution_status,
    createdTicketId: row.created_ticket_id ?? undefined,
    workflowExecutionId: row.workflow_execution_id ?? undefined,
    replayed: true,
  };
}

async function findSubmissionByClientKey(
  knex: Knex,
  tenant: string,
  scope: {
    requesterUserId: string;
    definitionId: string;
    clientSubmissionKey: string;
  }
): Promise<ExistingSubmissionByClientKeyRow | null> {
  const row = await tenantDb(knex, tenant).table('service_request_submissions')
    .where({
      requester_user_id: scope.requesterUserId,
      definition_id: scope.definitionId,
      client_submission_key: scope.clientSubmissionKey,
    })
    .first<ExistingSubmissionByClientKeyRow | undefined>(
      'submission_id',
      'execution_status',
      'created_ticket_id',
      'workflow_execution_id'
    );

  return row ?? null;
}

function isClientSubmissionKeyConflict(error: unknown): boolean {
  const candidate = error as { code?: string; constraint?: string } | null;
  return (
    candidate?.code === '23505' &&
    candidate?.constraint === CLIENT_SUBMISSION_KEY_UNIQUE_INDEX
  );
}

function isMissingRequiredValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === 'string') {
    return value.trim().length === 0;
  }
  return false;
}

export function validateSubmissionAgainstPublishedSchema(input: {
  formSchema: Record<string, unknown>;
  payload: Record<string, unknown>;
  attachments?: ServiceRequestSubmissionAttachmentInput[];
  visibleFieldKeys?: string[];
}): string[] {
  const fields = Array.isArray((input.formSchema as any)?.fields)
    ? ((input.formSchema as any).fields as any[])
    : [];
  const attachmentList = input.attachments ?? [];
  const visibleFieldKeySet = input.visibleFieldKeys
    ? new Set(input.visibleFieldKeys)
    : null;
  const errors: string[] = [];

  for (const field of fields) {
    if (!field?.required || typeof field?.key !== 'string') {
      continue;
    }
    if (visibleFieldKeySet && !visibleFieldKeySet.has(field.key)) {
      continue;
    }

    if (field.type === 'file-upload') {
      const hasFile = attachmentList.some((attachment) => attachment.fieldKey === field.key);
      if (!hasFile) {
        errors.push(`Required file upload missing for "${field.key}"`);
      }
      continue;
    }

    if (isMissingRequiredValue(input.payload[field.key])) {
      errors.push(`Required field missing: "${field.key}"`);
    }
  }

  return errors;
}

export async function submitPortalServiceRequest(
  input: SubmitPortalServiceRequestInput
): Promise<SubmitPortalServiceRequestResult> {
  const {
    knex,
    tenant,
    definitionId,
    requesterUserId,
    clientId,
    contactId = null,
    payload,
    attachments = [],
    clientSubmissionKey = null,
  } = input;

  if (clientSubmissionKey !== null && !CLIENT_SUBMISSION_KEY_PATTERN.test(clientSubmissionKey)) {
    throw new Error('Client submission key must be a UUID');
  }

  // Idempotent replay: a repeated key from the same requester for the same
  // definition returns the stored submission (terminal or still pending) and
  // never re-runs validation, persistence, or the execution provider.
  if (clientSubmissionKey) {
    const existingSubmission = await findSubmissionByClientKey(knex, tenant, {
      requesterUserId,
      definitionId,
      clientSubmissionKey,
    });
    if (existingSubmission) {
      return toReplayedSubmissionResult(existingSubmission);
    }
  }

  const definitionDetail = await getVisiblePublishedServiceRequestDefinitionDetail(
    knex,
    {
      tenant,
      requesterUserId,
      clientId,
      contactId,
    },
    definitionId
  );

  if (!definitionDetail) {
    throw new Error('Service request is not visible or not published');
  }

  const validationErrors = validateSubmissionAgainstPublishedSchema({
    formSchema: definitionDetail.formSchema,
    payload,
    attachments,
    visibleFieldKeys: await (async () => {
      const formBehaviorProvider = getServiceRequestFormBehaviorProvider(
        definitionDetail.formBehaviorProvider
      );
      if (!formBehaviorProvider?.resolveVisibleFieldKeys) {
        return definitionDetail.visibleFieldKeys;
      }
      const mergedValues: Record<string, unknown> = {
        ...definitionDetail.initialValues,
        ...payload,
      };
      return formBehaviorProvider.resolveVisibleFieldKeys(
        {
          tenant,
          requesterUserId,
          clientId,
          contactId,
        },
        definitionDetail.formSchema,
        mergedValues,
        definitionDetail.formBehaviorConfig
      );
    })(),
  });
  if (validationErrors.length > 0) {
    throw new Error(`Submission validation failed: ${validationErrors.join('; ')}`);
  }

  if (attachments.length > 0) {
    const db = tenantDb(knex, tenant);
    const attachmentFileIds = [...new Set(attachments.map((attachment) => attachment.fileId))];
    const existingFileRows = await db.table('external_files')
      .where({ is_deleted: false })
      .whereIn('file_id', attachmentFileIds)
      .select('file_id');
    const existingFileIds = new Set(existingFileRows.map((row) => row.file_id as string));
    const missingFileIds = attachmentFileIds.filter((fileId) => !existingFileIds.has(fileId));
    if (missingFileIds.length > 0) {
      throw new Error(`Submission attachments reference unknown files: ${missingFileIds.join(', ')}`);
    }
  }

  let submissionId: string;
  try {
    submissionId = await knex.transaction(async (trx) => {
      const db = tenantDb(trx, tenant);
      const [submissionRow] = await db.table('service_request_submissions')
        .insert({
          tenant,
          definition_id: definitionDetail.definitionId,
          definition_version_id: definitionDetail.versionId,
          requester_user_id: requesterUserId,
          client_id: clientId,
          contact_id: contactId,
          request_name: definitionDetail.title,
          submitted_payload: payload,
          execution_status: 'pending',
          client_submission_key: clientSubmissionKey,
        })
        .returning('submission_id');

      const submissionId: string = submissionRow.submission_id;

      if (attachments.length > 0) {
        await db.table('service_request_submission_attachments').insert(
          attachments.map((attachment) => ({
            tenant,
            submission_id: submissionId,
            field_key: attachment.fieldKey,
            file_id: attachment.fileId,
            file_name: attachment.fileName ?? null,
            mime_type: attachment.mimeType ?? null,
            file_size:
              typeof attachment.fileSize === 'number'
                ? Math.max(0, Math.floor(attachment.fileSize))
                : null,
          }))
        );
      }

      return submissionId;
    });
  } catch (error) {
    // Concurrent same-key retry: another request won the unique index between
    // the pre-insert lookup and this insert. The transaction above (a
    // savepoint when a caller passed an outer transaction) has rolled back,
    // so load and return the winning row instead of executing the provider a
    // second time.
    if (clientSubmissionKey && isClientSubmissionKeyConflict(error)) {
      const winningSubmission = await findSubmissionByClientKey(knex, tenant, {
        requesterUserId,
        definitionId,
        clientSubmissionKey,
      });
      if (winningSubmission) {
        return toReplayedSubmissionResult(winningSubmission);
      }
    }
    throw error;
  }

  await publishServiceRequestSubmissionSearchEvent(
    'SERVICE_REQUEST_SUBMISSION_CREATED',
    tenant,
    submissionId,
    {
      definitionId: definitionDetail.definitionId,
      clientId,
      requesterUserId,
      executionStatus: 'pending',
      changedFields: ['request_name', 'submitted_payload', 'execution_status'],
    },
  );

  await recordServiceRequestSubmissionAudit(knex, tenant, 'service_request_submission_created', {
    submissionId,
    userId: requesterUserId,
    changedData: { execution_status: 'pending' },
    details: {
      definition_id: definitionDetail.definitionId,
      definition_version_id: definitionDetail.versionId,
      client_id: clientId,
      execution_provider: definitionDetail.executionProvider,
    },
  });

  const executionProvider = getServiceRequestExecutionProvider(definitionDetail.executionProvider);
  if (!executionProvider) {
    const errorSummary = `Execution provider "${definitionDetail.executionProvider}" is not registered.`;
    await tenantDb(knex, tenant).table('service_request_submissions')
      .where({ submission_id: submissionId })
      .update({
        execution_status: 'failed',
        execution_error_summary: errorSummary,
        updated_at: knex.fn.now(),
      });
    await publishServiceRequestSubmissionSearchEvent(
      'SERVICE_REQUEST_SUBMISSION_UPDATED',
      tenant,
      submissionId,
      {
        definitionId: definitionDetail.definitionId,
        clientId,
        requesterUserId,
        executionStatus: 'failed',
        changedFields: ['execution_status', 'execution_error_summary'],
      },
    );
    await recordServiceRequestSubmissionAudit(knex, tenant, 'service_request_submission_execution_failed', {
      submissionId,
      userId: requesterUserId,
      changedData: { execution_status: 'failed' },
      details: { error_summary: errorSummary },
    });
    return {
      submissionId,
      executionStatus: 'failed',
    };
  }

  try {
    const executionResult = await executionProvider.execute({
      knex,
      tenant,
      definitionId: definitionDetail.definitionId,
      definitionVersionId: definitionDetail.versionId,
      submissionId,
      requesterUserId,
      clientId,
      contactId,
      payload,
      config: definitionDetail.executionConfig,
    });

    if (executionResult.status === 'succeeded') {
      await tenantDb(knex, tenant).table('service_request_submissions')
        .where({ submission_id: submissionId })
        .update({
          execution_status: 'succeeded',
          created_ticket_id: executionResult.createdTicketId ?? null,
          workflow_execution_id: executionResult.workflowExecutionId ?? null,
          execution_error_summary: null,
          updated_at: knex.fn.now(),
        });

      await publishServiceRequestSubmissionSearchEvent(
        'SERVICE_REQUEST_SUBMISSION_UPDATED',
        tenant,
        submissionId,
        {
          definitionId: definitionDetail.definitionId,
          clientId,
          requesterUserId,
          executionStatus: 'succeeded',
          changedFields: [
            'execution_status',
            'created_ticket_id',
            'workflow_execution_id',
            'execution_error_summary',
          ],
        },
      );

      await recordServiceRequestSubmissionAudit(knex, tenant, 'service_request_submission_execution_succeeded', {
        submissionId,
        userId: requesterUserId,
        changedData: {
          execution_status: 'succeeded',
          created_ticket_id: executionResult.createdTicketId ?? null,
          workflow_execution_id: executionResult.workflowExecutionId ?? null,
        },
        details: { execution_provider: definitionDetail.executionProvider },
      });

      return {
        submissionId,
        executionStatus: 'succeeded',
        createdTicketId: executionResult.createdTicketId,
        workflowExecutionId: executionResult.workflowExecutionId,
        redirectUrl: executionResult.redirectUrl,
      };
    }

    await tenantDb(knex, tenant).table('service_request_submissions')
      .where({ submission_id: submissionId })
      .update({
        execution_status: 'failed',
        execution_error_summary: executionResult.errorSummary ?? 'Execution failed.',
        updated_at: knex.fn.now(),
      });
    await publishServiceRequestSubmissionSearchEvent(
      'SERVICE_REQUEST_SUBMISSION_UPDATED',
      tenant,
      submissionId,
      {
        definitionId: definitionDetail.definitionId,
        clientId,
        requesterUserId,
        executionStatus: 'failed',
        changedFields: ['execution_status', 'execution_error_summary'],
      },
    );
    await recordServiceRequestSubmissionAudit(knex, tenant, 'service_request_submission_execution_failed', {
      submissionId,
      userId: requesterUserId,
      changedData: { execution_status: 'failed' },
      details: { error_summary: executionResult.errorSummary ?? 'Execution failed.' },
    });
    return {
      submissionId,
      executionStatus: 'failed',
      createdTicketId: executionResult.createdTicketId,
      workflowExecutionId: executionResult.workflowExecutionId,
    };
  } catch (error) {
    const errorSummary = error instanceof Error ? error.message : 'Execution failed.';
    await tenantDb(knex, tenant).table('service_request_submissions')
      .where({ submission_id: submissionId })
      .update({
        execution_status: 'failed',
        execution_error_summary: errorSummary,
        updated_at: knex.fn.now(),
      });
    await publishServiceRequestSubmissionSearchEvent(
      'SERVICE_REQUEST_SUBMISSION_UPDATED',
      tenant,
      submissionId,
      {
        definitionId: definitionDetail.definitionId,
        clientId,
        requesterUserId,
        executionStatus: 'failed',
        changedFields: ['execution_status', 'execution_error_summary'],
      },
    );
    await recordServiceRequestSubmissionAudit(knex, tenant, 'service_request_submission_execution_failed', {
      submissionId,
      userId: requesterUserId,
      changedData: { execution_status: 'failed' },
      details: { error_summary: errorSummary },
    });
    return {
      submissionId,
      executionStatus: 'failed',
    };
  }
}

export async function deleteServiceRequestSubmission(input: {
  knex: Knex;
  tenant: string;
  submissionId: string;
  deletedBy?: string;
}): Promise<boolean> {
  const { knex, tenant, submissionId, deletedBy } = input;

  const existing = await tenantDb(knex, tenant).table('service_request_submissions')
    .where({ submission_id: submissionId })
    .select('definition_id', 'client_id', 'requester_user_id', 'execution_status')
    .first<{
      definition_id: string;
      client_id: string | null;
      requester_user_id: string;
      execution_status: string;
    }>();

  if (!existing) {
    return false;
  }

  let deleted = 0;
  await knex.transaction(async (trx) => {
    const db = tenantDb(trx, tenant);
    await db.table('service_request_submission_attachments')
      .where({ submission_id: submissionId })
      .delete();

    const deletedRows = await db.table('service_request_submissions')
      .where({ submission_id: submissionId })
      .delete();

    deleted = Number(deletedRows ?? 0);
  });

  if (deleted > 0) {
    await publishServiceRequestSubmissionSearchEvent(
      'SERVICE_REQUEST_SUBMISSION_DELETED',
      tenant,
      submissionId,
      {
        definitionId: existing.definition_id,
        clientId: existing.client_id,
        requesterUserId: deletedBy ?? existing.requester_user_id,
        executionStatus: existing.execution_status,
      },
    );
  }

  return deleted > 0;
}
