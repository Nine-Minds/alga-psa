'use server';
import { withAuth } from '@alga-psa/auth';
import { getConnection, withTransaction, registerAfterCommitWithConnection } from '@alga-psa/db';
import { dispatchCoManagedConversationEvents } from '@alga-psa/co-managed';
import { getRequesterTaskConversation, createRequesterTaskComment, type RequesterTaskTarget, type RequesterTaskReply } from '@alga-psa/co-managed';
import { publishCoManagedConversationEvent } from '@alga-psa/jobs/handlers/coManagedConversationEventPublication';
import { coManagedPortalBrowserActor } from '../co-managed/browserActor';

export const getRequesterTaskConversationAction = withAuth(async (user, { tenant }, target: RequesterTaskTarget, before?: { createdAt: string; commentId: string }) => {
  const actor = await coManagedPortalBrowserActor(user, tenant);
  return getRequesterTaskConversation(await getConnection(tenant), actor, target, before);
});
export const createRequesterTaskCommentAction = withAuth(async (user, { tenant }, target: RequesterTaskTarget, input: RequesterTaskReply) => {
  const actor = await coManagedPortalBrowserActor(user, tenant);
  return withTransaction(await getConnection(tenant), async trx => {
    const saved = await createRequesterTaskComment(trx, actor, target, input);
    registerAfterCommitWithConnection(trx, root => dispatchCoManagedConversationEvents(root, tenant, publishCoManagedConversationEvent,
      { eventId: saved.operationId }).then(() => {}), `Requester task comment event=${saved.operationId}`);
    return saved;
  });
});
