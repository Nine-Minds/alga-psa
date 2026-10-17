'use client';

import { useEffect, useState, type RefObject } from 'react';
import { useSearchParams } from 'next/navigation';
import type { TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';

/** URL changes can precede a permitted draft-preserving conversation switch.
 * Do not apply the next conversation's message target to the old visible one. */
export function useConversationMessageTarget(ticketTenant: string, conversation: (TicketConversationReference & { defaultSlot?: string | null }) | null) {
  const params = useSearchParams();
  if (!conversation || params?.get('conversationView') === 'all') return null;
  const requested = params?.get('conversation');
  const selected = requested ? requested === conversation.conversationId &&
    (params?.get('conversationStore') || ticketTenant) === conversation.storeTenant : conversation.defaultSlot === 'requester';
  return selected ? params?.get('message') ?? null : null;
}

/** The host supplies an already authorized, rendered message. The URL grants
 * no read capability; it only moves keyboard focus and highlights that element. */
export function useConversationMessageFocus(target: string | null, messageId: string, element: RefObject<HTMLElement | null>) {
  const [highlighted, setHighlighted] = useState(false);
  useEffect(() => {
    setHighlighted(false);
    if (!target || target.toLowerCase() !== messageId.toLowerCase()) return;
    const frame = window.requestAnimationFrame(() => {
      if (!element.current) return;
      element.current.focus({ preventScroll: true });
      element.current.scrollIntoView({ block: 'center', behavior: 'instant' });
      setHighlighted(true);
    });
    const dismiss = () => setHighlighted(false);
    window.addEventListener('pointerdown', dismiss, { once: true });
    window.addEventListener('keydown', dismiss, { once: true });
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', dismiss); };
  }, [target, messageId, element]);
  return highlighted;
}
