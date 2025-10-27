// EE implementation for Chat/AI features
// This will import the actual implementation from the ee/ directory

// Chat service exports
export { ChatStreamService } from '../../ee/server/src/services/chatStreamService';
export { TemporaryApiKeyService } from '../../ee/server/src/services/temporaryApiKeyService';
export { ChatCompletionsService } from '../../ee/server/src/services/chatCompletionsService';

// Component exports (when available)
// export { default as ChatPage } from '../../../ee/server/src/app/msp/chat/page';
// export { ChatComponent as Chat } from '../../../ee/server/src/components/chat/Chat';
// export { MessageComponent as Message } from '../../../ee/server/src/components/message/Message';

// For now, placeholder dynamic imports for components
export const ChatPage = () => import('../../ee/server/src/app/msp/chat/page');
export const ChatComponent = () => import('../../ee/server/src/components/chat/Chat');
export const MessageComponent = () => import('../../ee/server/src/components/message/Message');

// Default export
const chat = {
  ChatStreamService: () => import('../../ee/server/src/services/chatStreamService').then(mod => mod.ChatStreamService),
  TemporaryApiKeyService: () => import('../../ee/server/src/services/temporaryApiKeyService').then(mod => mod.TemporaryApiKeyService),
  ChatCompletionsService: () => import('../../ee/server/src/services/chatCompletionsService').then(mod => mod.ChatCompletionsService),
  ChatPage: () => import('../../ee/server/src/app/msp/chat/page'),
  ChatComponent: () => import('../../ee/server/src/components/chat/Chat'),
  MessageComponent: () => import('../../ee/server/src/components/message/Message'),
};

export default chat;
