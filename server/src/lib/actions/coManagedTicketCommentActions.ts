'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { requireCapabilityForAction } from '@alga-psa/core/capability/server';
import { CoManagedLifecycleError } from '@alga-psa/licensing/lifecycle-error';
import { CoManagedCommentCreateError, CoManagedSharedWorkError, type CoManagedSharedResource,
  type CoManagedCommentCreateRequest, type CoManagedCommentCreateReceipt } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from '../co-managed/browserActor';
import { createSharedTicketComment } from '../co-managed/createTicketComment';

export type CoManagedCommentCreateResult = { ok: true; receipt: CoManagedCommentCreateReceipt } |
  { ok: false; code: 'invalid' | 'operationConflict' | 'forbidden' | 'readOnly' | 'unknownOutcome' };

// Writing shared work admits a new mutation, so the action gates on `admits`.
export const createCoManagedTicketCommentAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource,
  request: CoManagedCommentCreateRequest): Promise<CoManagedCommentCreateResult> => {
  await requireCapabilityForAction('co-managed', tenant, 'admits');
  try {
    const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
    return { ok: true, receipt: await createSharedTicketComment(knex, actor, resource, request) };
  } catch (error) {
    if (error instanceof CoManagedSharedWorkError) return { ok: false, code: 'forbidden' };
    if (error instanceof CoManagedLifecycleError) return { ok: false, code: 'readOnly' };
    if (error instanceof CoManagedCommentCreateError) return { ok: false, code: error.code === 'INVALID_COMMENT_CREATE' ? 'invalid' : 'operationConflict' };
    return { ok: false, code: 'unknownOutcome' };
  }
});
