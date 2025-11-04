'use server';

import { createTenantKnex } from '../../db';
import { getCurrentUser } from './userActions';

export interface MentionUser {
  user_id: string;
  username: string;
  display_name: string;
  email: string;
  avatar_url: string | null;
}

/**
 * Search for users to mention in comments
 * Returns users matching the query by username, first name, or last name
 * Only returns active internal users from the same tenant
 */
export async function searchUsersForMentions(query: string = ''): Promise<MentionUser[]> {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    console.error('[searchUsersForMentions] Not authenticated');
    throw new Error('Not authenticated');
  }

  const { knex } = await createTenantKnex();

  try {
    console.log('[searchUsersForMentions] Searching with query:', query);
    const searchPattern = `%${query.toLowerCase()}%`;

    let queryBuilder = knex('users')
      .select(
        'user_id',
        'username',
        knex.raw("CONCAT(first_name, ' ', last_name) as display_name"),
        'email'
      )
      .where('tenant', currentUser.tenant)
      .andWhere('user_type', 'internal') // Only internal MSP users can be mentioned
      .andWhere('is_inactive', false); // Only active users

    // Add search filter if query is provided
    if (query && query.trim()) {
      queryBuilder = queryBuilder.andWhere(function() {
        this.whereRaw('LOWER(username) LIKE ?', [searchPattern])
          .orWhereRaw('LOWER(first_name) LIKE ?', [searchPattern])
          .orWhereRaw('LOWER(last_name) LIKE ?', [searchPattern])
          .orWhereRaw("LOWER(CONCAT(first_name, ' ', last_name)) LIKE ?", [searchPattern]);
      });
    }

    const users = await queryBuilder
      .orderBy('first_name')
      .limit(10);

    console.log('[searchUsersForMentions] Found users:', users.length);

    const results = users.map(user => ({
      user_id: user.user_id,
      username: user.username || user.email.split('@')[0], // Fallback to email prefix if no username
      display_name: user.display_name,
      email: user.email,
      avatar_url: null // TODO: Add avatar support when implemented
    }));

    console.log('[searchUsersForMentions] Returning results:', results);
    return results;
  } catch (error) {
    console.error('[searchUsersForMentions] Error:', error);
    throw error;
  }
}
