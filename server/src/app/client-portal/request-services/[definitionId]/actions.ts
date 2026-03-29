'use server';

import { withAuth, type AuthContext } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { IUserWithRoles } from '@alga-psa/types';
import { getAuthenticatedClientId } from '@alga-psa/client-portal/lib/clientAuth';
import {
  getVisiblePublishedServiceRequestDefinitionDetail,
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
