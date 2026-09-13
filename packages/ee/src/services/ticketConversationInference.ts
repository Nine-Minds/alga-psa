import { ConversationAiError, type ConversationAiProvider } from '@alga-psa/shared/lib/tickets/conversationAi';

const unavailable = async (): Promise<never> => { throw new ConversationAiError('AI_UNAVAILABLE'); };
export const ticketConversationAiProvider: ConversationAiProvider = { assertAvailable: unavailable, generate: unavailable };
