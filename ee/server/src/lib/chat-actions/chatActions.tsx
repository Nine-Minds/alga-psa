'use server'

import { createTenantKnex, runWithTenant } from '@/lib/db';
import { tenantDb } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { IChat } from '../../interfaces/chat.interface';
import { IMessage } from '../../interfaces/message.interface';
import Chat, { IChatHistoryItem } from '../../models/chat';
import Message from '../../models/message';
import { v4 as uuidv4 } from 'uuid';

const PERSISTENCE_CACHE_WINDOW_MS = 60_000;
let cachedPersistenceStatus: boolean | null = null;
let lastPersistenceCheck = 0;

const isMissingRelationError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: string }).code === '42P01';

const isMissingColumnError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: string }).code === '42703';

const EXPECTED_CHAT_PERSISTENCE_ERROR_CODES = new Set([
  '22P02',
  '23502',
  '23503',
  '23505',
]);

const isMissingTenantError = (error: unknown) =>
  error instanceof Error && error.message === 'Missing tenant for chat persistence';

const isExpectedChatPersistenceError = (error: unknown) =>
  isMissingRelationError(error) ||
  isMissingColumnError(error) ||
  isMissingTenantError(error) ||
  (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    EXPECTED_CHAT_PERSISTENCE_ERROR_CODES.has(String((error as { code?: string }).code))
  );

function markPersistenceUnavailableIfSchemaMissing(error: unknown): void {
  if (isMissingRelationError(error)) {
    markPersistenceStatus(false);
  }
}

const shouldRecheckPersistence = () => {
  if (cachedPersistenceStatus === null) {
    return true;
  }
  const now = Date.now();
  return now - lastPersistenceCheck > PERSISTENCE_CACHE_WINDOW_MS;
};

const markPersistenceStatus = (status: boolean) => {
  cachedPersistenceStatus = status;
  lastPersistenceCheck = Date.now();
};

async function isChatPersistenceAvailable(): Promise<boolean> {
  if (!shouldRecheckPersistence()) {
    return cachedPersistenceStatus as boolean;
  }

  try {
    const { knex } = await createTenantKnex();
    const [hasChats, hasMessages] = await Promise.all([
      knex.schema.hasTable('chats'),
      knex.schema.hasTable('messages'),
    ]);

    const available = hasChats && hasMessages;
    if (!available) {
      console.warn(
        '[chatActions] Chat persistence tables are missing; chat history will not be stored.',
      );
    }
    markPersistenceStatus(available);
    return available;
  } catch (error) {
    console.error('[chatActions] Failed to verify chat persistence availability', error);
    markPersistenceStatus(false);
    return false;
  }
}

export async function createNewChatAction(data: Omit<IChat, 'tenant'>) {
  const chatId = data.id ?? uuidv4();
  const chatPayload: Omit<IChat, 'tenant'> = {
    ...data,
    id: chatId,
  };

  if (!(await isChatPersistenceAvailable())) {
    return { _id: chatId, persisted: false };
  }

  try {
    const user = await getCurrentUser();
    const tenant = user?.tenant;
    if (!tenant) {
      throw new Error('Missing tenant for chat persistence');
    }
    const conversation = await runWithTenant(tenant, () => Chat.insert(chatPayload as IChat));
    return { _id: conversation.id, persisted: true };
  } catch (error) {
    if (isExpectedChatPersistenceError(error)) {
      markPersistenceUnavailableIfSchemaMissing(error);
      console.warn(
        '[chatActions] Chat insert could not be persisted; continuing without persistence.',
        error,
      );
      return { _id: chatId, persisted: false };
    }
    console.error(error);
    throw error;
  }
}

export async function addMessageToChatAction(data: Omit<IMessage, 'tenant'>) {
  if (!(await isChatPersistenceAvailable())) {
    return { _id: uuidv4(), persisted: false };
  }

  try {
    const user = await getCurrentUser();
    const tenant = user?.tenant;
    if (!tenant) {
      throw new Error('Missing tenant for chat persistence');
    }

    const message = await runWithTenant(tenant, async () => {
      const inserted = await Message.insert(data);
      if (data.chat_id) {
        try {
          const { knex } = await createTenantKnex();
          await tenantDb(knex, tenant).table<IChat>('chats')
            .where({ id: data.chat_id })
            .update({ updated_at: knex.fn.now() });
        } catch (touchError) {
          if (
            typeof touchError === 'object' &&
            touchError !== null &&
            'code' in touchError &&
            (touchError as { code?: string }).code === '42703'
          ) {
            console.warn(
              '[chatActions] chats.updated_at column missing; skipping chat recency update.',
            );
          } else {
            throw touchError;
          }
        }
      }
      return inserted;
    });
    return { _id: message.id, persisted: true };
  } catch (error) {
    if (isExpectedChatPersistenceError(error)) {
      markPersistenceUnavailableIfSchemaMissing(error);
      console.warn(
        '[chatActions] Message insert could not be persisted; continuing without persistence.',
        error,
      );
      return { _id: uuidv4(), persisted: false };
    }
    console.error(error);
    throw error;
  }
}

