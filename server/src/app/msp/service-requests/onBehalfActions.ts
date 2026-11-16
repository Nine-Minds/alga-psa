'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { StorageService } from '@alga-psa/storage/StorageService';
import {
  getVisiblePublishedServiceRequestDefinitionDetail,
  resolveSubmissionVisibility,
  toPortalFormView,
  validateSubmissionAgainstPublishedSchema,
  type ServiceRequestPortalCatalogItem,
  type ServiceRequestSubmissionAttachmentInput,
  type ServiceRequestPortalFormView,
} from '../../../lib/service-requests';
import {
  listDefinitionsForRequester,
  MspSubmissionError,
  resolveRequesterForMspSubmission,
  submitOnBehalfOfMsp,
} from '../../../lib/service-requests/mspSubmissions';
import {
  requireContactInReadScope,
  requireServiceRequestPermission,
  ServiceRequestPermissionError,
} from '../../../lib/service-requests/servicePermission';
import { CLIENT_SUBMISSION_KEY_FIELD_NAME } from '../../../components/service-requests/clientSubmissionKey';

export interface OnBehalfFormView {
  form: ServiceRequestPortalFormView;
  /** The contact's identity, for `context.*` visibility sources. Never the technician. */
  visibilityContext: { requesterUserId: string | null; clientId: string; contactId: string };
}

export type OnBehalfSubmitOutcome =
  | { status: 'success'; submissionId: string; ticketId: string | null; replayed: boolean }
  | { status: 'error'; code: 'forbidden' | 'contact_not_found' | 'not_visible' | 'invalid' | 'failed'; message: string };

export const listOnBehalfCatalogAction = withAuth(async (
  user,
  { tenant },
  clientId: string,
  contactId: string
): Promise<ServiceRequestPortalCatalogItem[]> => {
  const { knex } = await createTenantKnex();
  await requireServiceRequestPermission(user, 'read', knex);
  await requireContactInReadScope(knex, tenant, user, contactId);
  const requester = await resolveRequesterForMspSubmission(knex, tenant, clientId, contactId, user.user_id);
  return listDefinitionsForRequester(knex, tenant, requester);
});

export const getOnBehalfDefinitionFormAction = withAuth(async (
  user,
  { tenant },
  clientId: string,
  contactId: string,
  definitionId: string
): Promise<OnBehalfFormView | null> => {
  const { knex } = await createTenantKnex();
  await requireServiceRequestPermission(user, 'read', knex);
  await requireContactInReadScope(knex, tenant, user, contactId);
  const requester = await resolveRequesterForMspSubmission(knex, tenant, clientId, contactId, user.user_id);
  const detail = await getVisiblePublishedServiceRequestDefinitionDetail(
    knex,
    { tenant, requesterUserId: requester.requesterUserId, clientId, contactId },
    definitionId
  );
  if (!detail) return null;
  return {
    form: toPortalFormView(detail),
    visibilityContext: { requesterUserId: requester.requesterUserId, clientId, contactId },
  };
});

function outcomeForError(error: unknown): OnBehalfSubmitOutcome {
  if (error instanceof ServiceRequestPermissionError) {
    return { status: 'error', code: 'forbidden', message: error.message };
  }
  if (error instanceof MspSubmissionError) {
    return {
      status: 'error',
      code: error.code === 'contact_not_found' ? 'contact_not_found' : 'not_visible',
      message: error.message,
    };
  }
  if (error instanceof Error && error.message.startsWith('Submission validation failed:')) {
    return { status: 'error', code: 'invalid', message: error.message };
  }
  return { status: 'error', code: 'failed', message: 'Unable to submit request.' };
}

