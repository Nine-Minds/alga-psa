'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { redactTaskCommentReactions, validateEmoji } from '@alga-psa/types';
import type { IReactionsBatchResult, IUserWithRoles } from '@alga-psa/types';
import {
  getTaskCommentsReactionsBatchWithDb,
  toggleTaskCommentReactionWithDb,
} from '../lib/taskComments/taskCommentService';
import { collaborationFieldPolicy } from '../lib/taskComments/taskCommentCollaboration';
import { withTaskCommentAccess, withTaskCommentBatchReadAccess } from '../lib/taskComments/taskCommentAuthorization';

// Reaction queries live in ../lib/taskComments/taskCommentService, shared with
// the REST API; these actions only add the web's auth context.

/**
 * Toggle a reaction on a project task comment.
 * If the user already reacted with this emoji, removes it. Otherwise, adds it.
 */
export const toggleTaskCommentReaction = withAuth(async (
  user,
  { tenant },
  taskCommentId: string,
  emoji: string
): Promise<{ added: boolean }> => {
  // Input validation touches no data, so it stays ahead of the authorization boundary.
  validateEmoji(emoji);
  const { knex: db } = await createTenantKnex();
  return withTaskCommentAccess(db, tenant, user as IUserWithRoles, { taskCommentId }, 'react', ({ trx, collaboration }) =>
    toggleTaskCommentReactionWithDb(trx, tenant, user.user_id, taskCommentId, emoji, { collaboration }));
});

/**
 * Get aggregated reactions for multiple task comments in a single query.
 * Also returns display names for all reacting users.
 */
export const getTaskCommentsReactionsBatch = withAuth(async (
  user,
  { tenant },
  taskCommentIds: string[]
): Promise<IReactionsBatchResult> => {
  const { knex: db } = await createTenantKnex();
  return withTaskCommentBatchReadAccess(db, tenant, user as IUserWithRoles, { taskCommentIds }, 'read', async ({ trx, ids, collaboration, taskIdByComment }) => {
    const batch = await getTaskCommentsReactionsBatchWithDb(trx, tenant, user.user_id, ids);
    if (!collaboration || !taskIdByComment) return batch;
    // Counts stay inside the audience; reactor identities follow each task's redaction policy (the single redaction function).
    const hiddenFor = (commentId: string) => collaborationFieldPolicy(collaboration, taskIdByComment.get(commentId) ?? '');
    const reactions: IReactionsBatchResult['reactions'] = {};
    let userNames = batch.userNames;
    for (const [commentId, list] of Object.entries(batch.reactions)) {
      const policy = collaborationFieldPolicy(collaboration, taskIdByComment.get(commentId) ?? '');
      const redacted = redactTaskCommentReactions({ reactions: { [commentId]: list }, userNames: batch.userNames }, policy);
      reactions[commentId] = redacted.reactions[commentId];
      // The name map is shared across comments: one hidden thread drops it for the whole response.
      if (policy.hideReactors) userNames = {};
    }
    return { reactions, userNames };
  });
});