export async function getChatMessagesAction(chatId: string) {
  if (!chatId) {
    return [];
  }

  if (!(await isChatPersistenceAvailable())) {
    return [];
  }

  try {
    return await Message.getByChatId(chatId);
  } catch (error) {
    if (isExpectedChatPersistenceError(error)) {
      markPersistenceUnavailableIfSchemaMissing(error);
      console.warn(
        '[chatActions] Messages could not be fetched; continuing without persisted history.',
        error,
      );
      return [];
    }
    console.error(error);
    throw error;
  }
}

export type ChatHistoryItem = Pick<
  IChatHistoryItem,
  'id' | 'title_text' | 'title_is_locked' | 'created_at' | 'updated_at' | 'preview_text'
>;

export async function listCurrentUserChatsAction(limit = 20): Promise<ChatHistoryItem[]> {
  if (!(await isChatPersistenceAvailable())) {
    return [];
  }

  const user = await getCurrentUser();
  if (!user?.user_id) {
    return [];
  }

  try {
    return await Chat.getRecentByUser(user.user_id, limit, user.tenant);
  } catch (error) {
    if (isExpectedChatPersistenceError(error)) {
      markPersistenceUnavailableIfSchemaMissing(error);
      console.warn(
        '[chatActions] Chat listing unavailable; continuing without persisted history.',
        error,
      );
      return [];
    }
    console.error(error);
    throw error;
  }
}

export async function searchCurrentUserChatsAction(
  query: string,
  limit = 20
): Promise<ChatHistoryItem[]> {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 2) {
    return [];
  }

  if (!(await isChatPersistenceAvailable())) {
    return [];
  }

  const user = await getCurrentUser();
  if (!user?.user_id) {
    return [];
  }

  try {
    return await Chat.searchByUser(user.user_id, trimmedQuery, limit, user.tenant);
  } catch (error) {
    if (isExpectedChatPersistenceError(error)) {
      markPersistenceUnavailableIfSchemaMissing(error);
      console.warn(
        '[chatActions] Chat search unavailable during rollout; continuing without search results.',
        error,
      );
      return [];
    }
    console.error(error);
    throw error;
  }
}

export async function renameCurrentUserChatAction(chatId: string, title: string): Promise<boolean> {
  if (!chatId) {
    return false;
  }

  if (!(await isChatPersistenceAvailable())) {
    return false;
  }

  const user = await getCurrentUser();
  if (!user?.user_id) {
    return false;
  }

  const nextTitle = title.trim();
  if (!nextTitle.length) {
    return false;
  }

  try {
    return await Chat.updateTitleForUser(chatId, user.user_id, nextTitle);
  } catch (error) {
    if (isExpectedChatPersistenceError(error)) {
      markPersistenceUnavailableIfSchemaMissing(error);
      console.warn(
        '[chatActions] Chat rename could not be persisted; continuing without persistence.',
        error,
      );
      return false;
    }
    console.error(error);
    throw error;
  }
}

export async function deleteCurrentUserChatAction(chatId: string): Promise<boolean> {
  if (!chatId) {
    return false;
  }

  if (!(await isChatPersistenceAvailable())) {
    return false;
  }

  const user = await getCurrentUser();
  if (!user?.user_id) {
    return false;
  }

  try {
    return await Chat.deleteForUser(chatId, user.user_id);
  } catch (error) {
    if (isExpectedChatPersistenceError(error)) {
      markPersistenceUnavailableIfSchemaMissing(error);
      console.warn(
        '[chatActions] Chat delete could not be persisted; continuing without persistence.',
        error,
      );
      return false;
    }
    console.error(error);
    throw error;
  }
}

export async function updateMessageAction(id: string, data: Partial<IMessage>) {
  if (!(await isChatPersistenceAvailable())) {
    return 'skipped';
  }

  try {
    await Message.update(id, data);
    return 'success';
  } catch (error) {
    if (isExpectedChatPersistenceError(error)) {
      markPersistenceUnavailableIfSchemaMissing(error);
      console.warn(
        '[chatActions] Message update could not be persisted; continuing without persistence.',
        error,
      );
      return 'skipped';
    }
    console.error(error);
    throw error;
  }
}
