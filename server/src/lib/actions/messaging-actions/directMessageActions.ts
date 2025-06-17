'use server';

import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { createTenantKnex } from 'server/src/lib/db';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { 
  DirectMessage, 
  CreateDirectMessageData, 
  MessageThread, 
  MessageThreadListResult,
  MessageUser
} from 'server/src/interfaces/messaging.interfaces';
import { v4 as uuidv4 } from 'uuid';

/**
 * Send a direct message between users
 */
export async function sendDirectMessageAction(data: CreateDirectMessageData): Promise<DirectMessage> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  
  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Generate thread_id if not provided
    let threadId = data.thread_id;
    if (!threadId) {
      // Create a consistent thread ID based on sorted user IDs
      threadId = uuidv4();
    }

    const messageData = {
      direct_message_id: uuidv4(),
      tenant: tenant,
      sender_id: user.user_id,
      recipient_id: data.recipient_id,
      thread_id: threadId,
      message: data.message,
      attachments: data.attachments || null,
      created_at: new Date(),
    };

    await trx('direct_messages').insert(messageData);

    return messageData as DirectMessage;
  });
}

/**
 * Get message threads for the current user
 */
export async function getMessageThreadsAction(page: number = 1, pageSize: number = 20): Promise<MessageThreadListResult> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();

  const offset = (page - 1) * pageSize;

  // Get distinct thread IDs where user is participant
  const threadQuery = knex('direct_messages')
    .select('thread_id')
    .where(function() {
      this.where('sender_id', user.user_id)
        .orWhere('recipient_id', user.user_id);
    })
    .where('tenant', tenant)
    .whereNull('deleted_at')
    .groupBy('thread_id')
    .orderByRaw('MAX(created_at) DESC')
    .limit(pageSize)
    .offset(offset);

  const threadIds = await threadQuery;
  
  if (threadIds.length === 0) {
    return {
      threads: [],
      pagination: {
        page,
        pageSize,
        total: 0,
        pages: 0,
      },
    };
  }

  // Get thread details with last message and participant info
  const threads: MessageThread[] = [];
  
  for (const threadRow of threadIds) {
    const threadId = threadRow.thread_id;
    
    // Get last message in thread
    const lastMessage = await knex('direct_messages')
      .where('thread_id', threadId)
      .where('tenant', tenant)
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc')
      .first();

    // Get participants (users involved in this thread)
    const participantQuery = await knex('direct_messages')
      .select('sender_id', 'recipient_id')
      .where('thread_id', threadId)
      .where('tenant', tenant)
      .first();

    if (!participantQuery) continue;

    const participants = [
      participantQuery.sender_id,
      participantQuery.recipient_id,
    ].filter(Boolean);

    // Count unread messages for current user
    const unreadCountQuery = await knex('direct_messages')
      .count('direct_message_id as count')
      .where('thread_id', threadId)
      .where('recipient_id', user.user_id)
      .where('tenant', tenant)
      .whereNull('read_at')
      .whereNull('deleted_at')
      .first();

    const unreadCount = parseInt(unreadCountQuery?.count as string) || 0;

    threads.push({
      thread_id: threadId,
      participants,
      last_message: lastMessage as DirectMessage,
      unread_count: unreadCount,
      created_at: lastMessage?.created_at || new Date(),
      updated_at: lastMessage?.created_at || new Date(),
    });
  }

  // Get total count for pagination
  const totalCountQuery = await knex('direct_messages')
    .countDistinct('thread_id as count')
    .where(function() {
      this.where('sender_id', user.user_id)
        .orWhere('recipient_id', user.user_id);
    })
    .where('tenant', tenant)
    .whereNull('deleted_at')
    .first();

  const total = parseInt(totalCountQuery?.count as string) || 0;

  return {
    threads,
    pagination: {
      page,
      pageSize,
      total,
      pages: Math.ceil(total / pageSize),
    },
  };
}

/**
 * Get messages in a specific thread
 */
export async function getThreadMessagesAction(threadId: string, page: number = 1, pageSize: number = 50): Promise<DirectMessage[]> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();

  // Verify user has access to this thread
  const hasAccess = await knex('direct_messages')
    .where('thread_id', threadId)
    .where('tenant', tenant)
    .where(function() {
      this.where('sender_id', user.user_id)
        .orWhere('recipient_id', user.user_id);
    })
    .first();

  if (!hasAccess) {
    throw new Error('Access denied to this thread');
  }

  const offset = (page - 1) * pageSize;

  const messages = await knex('direct_messages')
    .where('thread_id', threadId)
    .where('tenant', tenant)
    .whereNull('deleted_at')
    .orderBy('created_at', 'desc')
    .limit(pageSize)
    .offset(offset);

  return messages.reverse(); // Return in chronological order
}

/**
 * Mark messages in a thread as read
 */
export async function markThreadAsReadAction(threadId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();

  await knex('direct_messages')
    .where('thread_id', threadId)
    .where('recipient_id', user.user_id)
    .where('tenant', tenant)
    .whereNull('read_at')
    .update({
      read_at: new Date(),
    });
}

/**
 * Get users available for messaging (search)
 */
export async function searchUsersForMessagingAction(query: string, limit: number = 10): Promise<MessageUser[]> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();

  const users = await knex('users')
    .select('user_id', 'first_name', 'last_name', 'email', 'avatar_url')
    .where('tenant', tenant)
    .where('user_id', '!=', user.user_id) // Exclude current user
    .where(function() {
      this.whereILike('first_name', `%${query}%`)
        .orWhereILike('last_name', `%${query}%`)
        .orWhereILike('email', `%${query}%`);
    })
    .limit(limit);

  return users.map((u: any) => ({
    user_id: u.user_id,
    full_name: `${u.first_name} ${u.last_name}`.trim(),
    email: u.email,
    avatar_url: u.avatar_url,
    is_online: false, // TODO: Implement online status
  }));
}

/**
 * Get unread message count for current user
 */
export async function getUnreadMessageCountAction(): Promise<number> {
  const user = await getCurrentUser();
  if (!user) {
    return 0;
  }

  const { knex, tenant } = await createTenantKnex();

  const result = await knex('direct_messages')
    .count('direct_message_id as count')
    .where('recipient_id', user.user_id)
    .where('tenant', tenant)
    .whereNull('read_at')
    .whereNull('deleted_at')
    .first();

  return parseInt(result?.count as string) || 0;
}