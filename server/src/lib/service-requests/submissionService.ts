import type { Knex } from 'knex';
import { getVisiblePublishedServiceRequestDefinitionDetail } from './portalDetail';
import {
  getServiceRequestExecutionProvider,
  getServiceRequestFormBehaviorProvider,
} from './providers/registry';

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
}

export interface SubmitPortalServiceRequestResult {
  submissionId: string;
  executionStatus: 'pending' | 'succeeded' | 'failed';
  createdTicketId?: string;
  workflowExecutionId?: string;
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
  } = input;

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
    const attachmentFileIds = [...new Set(attachments.map((attachment) => attachment.fileId))];
    const existingFileRows = await knex('external_files')
      .where({ tenant, is_deleted: false })
      .whereIn('file_id', attachmentFileIds)
      .select('file_id');
    const existingFileIds = new Set(existingFileRows.map((row) => row.file_id as string));
    const missingFileIds = attachmentFileIds.filter((fileId) => !existingFileIds.has(fileId));
    if (missingFileIds.length > 0) {
      throw new Error(`Submission attachments reference unknown files: ${missingFileIds.join(', ')}`);
    }
  }

  const submissionId = await knex.transaction(async (trx) => {
    const [submissionRow] = await trx('service_request_submissions')
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
      })
      .returning('submission_id');

    const submissionId: string = submissionRow.submission_id;

    if (attachments.length > 0) {
      await trx('service_request_submission_attachments').insert(
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

  const executionProvider = getServiceRequestExecutionProvider(definitionDetail.executionProvider);
  if (!executionProvider) {
    const errorSummary = `Execution provider "${definitionDetail.executionProvider}" is not registered.`;
    await knex('service_request_submissions')
      .where({ tenant, submission_id: submissionId })
      .update({
        execution_status: 'failed',
        execution_error_summary: errorSummary,
        updated_at: knex.fn.now(),
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
      await knex('service_request_submissions')
        .where({ tenant, submission_id: submissionId })
        .update({
          execution_status: 'succeeded',
          created_ticket_id: executionResult.createdTicketId ?? null,
          workflow_execution_id: executionResult.workflowExecutionId ?? null,
          execution_error_summary: null,
          updated_at: knex.fn.now(),
        });

      return {
        submissionId,
        executionStatus: 'succeeded',
        createdTicketId: executionResult.createdTicketId,
        workflowExecutionId: executionResult.workflowExecutionId,
      };
    }

    await knex('service_request_submissions')
      .where({ tenant, submission_id: submissionId })
      .update({
        execution_status: 'failed',
        execution_error_summary: executionResult.errorSummary ?? 'Execution failed.',
        updated_at: knex.fn.now(),
      });
    return {
      submissionId,
      executionStatus: 'failed',
      createdTicketId: executionResult.createdTicketId,
      workflowExecutionId: executionResult.workflowExecutionId,
    };
  } catch (error) {
    const errorSummary = error instanceof Error ? error.message : 'Execution failed.';
    await knex('service_request_submissions')
      .where({ tenant, submission_id: submissionId })
      .update({
        execution_status: 'failed',
        execution_error_summary: errorSummary,
        updated_at: knex.fn.now(),
      });
    return {
      submissionId,
      executionStatus: 'failed',
    };
  }
}
