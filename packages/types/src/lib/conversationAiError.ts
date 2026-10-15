export class ConversationAiError extends Error {
  constructor(readonly code: 'AI_CONTEXT_TOO_LARGE' | 'AI_SOURCE_CHANGED' | 'AI_SOURCE_INVALID' | 'AI_UNAVAILABLE' | 'AI_CANCELLED') {
    super(code); this.name = 'ConversationAiError';
  }
}
