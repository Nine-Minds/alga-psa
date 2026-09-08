import type { TicketConversationReference, NamedTicketConversation } from './namedConversations';

export class ConversationAiError extends Error {
  constructor(readonly code: 'AI_CONTEXT_TOO_LARGE' | 'AI_SOURCE_CHANGED' | 'AI_SOURCE_INVALID' | 'AI_UNAVAILABLE' | 'AI_CANCELLED') {
    super(code); this.name = 'ConversationAiError';
  }
}
export type ConversationAiSourceRequest = { kind: 'synthesis'; source: TicketConversationReference }
  | { kind: 'conversation'; sources: TicketConversationReference[] };
export interface ConversationAiMessage {
  key: string; replyTo?: string; createdAt: string; author?: string; text: string;
  files: Array<{ name: string; mimeType: string; size: number }>;
}
export interface ConversationAiInput {
  audience: NamedTicketConversation['audience'];
  conversations: Array<{ name: string; messages: ConversationAiMessage[] }>;
}
export interface ConversationAiSnapshot {
  destination: TicketConversationReference & { revision: number; audience: NamedTicketConversation['audience'] };
  request: ConversationAiSourceRequest;
  sources: Array<{ reference: TicketConversationReference; revision: number; messageVersion: string;
    messages: Array<{ commentId: string; threadId: string; fingerprint: string; attachmentIds: string[] }> }>;
  input: ConversationAiInput;
}

export interface ConversationAiActor { tenant: string; userId: string; sessionId: string }
export interface ConversationAiGeneration {
  actor: ConversationAiActor;
  operationId: string;
  kind: 'synthesis' | 'conversation';
  input: ConversationAiInput;
  prompt: string;
  signal?: AbortSignal;
}
export interface ConversationAiProvider {
  assertAvailable(actor: ConversationAiActor): Promise<void>;
  generate(request: ConversationAiGeneration): Promise<string>;
}
