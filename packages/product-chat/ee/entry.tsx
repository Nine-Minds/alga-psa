// EE implementation for Chat/AI features
// This will import the actual implementation from the ee/ directory

// Chat service exports
export { ChatStreamService } from '@ee/services/chatStreamService';
export { TemporaryApiKeyService } from '@ee/services/temporaryApiKeyService';
export { ChatCompletionsService } from '@ee/services/chatCompletionsService';

// Default export
const chat = {
  ChatStreamService: () => import('@ee/services/chatStreamService').then(mod => mod.ChatStreamService),
  TemporaryApiKeyService: () => import('@ee/services/temporaryApiKeyService').then(mod => mod.TemporaryApiKeyService),
  ChatCompletionsService: () => import('@ee/services/chatCompletionsService').then(mod => mod.ChatCompletionsService),
};

export default chat;
