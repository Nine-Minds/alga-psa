'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { ITicketWithDetails } from '@alga-psa/types';
import { getClientTicketDetails } from '@alga-psa/client-portal/actions';
import { isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

type Intent = { conversationId: string; store: string | null; publishUrl: boolean };

/** Serialize navigation with existing portal mutations. A URL is only an intent:
 * the current author's editor stays mounted until it is safe to change history.
 * Conversation selectors in embedded dialogs never rewrite the host page URL. */
export function usePortalConversationNavigation({ ticket, enabled, bindUrl, busy, blocked, begin, end, onLoaded }: {
  ticket: ITicketWithDetails; enabled: boolean; bindUrl: boolean; busy: boolean; blocked: boolean;
  begin: () => boolean; end: () => void; onLoaded: (ticket: ITicketWithDetails) => void;
}) {
  const params = useSearchParams(), requestedId = params?.get('conversation') ?? null, requestedStore = params?.get('conversationStore') ?? null;
  const defaultId = ticket.requesterConversations?.find(row => row.isDefault)?.conversationId;
  const [intent, setIntent] = useState<Intent | null>(null), [failed, setFailed] = useState<Intent | null>(null);
  const current = useRef<Intent | null>(null), mounted = useRef(false), inFlight = useRef(false), enabledNow = useRef(enabled);
  enabledNow.current = enabled;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; current.current = null; }; }, []);
  const queue = (next: Intent | null) => { current.current = next; setIntent(next); setFailed(null); };
  const writeUrl = (conversationId: string, replace = false) => {
    if (!bindUrl) return;
    const url = new URL(window.location.href);
    for (const key of ['conversation', 'conversationStore', 'message', 'replyTo', 'replyThread', 'conversationView']) url.searchParams.delete(key);
    if (conversationId !== defaultId) { url.searchParams.set('conversation', conversationId); url.searchParams.set('conversationStore', ticket.tenant!); }
    // Next's history integration updates useSearchParams without a server-page
    // remount, keeping the author-local composer intact during this navigation.
    window.history[replace ? 'replaceState' : 'pushState'](null, '', `${url.pathname}${url.search}${url.hash}`);
  };
  useEffect(() => {
    if (!enabled) { queue(null); return; }
    if (!bindUrl || !defaultId) return;
    queue({ conversationId: requestedId ?? defaultId, store: requestedStore, publishUrl: false });
  }, [enabled, bindUrl, requestedId, requestedStore, defaultId]);

  useEffect(() => {
    if (!enabled || !intent || busy || blocked || inFlight.current) return;
    if ((intent.store && (intent.store !== ticket.tenant || !requestedId)) || !ticket.tenant) {
      setFailed(intent); setIntent(null); return;
    }
    if (intent.conversationId === ticket.selectedConversationId) { current.current = null; setIntent(null); return; }
    if (!begin()) return;
    const selected = intent; inFlight.current = true;
    const valid = () => mounted.current && enabledNow.current && current.current === selected;
    void (async () => {
      try {
        const details = await getClientTicketDetails(ticket.ticket_id!, selected.conversationId);
        if (!valid()) return;
        if (isActionMessageError(details) || isActionPermissionError(details) || details.tenant !== ticket.tenant ||
            details.ticket_id !== ticket.ticket_id || details.selectedConversationId !== selected.conversationId) {
          setFailed(selected); return;
        }
        onLoaded(details);
        if (selected.publishUrl) writeUrl(selected.conversationId);
      } catch {
        if (valid()) setFailed(selected);
      } finally {
        inFlight.current = false;
        if (valid()) { current.current = null; setIntent(null); }
        end();
      }
    })();
  }, [intent, enabled, busy, blocked, ticket, begin, end, onLoaded]);

  return {
    pending: Boolean(intent && intent.conversationId !== ticket.selectedConversationId), unavailable: Boolean(failed),
    select: (conversationId: string) => {
      if (!enabled || blocked || busy || conversationId === ticket.selectedConversationId) return;
      queue({ conversationId, store: null, publishUrl: bindUrl });
    },
    retry: () => { if (failed && !busy) queue(failed); },
    returnToCurrent: () => { if (!busy && ticket.selectedConversationId) { queue(null); writeUrl(ticket.selectedConversationId, true); } },
  };
}
