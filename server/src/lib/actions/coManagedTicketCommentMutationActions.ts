'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { CoManagedLifecycleError } from '@alga-psa/licensing';
import { CoManagedCommentMutationError, CoManagedSharedWorkError, type CoManagedSharedResource,
  type CoManagedCommentMutationRequest, type CoManagedCommentMutationReceipt } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from '../co-managed/browserActor';
import { mutateSharedTicketComment } from '../co-managed/mutateTicketComment';

export type CoManagedCommentMutationResult = { ok: true; receipt: CoManagedCommentMutationReceipt } |
  { ok: false; code: 'invalid' | 'conflict' | 'operationConflict' | 'forbidden' | 'readOnly' | 'unknownOutcome' };
export const mutateCoManagedTicketCommentAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource,
  request: CoManagedCommentMutationRequest): Promise<CoManagedCommentMutationResult> => {
  try {
    const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
    return { ok: true, receipt: await mutateSharedTicketComment(knex, actor, resource, request) };
  } catch (error) {
    if (error instanceof CoManagedSharedWorkError) return { ok: false, code: 'forbidden' };
    if (error instanceof CoManagedLifecycleError) return { ok: false, code: 'readOnly' };
    if (error instanceof CoManagedCommentMutationError) return { ok: false, code: error.code === 'INVALID_COMMENT_MUTATION' ? 'invalid'
      : error.code === 'COMMENT_MUTATION_CONFLICT' ? 'conflict' : 'operationConflict' };
    return { ok: false, code: 'unknownOutcome' };
  }
});
