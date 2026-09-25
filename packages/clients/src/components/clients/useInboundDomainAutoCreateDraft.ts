'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import {
  setClientInboundEmailDomainsAutoCreateContacts,
  type ClientInboundEmailDomainAutoCreateChange,
} from '@alga-psa/clients/actions/clientInboundEmailDomainActions';

export interface InboundDomainRow {
  id: string;
  domain: string;
  auto_create_contacts: boolean;
}

/**
 * Stages the per-domain "create contacts for new senders" switches as part of
 * the client form: toggling only changes the draft, and `save` persists it when
 * the form's Save runs. `domains` holds the persisted values.
 */
export function useInboundDomainAutoCreateDraft(
  clientId: string | undefined,
  domains: InboundDomainRow[],
  setDomains: Dispatch<SetStateAction<InboundDomainRow[]>>,
) {
  const [draft, setDraft] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setDraft({});
  }, [clientId]);

  const changes = useMemo<ClientInboundEmailDomainAutoCreateChange[]>(
    () => domains
      .filter((d) => d.id in draft && draft[d.id] !== d.auto_create_contacts)
      .map((d) => ({ domainId: d.id, enabled: draft[d.id] })),
    [domains, draft],
  );

  const draftDomains = useMemo(
    () => domains.map((d) => (d.id in draft ? { ...d, auto_create_contacts: draft[d.id] } : d)),
    [domains, draft],
  );

  const toggle = useCallback((domainId: string, enabled: boolean) => {
    setDraft((prev) => ({ ...prev, [domainId]: enabled }));
  }, []);

  const discard = useCallback(() => setDraft({}), []);

  const changesRef = useRef(changes);
  changesRef.current = changes;

  /** Persists staged switches; resolves false (draft kept) if the save failed. */
  const save = useCallback(async (): Promise<boolean> => {
    const pending = changesRef.current;
    if (!clientId || pending.length === 0) return true;
    const result = await setClientInboundEmailDomainsAutoCreateContacts(clientId, pending);
    if (isActionMessageError(result) || isActionPermissionError(result)) return false;
    const saved = new Map(result.map((row) => [row.id, Boolean(row.auto_create_contacts)]));
    setDomains((rows) => rows.map((d) => (saved.has(d.id) ? { ...d, auto_create_contacts: saved.get(d.id)! } : d)));
    setDraft({});
    return true;
  }, [clientId, setDomains]);

  return {
    domains: draftDomains,
    hasChanges: changes.length > 0,
    toggle,
    discard,
    save,
  };
}
