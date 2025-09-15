import React from 'react';

// OSS implementation uses the CE chat stream service
export { ChatStreamService } from '@/services/chatStreamService';
export const ChatPage = () => {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Enterprise Feature</h2>
        <p className="text-gray-600">
          AI Chat features require Enterprise Edition. Please upgrade to access this feature.
        </p>
      </div>
    </div>
  );
};

export const ChatComponent = () => {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Enterprise Feature</h2>
        <p className="text-gray-600">
          AI Chat component requires Enterprise Edition. Please upgrade to access this feature.
        </p>
      </div>
    </div>
  );
};

export const MessageComponent = () => {
  return (
    <div className="flex items-center justify-center h-32">
      <div className="text-center">
        <p className="text-gray-600">
          Message features require Enterprise Edition.
        </p>
      </div>
    </div>
  );
};

// Default export
export default {
  ChatStreamService: () => import('../../../server/src/empty/services/chatStreamService').then(mod => mod.ChatStreamService),
  ChatPage,
  ChatComponent,
  MessageComponent,
};
