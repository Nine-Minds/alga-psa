// EE implementation for Chat/AI features
// This will import the actual implementation from the ee/ directory

// Chat service exports
export { ChatStreamService } from '../../ee/server/src/services/chatStreamService';
export { TemporaryApiKeyService } from '../../ee/server/src/services/temporaryApiKeyService';

// Component exports (when available)
// export { default as ChatPage } from '../../../ee/server/src/app/msp/chat/page';
// export { ChatComponent as Chat } from '../../../ee/server/src/components/chat/Chat';
// export { MessageComponent as Message } from '../../../ee/server/src/components/message/Message';

// For now, placeholder dynamic imports for components
export const ChatPage = () => import('../../ee/server/src/app/msp/chat/page.js');
export const ChatComponent = () => import('../../ee/server/src/components/chat/Chat.js');
export const MessageComponent = () => import('../../ee/server/src/components/message/Message.js');

// Default export
const chat = {
  ChatStreamService: () => import('../../ee/server/src/services/chatStreamService').then(mod => mod.ChatStreamService),
  TemporaryApiKeyService: () => import('../../ee/server/src/services/temporaryApiKeyService').then(mod => mod.TemporaryApiKeyService),
  ChatPage: () => import('../../ee/server/src/app/msp/chat/page.js'),
  ChatComponent: () => import('../../ee/server/src/components/chat/Chat.js'),
  MessageComponent: () => import('../../ee/server/src/components/message/Message.js'),
};

export default chat;
