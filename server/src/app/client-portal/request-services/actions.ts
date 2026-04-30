'use server';

import { withAuth, type AuthContext } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { IUserWithRoles } from '@alga-psa/types';
import { getAuthenticatedClientId } from '@alga-psa/client-portal/lib/clientAuth';
import {
  groupServiceRequestCatalogItemsByCategory,
  listVisibleServiceRequestCatalogItems,
  listClientServiceRequestSubmissions,
  type ServiceRequestClientSubmissionListRow,
  type ServiceRequestPortalCatalogGroup,
} from '../../../lib/service-requests';

export const listRequestServiceCatalogGroupsAction = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: AuthContext
): Promise<ServiceRequestPortalCatalogGroup[]> => {
  if (currentUser.user_type !== 'client') {
    return [];
  }

  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    const clientId = await getAuthenticatedClientId(trx, currentUser.user_id, tenant);
    const items = await listVisibleServiceRequestCatalogItems(trx, {
      tenant,
      requesterUserId: currentUser.user_id,
      clientId,
      contactId: currentUser.contact_id ?? null,
    });
    return groupServiceRequestCatalogItemsByCategory(items);
  });
});

export const listMyRecentServiceRequestsAction = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: AuthContext,
  limit: number = 5,
): Promise<ServiceRequestClientSubmissionListRow[]> => {
  if (currentUser.user_type !== 'client') {
    return [];
  }

  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    const clientId = await getAuthenticatedClientId(trx, currentUser.user_id, tenant);
    const all = await listClientServiceRequestSubmissions(trx, tenant, clientId);
    return all.slice(0, Math.max(1, limit));
  });
});
