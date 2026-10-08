'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import type { IReactionsBatchResult } from '@alga-psa/types';
import {
  getTaskCommentsReactionsBatchWithDb,
  toggleTaskCommentReactionWithDb,
} from '../lib/taskComments/taskCommentService';

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
  const { knex: db } = await createTenantKnex();
  return toggleTaskCommentReactionWithDb(db, tenant, user.user_id, taskCommentId, emoji);
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
  return getTaskCommentsReactionsBatchWithDb(db, tenant, user.user_id, taskCommentIds);
});
