'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, withTransaction, registerAfterCommitWithConnection } from '@alga-psa/db';
import { isCoManagedLifecycleError } from '@alga-psa/licensing';
import { getCoManagedProjectTaskConversation, getCoManagedProjectTaskWriteAudiences, mutateCoManagedProjectTaskComment,
  assertCoManagedSessionUnexpired, dispatchCoManagedConversationEvents, CoManagedTaskCommentError, CoManagedPrivateCommentError, CoManagedSharedWorkError,
  type CoManagedSharedResource, type CoManagedConversationCursor, type CoManagedTaskCommentCommand } from '@alga-psa/co-managed';
import { publishCoManagedConversationEvent } from '@alga-psa/jobs/handlers/coManagedConversationEventPublication';
import { coManagedBrowserActor } from '../co-managed/browserActor';

export const getSharedProjectTaskConversationAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, before?: CoManagedConversationCursor) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  return withTransaction(knex, async trx => {
    const writeAudiences = await getCoManagedProjectTaskWriteAudiences(trx, actor, resource);
    const conversation = await getCoManagedProjectTaskConversation(trx, actor, resource, before);
    await assertCoManagedSessionUnexpired(trx, actor);
    return { ...conversation, actor: { tenant: actor.tenant, userId: actor.userId }, writeAudiences };
  });
});

export const saveSharedProjectTaskCommentAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, request: CoManagedTaskCommentCommand) => {
  try {
    const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
    const receipt = await withTransaction(knex, async trx => {
      const saved = await mutateCoManagedProjectTaskComment(trx, actor, resource, request);
      if (saved.storeTenant === resource.tenant) {
        // The domain retained the event with its mutation. Immediate publication
        // and lost-response retries use the existing outbox recovery engine.
        registerAfterCommitWithConnection(trx, root => dispatchCoManagedConversationEvents(root, saved.storeTenant,
          publishCoManagedConversationEvent, { eventId: saved.operationId }).then(() => {}), `Project task comment event=${saved.operationId}`);
      }
      return saved;
    });
    return { ok: true as const, receipt };
  } catch (error) {
    if (error instanceof CoManagedSharedWorkError) return { ok: false as const, code: 'forbidden' as const };
    if (isCoManagedLifecycleError(error)) return { ok: false as const, code: 'readOnly' as const };
    if (error instanceof CoManagedTaskCommentError || error instanceof CoManagedPrivateCommentError) {
      const code = error.code.includes('OPERATION_CONFLICT') ? 'operationConflict' : error.code.endsWith('CONFLICT') ? 'conflict' : 'invalid';
      return { ok: false as const, code };
    }
    return { ok: false as const, code: 'unknownOutcome' as const };
  }
});
