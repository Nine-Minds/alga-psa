import { ChatPage } from '@product/chat/entry';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Chat',
};

export default function MspChatPage() {
  return <ChatPage />;
}
