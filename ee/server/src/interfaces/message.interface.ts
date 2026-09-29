import { TenantEntity } from '@/interfaces/index';

export interface IMessage extends TenantEntity {
  id?: string;
  chat_id: string | null;
  chat_role: string;
  content: string;
  thumb: string | null;
  feedback: string | null;
  message_order?: number;
}

/**
 * The only columns a caller may mutate through the message update paths.
 * Identity, tenant and chat-association columns are deliberately excluded so a
 * partial update payload can never re-parent a message or cross tenants.
 */
export const MESSAGE_MUTABLE_COLUMNS = ['content', 'thumb', 'feedback', 'message_order'] as const;

export type MessageMutableColumn = (typeof MESSAGE_MUTABLE_COLUMNS)[number];

export type MessageUpdates = Partial<Pick<IMessage, MessageMutableColumn>>;

export function pickMessageUpdates(message: Partial<IMessage>): MessageUpdates {
  const updates: MessageUpdates = {};
  for (const column of MESSAGE_MUTABLE_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(message, column)) {
      (updates as Record<string, unknown>)[column] = (message as Record<string, unknown>)[column];
    }
  }
  return updates;
}
