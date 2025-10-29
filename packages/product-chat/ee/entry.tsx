// EE implementation for Chat/AI features
// This will import the actual implementation from the ee/ directory

// Chat service exports
export { ChatStreamService } from '../../../ee/server/src/services/chatStreamService';
export { TemporaryApiKeyService } from '../../../ee/server/src/services/temporaryApiKeyService';
export { ChatCompletionsService } from '../../../ee/server/src/services/chatCompletionsService';

// Default export
const chat = {
  ChatStreamService: () => import('../../../ee/server/src/services/chatStreamService').then(mod => mod.ChatStreamService),
  TemporaryApiKeyService: () => import('../../../ee/server/src/services/temporaryApiKeyService').then(mod => mod.TemporaryApiKeyService),
  ChatCompletionsService: () => import('../../../ee/server/src/services/chatCompletionsService').then(mod => mod.ChatCompletionsService),
};

export default chat;
