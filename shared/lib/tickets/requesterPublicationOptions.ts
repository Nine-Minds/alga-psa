import { TicketConversationError, conversationUuid } from './namedConversations';

/** Explicit human publication intent, separate from generated message content. */
export interface RequesterPublicationOptions { isResolution: true; close?: { statusId: string; overrideReason?: string } }
export function snapshotRequesterPublicationOptions(input: unknown): RequesterPublicationOptions | null {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['isResolution', 'close'].includes(key)) ||
      (input as RequesterPublicationOptions).isResolution !== true) throw new TicketConversationError('CONVERSATION_INVALID');
  const close = (input as RequesterPublicationOptions).close;
  if (close === undefined) return { isResolution: true };
  if (!close || typeof close !== 'object' || Array.isArray(close) || !conversationUuid(close.statusId) ||
      Object.keys(close).some(key => !['statusId', 'overrideReason'].includes(key)) ||
      (close.overrideReason !== undefined && (typeof close.overrideReason !== 'string' || close.overrideReason.length > 4000 || close.overrideReason.includes('\0'))))
    throw new TicketConversationError('CONVERSATION_INVALID');
  return { isResolution: true, close: { statusId: close.statusId.toLowerCase(), ...(close.overrideReason !== undefined ? { overrideReason: close.overrideReason } : {}) } };
}
