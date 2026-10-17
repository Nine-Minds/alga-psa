import { ConversationAiError } from '@alga-psa/types';

// CE always rejects, without loading shared services or enterprise implementation types.
const unavailable = async (_request: unknown): Promise<never> => { throw new ConversationAiError('AI_UNAVAILABLE'); };
export const ticketConversationAiProvider = { assertAvailable: unavailable, generate: unavailable };