export const submitOnBehalfServiceRequestAction = withAuth(async (
  user,
  { tenant },
  clientId: string,
  contactId: string,
  definitionId: string,
  formData: FormData
): Promise<OnBehalfSubmitOutcome> => {
  const rawKey = formData.get(CLIENT_SUBMISSION_KEY_FIELD_NAME);
  const clientSubmissionKey = typeof rawKey === 'string' && rawKey.trim().length > 0 ? rawKey.trim() : null;

  const { knex } = await createTenantKnex();
  try {
    await requireServiceRequestPermission(user, 'create', knex);
  } catch (error) {
    return outcomeForError(error);
  }

  return withTransaction(knex, async (trx): Promise<OnBehalfSubmitOutcome> => {
    const uploadedFileIds: string[] = [];
    try {
      await requireContactInReadScope(trx, tenant, user, contactId);
      const requester = await resolveRequesterForMspSubmission(trx, tenant, clientId, contactId, user.user_id);
      const detail = await getVisiblePublishedServiceRequestDefinitionDetail(
        trx,
        { tenant, requesterUserId: requester.requesterUserId, clientId, contactId },
        definitionId
      );
      if (!detail) {
        throw new MspSubmissionError('definition_not_visible', 'Service request is not visible to this contact');
      }

      // LEVERAGE: pattern service-request-formdata-payload — same FormData→payload/upload extraction as client-portal/request-services/[definitionId]/actions.ts; a shared parser would remove the copy.
      const fields = Array.isArray((detail.formSchema as any)?.fields) ? ((detail.formSchema as any).fields as any[]) : [];
      const payload: Record<string, unknown> = {};
      const pendingUploads: Array<{ fieldKey: string; file: File }> = [];
      for (const field of fields) {
        if (!field || typeof field.key !== 'string') continue;
        const value = formData.get(field.key);
        if (field.type === 'file-upload') {
          if (typeof File !== 'undefined' && value instanceof File && value.size > 0) {
            pendingUploads.push({ fieldKey: field.key, file: value });
          }
          continue;
        }
        if (field.type === 'checkbox') {
          payload[field.key] = value === 'on' || value === 'true' || value === '1';
        } else if (typeof value === 'string') {
          payload[field.key] = value;
        }
      }

      const visibleKeys = new Set(
        resolveSubmissionVisibility(detail, payload, {
          requesterUserId: requester.requesterUserId,
          clientId,
          contactId,
        })
      );
      const visibleUploads = pendingUploads.filter((upload) => visibleKeys.has(upload.fieldKey));
      const validationErrors = validateSubmissionAgainstPublishedSchema({
        formSchema: detail.formSchema,
        payload,
        attachments: visibleUploads.map((upload) => ({ fieldKey: upload.fieldKey, fileId: `pending:${upload.file.name}` })),
        visibleFieldKeys: [...visibleKeys],
      });
      if (validationErrors.length > 0) {
        return { status: 'error', code: 'invalid', message: validationErrors.join('; ') };
      }

      const attachments: ServiceRequestSubmissionAttachmentInput[] = [];
      for (const upload of visibleUploads) {
        const mimeType = upload.file.type || 'application/octet-stream';
        await StorageService.validateFileUpload(tenant, mimeType, upload.file.size);
        const record = await StorageService.uploadFile(tenant, Buffer.from(await upload.file.arrayBuffer()), upload.file.name, {
          mime_type: mimeType,
          uploaded_by_id: user.user_id,
        });
        uploadedFileIds.push(record.file_id);
        attachments.push({
          fieldKey: upload.fieldKey,
          fileId: record.file_id,
          fileName: upload.file.name,
          mimeType,
          fileSize: upload.file.size,
        });
      }

      const result = await submitOnBehalfOfMsp({
        knex: trx,
        tenant,
        definitionId,
        requester,
        payload,
        attachments,
        clientSubmissionKey,
      });

      if (result.replayed && uploadedFileIds.length > 0) {
        await Promise.allSettled(uploadedFileIds.map((fileId) => StorageService.deleteFile(fileId, user.user_id)));
      }
      return {
        status: 'success',
        submissionId: result.submissionId,
        ticketId: result.createdTicketId ?? null,
        replayed: result.replayed === true,
      };
    } catch (error) {
      await Promise.allSettled(uploadedFileIds.map((fileId) => StorageService.deleteFile(fileId, user.user_id)));
      return outcomeForError(error);
    }
  });
});
