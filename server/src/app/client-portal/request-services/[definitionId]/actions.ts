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

function buildRequestServiceDefinitionRedirectUrl(
  definitionId: string,
  params: Record<string, string | null | undefined>
): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value.length > 0) {
      search.set(key, value);
    }
  }

  const query = search.toString();
  return query.length > 0
    ? `/client-portal/request-services/${definitionId}?${query}`
    : `/client-portal/request-services/${definitionId}`;
}

/**
 * URL for the catalog/list page; used after a successful submission so the
 * user lands somewhere actionable (their request list + catalog) instead of
 * an empty form page.
 */
function buildRequestServiceCatalogRedirectUrl(
  params: Record<string, string | null | undefined>
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value.length > 0) {
      search.set(key, value);
    }
  }
  const query = search.toString();
  return query.length > 0
    ? `/client-portal/request-services?${query}`
    : '/client-portal/request-services';
}

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
    redirect(buildRequestServiceDefinitionRedirectUrl(definitionId, { error: 'forbidden' }));
  }

  const { knex } = await createTenantKnex();
  const outcome = await withTransaction(knex, async (trx) => {
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
      return {
        status: 'error' as const,
        message: 'not_visible',
      };
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
      return {
        status: 'error' as const,
        message: `Submission validation failed: ${validationErrors.join('; ')}`,
      };
    }

    const uploadedFileIds: string[] = [];

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

      const result = await submitPortalServiceRequest({
        knex: trx,
        tenant,
        definitionId,
        requesterUserId: currentUser.user_id,
        clientId,
        contactId: currentUser.contact_id ?? null,
        payload,
        attachments,
      });

      return {
        status: 'success' as const,
        submissionId: result.submissionId,
        createdTicketId: result.createdTicketId ?? null,
      };
    } catch (error) {
      await Promise.allSettled(
        uploadedFileIds.map((fileId) =>
          StorageService.deleteFile(fileId, currentUser.user_id)
        )
      );

      return {
        status: 'error' as const,
        message: error instanceof Error ? error.message : 'submit_failed',
      };
    }
  });

  if (outcome.status === 'error') {
    redirect(
      buildRequestServiceDefinitionRedirectUrl(definitionId, {
        error: outcome.message,
      })
    );
  }

  redirect(
    buildRequestServiceCatalogRedirectUrl({
      submitted: outcome.submissionId,
      ticketId: outcome.createdTicketId,
    })
  );
});
