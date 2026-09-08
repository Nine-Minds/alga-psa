import { TicketConversationError } from './namedConversations';

/** Explicit human publication intent, separate from generated message content. */
export interface RequesterPublicationOptions { isResolution: true }
export function snapshotRequesterPublicationOptions(input: unknown): RequesterPublicationOptions | null {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 ||
      (input as RequesterPublicationOptions).isResolution !== true) throw new TicketConversationError('CONVERSATION_INVALID');
  return { isResolution: true };
}
