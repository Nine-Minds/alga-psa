'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { isCoManagedLifecycleError } from '@alga-psa/licensing';
import { getCoManagedTicketAssignment, listCoManagedTicketAssignees, assignCoManagedTicket, CoManagedTicketAssignmentError, CoManagedSharedWorkError, type CoManagedSharedResource, type CoManagedTicketAssignmentRequest } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from '../co-managed/browserActor';

export const getSharedTicketAssignmentAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  return getCoManagedTicketAssignment(knex, actor, resource);
});
export const listSharedTicketAssigneesAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, kind: 'user' | 'team', afterId?: string) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  return listCoManagedTicketAssignees(knex, actor, resource, kind, afterId);
});
export const assignSharedTicketAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, request: CoManagedTicketAssignmentRequest) => {
  try {
    const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
    return { ok: true as const, receipt: await assignCoManagedTicket(knex, actor, resource, request) };
  } catch (error) {
    const code = error instanceof CoManagedSharedWorkError ? 'forbidden' : isCoManagedLifecycleError(error) ? 'readOnly' : error instanceof CoManagedTicketAssignmentError ?
      error.code === 'TICKET_ASSIGNMENT_CONFLICT' ? 'conflict' : error.code === 'TICKET_ASSIGNMENT_OPERATION_CONFLICT' ? 'operationConflict' : 'invalid' : 'unknownOutcome';
    return { ok: false as const, code };
  }
});
