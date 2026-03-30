'use server';

import { withAuth, type AuthContext } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { IUserWithRoles } from '@alga-psa/types';
import { getAuthenticatedClientId } from '@alga-psa/client-portal/lib/clientAuth';
import { redirect } from 'next/navigation';
import { StorageService } from '../../../../lib/storage/StorageService';
import {
  getVisiblePublishedServiceRequestDefinitionDetail,
  submitPortalServiceRequest,
  validateSubmissionAgainstPublishedSchema,
  type ServiceRequestPortalDefinitionDetail,
} from '../../../../lib/service-requests';

export const getRequestServiceDefinitionDetailAction = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: AuthContext,
  definitionId: string
): Promise<ServiceRequestPortalDefinitionDetail | null> => {
  if (currentUser.user_type !== 'client') {
    return null;
  }

  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    const clientId = await getAuthenticatedClientId(trx, currentUser.user_id, tenant);
    return getVisiblePublishedServiceRequestDefinitionDetail(
      trx,
      {
        tenant,
        requesterUserId: currentUser.user_id,
        clientId,
        contactId: currentUser.contact_id ?? null,
      },
      definitionId
    );
  });
});

export const submitRequestServiceDefinitionAction = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: AuthContext,
  definitionId: string,
  formData: FormData
): Promise<void> => {
  if (currentUser.user_type !== 'client') {
    redirect(`/client-portal/request-services/${definitionId}?error=forbidden`);
  }

  const { knex } = await createTenantKnex();
  await withTransaction(knex, async (trx) => {
    const clientId = await getAuthenticatedClientId(trx, currentUser.user_id, tenant);
    const detail = await getVisiblePublishedServiceRequestDefinitionDetail(
      trx,
      {
        tenant,
        requesterUserId: currentUser.user_id,
        clientId,
        contactId: currentUser.contact_id ?? null,
      },
      definitionId
    );

    if (!detail) {
      redirect(`/client-portal/request-services/${definitionId}?error=not_visible`);
    }

    const fields = Array.isArray((detail.formSchema as any)?.fields)
      ? ((detail.formSchema as any).fields as any[])
      : [];
    const payload: Record<string, unknown> = {};
    const pendingUploads: Array<{
      fieldKey: string;
      file: File;
    }> = [];

    for (const field of fields) {
      if (!field || typeof field.key !== 'string') {
        continue;
      }

      if (field.type === 'file-upload') {
        const fileValue = formData.get(field.key);
        if (typeof File !== 'undefined' && fileValue instanceof File && fileValue.size > 0) {
          pendingUploads.push({
            fieldKey: field.key,
            file: fileValue,
          });
        }
        continue;
      }

      const fieldValue = formData.get(field.key);
      if (field.type === 'checkbox') {
        payload[field.key] = fieldValue === 'on' || fieldValue === 'true' || fieldValue === '1';
        continue;
      }

      if (typeof fieldValue === 'string') {
        payload[field.key] = fieldValue;
      }
    }

    const validationErrors = validateSubmissionAgainstPublishedSchema({
      formSchema: detail.formSchema,
      payload,
      attachments: pendingUploads.map((upload) => ({
        fieldKey: upload.fieldKey,
        fileId: `pending:${upload.file.name}`,
      })),
      visibleFieldKeys: detail.visibleFieldKeys,
    });
    if (validationErrors.length > 0) {
      redirect(
        `/client-portal/request-services/${definitionId}?error=${encodeURIComponent(
          `Submission validation failed: ${validationErrors.join('; ')}`
        )}`
      );
    }

    const uploadedFileIds: string[] = [];

    let result:
      | Awaited<ReturnType<typeof submitPortalServiceRequest>>
      | null = null;

    try {
      const attachments: {
        fieldKey: string;
        fileId: string;
        fileName: string;
        mimeType: string;
        fileSize: number;
      }[] = [];

      for (const upload of pendingUploads) {
        const mimeType = upload.file.type || 'application/octet-stream';
        await StorageService.validateFileUpload(tenant, mimeType, upload.file.size);
        const buffer = Buffer.from(await upload.file.arrayBuffer());
        const fileRecord = await StorageService.uploadFile(tenant, buffer, upload.file.name, {
          mime_type: mimeType,
          uploaded_by_id: currentUser.user_id,
        });
        uploadedFileIds.push(fileRecord.file_id);
        attachments.push({
          fieldKey: upload.fieldKey,
          fileId: fileRecord.file_id,
          fileName: upload.file.name,
          mimeType,
          fileSize: upload.file.size,
        });
      }

      result = await submitPortalServiceRequest({
        knex: trx,
        tenant,
        definitionId,
        requesterUserId: currentUser.user_id,
        clientId,
        contactId: currentUser.contact_id ?? null,
        payload,
        attachments,
      });
    } catch (error) {
      await Promise.allSettled(
        uploadedFileIds.map((fileId) =>
          StorageService.deleteFile(fileId, currentUser.user_id)
        )
      );
      const message = error instanceof Error ? error.message : 'submit_failed';
      redirect(`/client-portal/request-services/${definitionId}?error=${encodeURIComponent(message)}`);
    }

    const search = new URLSearchParams();
    search.set('submitted', result!.submissionId);
    if (result?.createdTicketId) {
      search.set('ticketId', result.createdTicketId);
    }
    redirect(`/client-portal/request-services/${definitionId}?${search.toString()}`);
  });
});
