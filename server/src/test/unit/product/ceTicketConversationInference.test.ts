import { describe, expect, it, vi } from 'vitest';
import { ConversationAiError } from '@alga-psa/types';

// A CE adapter must remain usable without loading shared service implementations.
vi.mock('@alga-psa/shared/lib/tickets/conversationAi', () => {
  throw new Error('CE inference loaded the shared service layer');
});

import { ticketConversationAiProvider } from '../../../../../packages/ee/src/services/ticketConversationInference';

describe('CE ticket conversation inference', () => {
  it.each(['assertAvailable', 'generate'] as const)('%s rejects with the public unavailable error without loading shared services', async (method) => {
    const error = await ticketConversationAiProvider[method]({}).catch(error => error);
    expect(error).toBeInstanceOf(ConversationAiError);
    expect(error).toMatchObject({ name: 'ConversationAiError', code: 'AI_UNAVAILABLE' });
  });
});
