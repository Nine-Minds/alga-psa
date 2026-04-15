'use server';

import { withAuth, type AuthContext } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { IUserWithRoles } from '@alga-psa/types';
import { getAuthenticatedClientId } from '@alga-psa/client-portal/lib/clientAuth';
import {
  listClientServiceRequestSubmissions,
  getClientServiceRequestSubmissionDetail,
  type ServiceRequestClientSubmissionListRow,
  type ServiceRequestClientSubmissionDetail,
} from '../../../../lib/service-requests';

export const listMyServiceRequestSubmissionsAction = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: AuthContext
): Promise<ServiceRequestClientSubmissionListRow[]> => {
  if (currentUser.user_type !== 'client') {
    return [];
  }

  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    const clientId = await getAuthenticatedClientId(trx, currentUser.user_id, tenant);
    return listClientServiceRequestSubmissions(trx, tenant, clientId);
  });
});

export const getMyServiceRequestSubmissionDetailAction = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: AuthContext,
  submissionId: string
): Promise<ServiceRequestClientSubmissionDetail | null> => {
  if (currentUser.user_type !== 'client') {
    return null;
  }

  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    const clientId = await getAuthenticatedClientId(trx, currentUser.user_id, tenant);
    return getClientServiceRequestSubmissionDetail(trx, tenant, clientId, submissionId);
  });
});
