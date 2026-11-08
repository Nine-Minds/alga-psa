'use server';

import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { aggregateReactions, validateEmoji } from '@alga-psa/types';
import type { IReactionsBatchResult } from '@alga-psa/types';
import { resolveReactionTargets } from '../../lib/commentReactionAccess';
import { publishTicketUpdate } from '../../lib/liveUpdates';

function formatLiveUpdateDisplayName(user: any): string {
  return `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || user?.username || 'Unknown User';
}

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
    // Reacting writes to the comment's thread: the caller must be able to see that comment.
    // Missing, hidden and unauthorized comments all produce the same denial.
    const { authorized } = await resolveReactionTargets(trx, tenant, user as any, [commentId], 'update');
    const target = authorized.get(commentId);
    if (!target) throw new Error('Permission denied: Cannot access ticket');

    const existing = await tenantDb(trx, tenant).table('comment_reactions')
      .where({ comment_id: commentId, user_id: userId, emoji })
      .first();

    let added = true;
    if (existing) {
      await tenantDb(trx, tenant).table('comment_reactions')
        .where({ reaction_id: existing.reaction_id })
        .del();
      added = false;
    } else {
      await tenantDb(trx, tenant).table('comment_reactions')
        .insert({ tenant, comment_id: commentId, user_id: userId, emoji });
    }

    await publishTicketUpdate({
      tenantId: tenant,
      ticketId: target.ticket_id,
      updatedFields: ['comment_reactions'],
      updatedBy: {
        userId,
        displayName: formatLiveUpdateDisplayName(user),
      },
      updatedAt: new Date().toISOString(),
    });

    return { added };
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

  // Only reactions on comments the caller may read; hidden/missing IDs are silently omitted.
  const { authorized } = await resolveReactionTargets(db, tenant, user as any, commentIds, 'read');
  if (authorized.size === 0) return { reactions: {}, userNames: {} };

  const rows = await tenantDb(db, tenant).table('comment_reactions')
    .whereIn('comment_id', [...authorized.keys()])
    .select('comment_id', 'emoji', 'user_id')
    .orderBy('created_at', 'asc');

  const reactions = aggregateReactions(rows, 'comment_id', currentUserId);

  // Collect unique user IDs and fetch display names
  const allUserIds = [...new Set(rows.map(r => r.user_id))];
  const userNames: Record<string, string> = {};
  if (allUserIds.length > 0) {
    const users = await tenantDb(db, tenant).table('users')
      .whereIn('user_id', allUserIds)
      .select('user_id', 'first_name', 'last_name');
    for (const u of users) {
      userNames[u.user_id] = `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Unknown';
    }
  }

  return { reactions, userNames };
});
