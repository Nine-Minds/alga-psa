import { useCallback, useEffect, useRef, useState } from 'react';
import { useTicketDataSource } from './TicketDataSourceContext';
import { EMPTY_PARTY_DISPLAY_TAGS, type PartyDisplayTags } from '../../lib/partyDisplayTags';

interface Options {
  ticketId: string | undefined;
  contactId: string | null | undefined;
  clientId: string | null | undefined;
  initial: PartyDisplayTags;
  /** Called with the failed action result (a returned error) or the rejection. */
  onError: (error: unknown, retry: () => void) => void;
}

const isPartyTags = (value: unknown): value is PartyDisplayTags =>
  !!value && typeof value === 'object' && 'contact' in value && 'client' in value;

/**
 * Header chip tags for the ticket's requester and client. The requester or client can change in
 * place, so when the party moves off the pair last loaded the chips are cleared at once (a badge
 * from the previous party never shows) and reloaded. The loaded pair is only committed on success,
 * so a failed load is retried by `retry()` or by the next party change; it is never marked done.
 */
export function usePartyDisplayTags({ ticketId, contactId, clientId, initial, onError }: Options) {
  const { getTicketPartyDisplayTags } = useTicketDataSource().tags;
  const [displayTags, setDisplayTags] = useState<PartyDisplayTags>(initial);
  const [retryNonce, setRetryNonce] = useState(0);
  const loadedPartyRef = useRef<string | null>(`${contactId ?? ''}|${clientId ?? ''}`);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const retry = useCallback(() => setRetryNonce((n) => n + 1), []);

  useEffect(() => {
    const partyKey = `${contactId ?? ''}|${clientId ?? ''}`;
    if (partyKey === loadedPartyRef.current) return;
    if (!ticketId) return;
    // The chips no longer belong to any party: null matches no key, so returning to the old pair
    // (or a retry) after a failed load refetches instead of hitting the early return above.
    loadedPartyRef.current = null;
    setDisplayTags(EMPTY_PARTY_DISPLAY_TAGS);
    let cancelled = false;
    getTicketPartyDisplayTags(ticketId, contactId ?? null, clientId ?? null).then(
      (result) => {
        if (cancelled) return;
        if (isPartyTags(result)) {
          loadedPartyRef.current = partyKey;
          setDisplayTags(result);
        } else {
          onErrorRef.current(result, retry);
        }
      },
      (error) => {
        if (!cancelled) onErrorRef.current(error, retry);
      },
    );
    return () => { cancelled = true; };
  }, [ticketId, contactId, clientId, retryNonce, retry, getTicketPartyDisplayTags]);

  return displayTags;
}
