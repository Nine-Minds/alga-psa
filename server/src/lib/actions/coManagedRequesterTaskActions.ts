'use server';
import { withAuth } from '@alga-psa/auth';
import { getConnection, withTransaction } from '@alga-psa/db';
import { requireCapabilityEitherMode, requireCapabilityForAction } from '@alga-psa/core/capability/server';
import { getRequesterTaskConversation, createRequesterTaskComment, listRequesterSharedTaskIds, type RequesterTaskReply } from '@alga-psa/co-managed/requesterTaskConversation';
import type { RequesterTaskTarget } from '@alga-psa/co-managed/requesterTaskConversation';
import { coManagedPortalBrowserActor } from '../co-managed/browserActor';

// The requester is a portal CONTACT. The actor comes from the verified portal session; `target` is only a
// locator that withRequesterTaskAccess re-authorizes against the contact's own client and task visibility.
// Reads serve what exists; writes require the capability to admit. No email is sent for requester threads.

export const getRequesterTaskConversationAction = withAuth(async (user, { tenant }, target: RequesterTaskTarget, before?: { createdAt: string; commentId: string }) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  const actor = await coManagedPortalBrowserActor(user, tenant);
  return getRequesterTaskConversation(await getConnection(tenant), actor, target, before);
});

export const createRequesterTaskCommentAction = withAuth(async (user, { tenant }, target: RequesterTaskTarget, input: RequesterTaskReply) => {
  await requireCapabilityEitherMode('co-managed', tenant);
  const actor = await coManagedPortalBrowserActor(user, tenant);
  return withTransaction(await getConnection(tenant), trx => createRequesterTaskComment(trx, actor, target, input));
});

/** Which tasks of this project are shared work a requester may converse on. The portal's button and deep link
 * depend on this answer (plus the capability serving); it is the same predicate the two actions above enforce. */
export const getRequesterSharedTaskIdsAction = withAuth(async (user, { tenant }, projectId: string) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  const actor = await coManagedPortalBrowserActor(user, tenant);
  return listRequesterSharedTaskIds(await getConnection(tenant), actor, projectId);
});
