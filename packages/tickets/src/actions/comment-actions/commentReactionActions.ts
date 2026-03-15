'use server';

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { aggregateReactions, validateEmoji } from '@alga-psa/types';
import type { IReactionsBatchResult } from '@alga-psa/types';

/**
 * Toggle a reaction on a ticket comment.
 * If the user already reacted with this emoji, removes it. Otherwise, adds it.
 */
export const toggleCommentReaction = withAuth(async (
  user,
  { tenant },
  commentId: string,
  emoji: string
): Promise<{ added: boolean }> => {
  validateEmoji(emoji);
  const { knex: db } = await createTenantKnex();
  const userId = user.user_id;

  return withTransaction(db, async (trx) => {
    const existing = await trx('comment_reactions')
      .where({ tenant, comment_id: commentId, user_id: userId, emoji })
      .first();

    if (existing) {
      await trx('comment_reactions')
        .where({ tenant, reaction_id: existing.reaction_id })
        .del();
      return { added: false };
    }

    await trx('comment_reactions')
      .insert({ tenant, comment_id: commentId, user_id: userId, emoji });

    return { added: true };
  });
});

/**
 * Get aggregated reactions for multiple ticket comments in a single query.
 * Also returns display names for all reacting users.
 */
export const getCommentsReactionsBatch = withAuth(async (
  user,
  { tenant },
  commentIds: string[]
): Promise<IReactionsBatchResult> => {
  if (commentIds.length === 0) return { reactions: {}, userNames: {} };

  const { knex: db } = await createTenantKnex();
  const currentUserId = user.user_id;

  const rows = await db('comment_reactions')
    .where({ tenant })
    .whereIn('comment_id', commentIds)
    .select('comment_id', 'emoji', 'user_id')
    .orderBy('created_at', 'asc');

  const reactions = aggregateReactions(rows, 'comment_id', currentUserId);

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
