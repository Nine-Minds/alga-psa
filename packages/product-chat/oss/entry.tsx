import React from 'react';

const enterpriseOnly = () =>
  new Response(JSON.stringify({ error: 'Chat features are only available in Enterprise Edition' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });

export const ChatStreamService = {
  handleChatStream: async (_req: unknown) => enterpriseOnly(),
  handleTitleStream: async (_req: unknown) => enterpriseOnly(),
} as const;

export const TemporaryApiKeyService = {
  cleanupExpiredAiKeys: async () => 0,
} as const;

export const ChatCompletionsService = {
  handleRequest: async (_req: unknown) => enterpriseOnly(),
  handleExecute: async (_req: unknown) => enterpriseOnly(),
} as const;

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

export const ChatComponent = ChatPage;

export const MessageComponent = () => {
  return (
    <div className="flex items-center justify-center h-32">
      <div className="text-center">
        <p className="text-gray-600">Message features require Enterprise Edition.</p>
      </div>
    </div>
  );
};

export default {
  ChatStreamService: () => Promise.resolve(ChatStreamService),
  TemporaryApiKeyService: () => Promise.resolve(TemporaryApiKeyService),
  ChatCompletionsService: () => Promise.resolve(ChatCompletionsService),
  ChatPage,
  ChatComponent,
  MessageComponent,
};

