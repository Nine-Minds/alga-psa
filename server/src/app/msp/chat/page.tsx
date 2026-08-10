import { ChatPage } from '@product/chat/entry';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.chat.title', { defaultValue: 'Chat' }),
  };
}

export default function MspChatPage() {
  return <ChatPage />;
}
