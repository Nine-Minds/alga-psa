'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { CoManagedLifecycleError } from '@alga-psa/licensing';
import { mutateCoManagedPrivateTicketComment, CoManagedPrivateCommentError, CoManagedSharedWorkError,
  type CoManagedSharedResource, type CoManagedPrivateCommentCommand, type CoManagedPrivateCommentReceipt } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from '../co-managed/browserActor';

export type CoManagedPrivateCommentResult = { ok: true; receipt: CoManagedPrivateCommentReceipt } |
  { ok: false; code: 'invalid' | 'conflict' | 'operationConflict' | 'forbidden' | 'readOnly' | 'unknownOutcome' };

export const saveCoManagedPrivateTicketCommentAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource,
  request: CoManagedPrivateCommentCommand): Promise<CoManagedPrivateCommentResult> => {
  try {
    const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
    return { ok: true, receipt: await mutateCoManagedPrivateTicketComment(knex, actor, resource, request) };
  } catch (error) {
    if (error instanceof CoManagedSharedWorkError) return { ok: false, code: 'forbidden' };
    if (error instanceof CoManagedLifecycleError) return { ok: false, code: 'readOnly' };
    if (error instanceof CoManagedPrivateCommentError) return { ok: false, code: {
      INVALID_PRIVATE_COMMENT: 'invalid', PRIVATE_COMMENT_CONFLICT: 'conflict', PRIVATE_COMMENT_OPERATION_CONFLICT: 'operationConflict',
    }[error.code] as 'invalid' | 'conflict' | 'operationConflict' };
    // A dropped response around COMMIT must preserve the exact operation for retry.
    return { ok: false, code: 'unknownOutcome' };
  }
});
