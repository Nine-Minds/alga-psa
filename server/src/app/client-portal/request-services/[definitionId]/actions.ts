'use server';

import { withAuth, type AuthContext } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { IUserWithRoles } from '@alga-psa/types';
import { getAuthenticatedClientId } from '@alga-psa/client-portal/lib/clientAuth';
import { redirect } from 'next/navigation';
import {
  getVisiblePublishedServiceRequestDefinitionDetail,
  submitPortalServiceRequest,
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
    const attachments: { fieldKey: string; fileId: string }[] = [];

    for (const field of fields) {
      if (!field || typeof field.key !== 'string') {
        continue;
      }

      if (field.type === 'file-upload') {
        const fileIdValue = formData.get(`${field.key}__fileId`);
        if (typeof fileIdValue === 'string' && fileIdValue.trim().length > 0) {
          attachments.push({
            fieldKey: field.key,
            fileId: fileIdValue.trim(),
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

    try {
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
      redirect(`/client-portal/request-services/${definitionId}?submitted=${encodeURIComponent(result.submissionId)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'submit_failed';
      redirect(`/client-portal/request-services/${definitionId}?error=${encodeURIComponent(message)}`);
    }
  });
});
