'use client';

import { createContext, useContext } from 'react';
import { Share2 } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';
import type { CoManagedConversationItem } from '@alga-psa/co-managed';

export interface ConversationShareSelection {
  kind?: 'share';
  conversation: TicketConversationReference;
  commentId: string;
  threadId: string;
}
export interface ConversationSynthesisSelection {
  kind: 'synthesis';
  conversation: TicketConversationReference;
  destination?: TicketConversationReference;
}
export const ConversationSharingContext = createContext<{
  canShare: boolean;
  paused: boolean;
  share: (selection: ConversationShareSelection) => Promise<void>;
  openSource?: (source: NonNullable<CoManagedConversationItem['sharedFrom']>) => Promise<void>;
} | null>(null);
export const useConversationSharing = () => useContext(ConversationSharingContext);

export function ConversationShareButton({ id, conversation, commentId, threadId, disabled = false }: {
  id: string; conversation: TicketConversationReference; commentId?: string; threadId?: string | null; disabled?: boolean;
}) {
  const sharing = useConversationSharing(), { t } = useTranslation('features/tickets');
  if (!sharing?.canShare || !commentId || !threadId) return null;
  return <Button id={`${id}-share-${commentId}`} size="sm" variant="ghost" disabled={disabled || sharing.paused}
    onClick={() => void sharing.share({ conversation: { storeTenant: conversation.storeTenant, conversationId: conversation.conversationId }, commentId, threadId })}>
    <Share2 className="mr-1.5 h-3.5 w-3.5" />{t('namedConversations.share.action', 'Share')}
  </Button>;
}
