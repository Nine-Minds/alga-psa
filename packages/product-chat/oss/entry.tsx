import React from 'react';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

const enterpriseOnly = async () => {
  const { t } = await getServerTranslation(undefined, 'msp/core');
  return new Response(JSON.stringify({ error: t('chat.errors.enterpriseOnly') }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
};

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

export const ChatPage = async () => {
  const { t } = await getServerTranslation(undefined, 'msp/core');
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">{t('chat.page.title')}</h2>
        <p className="text-gray-600">
          {t('chat.page.description')}
        </p>
      </div>
    </div>
  );
};

export const ChatComponent = ChatPage;

export const MessageComponent = async () => {
  const { t } = await getServerTranslation(undefined, 'msp/core');
  return (
    <div className="flex items-center justify-center h-32">
      <div className="text-center">
        <p className="text-gray-600">{t('chat.messages.proRequired')}</p>
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
