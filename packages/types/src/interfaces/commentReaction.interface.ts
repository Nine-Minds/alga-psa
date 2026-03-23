/**
 * Aggregated reaction for display — groups individual user reactions by emoji.
 * Used by both ticket comments and project task comments.
 */
export interface IAggregatedReaction {
  emoji: string;
  count: number;
  userIds: string[];
  currentUserReacted: boolean;
}

/**
 * Return type for batch reaction queries.
 * Includes both aggregated reactions and display names for all reacting users.
 */
export interface IReactionsBatchResult {
  reactions: Record<string, IAggregatedReaction[]>;
  userNames: Record<string, string>;
}

const MAX_EMOJI_LENGTH = 50;

/**
 * Validate emoji string length to prevent abuse.
 */
export function validateEmoji(emoji: string): void {
  if (!emoji || emoji.length > MAX_EMOJI_LENGTH) {
    throw new Error(`Invalid emoji: must be between 1 and ${MAX_EMOJI_LENGTH} characters`);
  }
}

/**
 * Aggregate raw reaction rows into IAggregatedReaction[] grouped by parent ID.
 * Shared by both ticket comment and project task comment reaction actions.
 */
export function aggregateReactions(
  rows: Array<{ emoji: string; user_id: string; [key: string]: any }>,
  parentIdColumn: string,
  currentUserId: string
): Record<string, IAggregatedReaction[]> {
  const map = new Map<string, Map<string, string[]>>();

  for (const row of rows) {
    const parentId = row[parentIdColumn];
    if (!map.has(parentId)) map.set(parentId, new Map());
    const emojiMap = map.get(parentId)!;
    if (!emojiMap.has(row.emoji)) emojiMap.set(row.emoji, []);
    emojiMap.get(row.emoji)!.push(row.user_id);
  }

  const result: Record<string, IAggregatedReaction[]> = {};
  for (const [parentId, emojiMap] of map) {
    result[parentId] = Array.from(emojiMap.entries()).map(([emoji, userIds]) => ({
      emoji,
      count: userIds.length,
      userIds,
      currentUserReacted: userIds.includes(currentUserId),
    }));
  }

  return result;
}
