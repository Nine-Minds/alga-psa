'use server';

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { aggregateReactions, validateEmoji } from '@alga-psa/types';
import type { IReactionsBatchResult } from '@alga-psa/types';

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
  validateEmoji(emoji);
  const { knex: db } = await createTenantKnex();
  const userId = user.user_id;

  return withTransaction(db, async (trx) => {
    const existing = await trx('project_task_comment_reactions')
      .where({ tenant, task_comment_id: taskCommentId, user_id: userId, emoji })
      .first();

    if (existing) {
      await trx('project_task_comment_reactions')
        .where({ tenant, reaction_id: existing.reaction_id })
        .del();
      return { added: false };
    }

    await trx('project_task_comment_reactions')
      .insert({ tenant, task_comment_id: taskCommentId, user_id: userId, emoji });

    return { added: true };
  });
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
  if (taskCommentIds.length === 0) return { reactions: {}, userNames: {} };

  const { knex: db } = await createTenantKnex();
  const currentUserId = user.user_id;

  const rows = await db('project_task_comment_reactions')
    .where({ tenant })
    .whereIn('task_comment_id', taskCommentIds)
    .select('task_comment_id', 'emoji', 'user_id')
    .orderBy('created_at', 'asc');

  const reactions = aggregateReactions(rows, 'task_comment_id', currentUserId);

  // Collect unique user IDs and fetch display names
  const allUserIds = [...new Set(rows.map(r => r.user_id))];
  const userNames: Record<string, string> = {};
  if (allUserIds.length > 0) {
    const users = await db('users')
      .where({ tenant })
      .whereIn('user_id', allUserIds)
      .select('user_id', 'first_name', 'last_name');
    for (const u of users) {
      userNames[u.user_id] = `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Unknown';
    }
  }

  return { reactions, userNames };
});
