'use server'

import { createTenantKnex } from '@/lib/db';
import { IChat } from '../../interfaces/chat.interface';
import { IMessage } from '../../interfaces/message.interface';
import Chat from '../../models/chat';
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
    const conversation = await Chat.insert(chatPayload as IChat);
    return { _id: conversation.id, persisted: true };
  } catch (error) {
    if (isMissingRelationError(error)) {
      markPersistenceStatus(false);
      console.warn(
        '[chatActions] Chat table missing during insert; continuing without persistence.',
      );
      return { _id: chatId, persisted: false };
    }
    console.error(error);
    throw new Error('Failed to create new chat');
  }
}

export async function addMessageToChatAction(data: Omit<IMessage, 'tenant'>) {
  if (!(await isChatPersistenceAvailable())) {
    return { _id: uuidv4(), persisted: false };
  }

  try {
    const message = await Message.insert(data);
    return { _id: message.id, persisted: true };
  } catch (error) {
    if (isMissingRelationError(error)) {
      markPersistenceStatus(false);
      console.warn(
        '[chatActions] Messages table missing during insert; continuing without persistence.',
      );
      return { _id: uuidv4(), persisted: false };
    }
    console.error(error);
    throw new Error('Failed to add message to chat');
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
    if (isMissingRelationError(error)) {
      markPersistenceStatus(false);
      console.warn(
        '[chatActions] Messages table missing during chat fetch; continuing without persistence.',
      );
      return [];
    }
    console.error(error);
    throw new Error('Failed to fetch chat messages');
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
    if (isMissingRelationError(error)) {
      markPersistenceStatus(false);
      console.warn(
        '[chatActions] Messages table missing during update; continuing without persistence.',
      );
      return 'skipped';
    }
    console.error(error);
    throw new Error('Failed to update message');
  }
}
