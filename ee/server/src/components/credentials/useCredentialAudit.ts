'use client';

/**
 * Shared audit-event load state for the credentials vault: the per-credential
 * History panel and the vault-wide Audit log screen both consume this hook.
 * Mirrors useCredentialsList's shape (context-free — gating lives in the
 * callers, which already know `canAudit` from getCredentialsContext).
 *
 * SECURITY: audit events are metadata-only by the action's contract; nothing
 * here ever carries or renders a vault value.
 */

import { useCallback, useEffect, useState, useTransition } from 'react';
import { getCredentialAuditEvents } from '../../lib/actions/credentials/credentialAuditActions';
import type {
  CredentialAuditEvent,
  CredentialAuditEventOperation,
  CredentialAuditFilter,
  CredentialAuditPage,
} from '../../lib/actions/credentials/credentialAuditActions';

export interface CredentialAuditFilterState {
  /** Per-credential history. */
  credentialId?: string;
  operations?: CredentialAuditEventOperation[];
  actorUserId?: string;
  clientId?: string;
  /** ISO timestamps (start inclusive, end inclusive). */
  from?: string;
  to?: string;
}

export function useCredentialAudit(filters: CredentialAuditFilterState, enabled = true) {
  const [events, setEvents] = useState<CredentialAuditEvent[] | null>(null);
  const [nextCursor, setNextCursor] = useState<CredentialAuditPage['nextCursor']>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, startRefreshTransition] = useTransition();
  const [loadError, setLoadError] = useState(false);

  // Filter changes reset the list; the key makes the callback stable per
  // filter combination so the load effect only re-runs when a filter changed.
  const filterKey = JSON.stringify([
    filters.credentialId,
    filters.operations,
    filters.actorUserId,
    filters.clientId,
    filters.from,
    filters.to,
  ]);

  const buildInput = useCallback(
    (cursor: CredentialAuditFilter['cursor']): CredentialAuditFilter => ({
      credentialId: filters.credentialId,
      operations: filters.operations,
      actorUserId: filters.actorUserId,
      clientId: filters.clientId,
      from: filters.from,
      to: filters.to,
      cursor,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterKey]
  );

  const fetchPage = useCallback(
    async (cursor: CredentialAuditFilter['cursor']): Promise<CredentialAuditPage> => {
      return getCredentialAuditEvents(buildInput(cursor));
    },
    [buildInput]
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setIsLoading(true);
    setLoadError(false);
    void (async () => {
      try {
        const page = await fetchPage(null);
        if (cancelled) return;
        setEvents(page.events);
        setNextCursor(page.nextCursor);
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchPage, enabled]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || isLoading) return;
    setIsLoading(true);
    setLoadError(false);
    try {
      const page = await fetchPage(nextCursor);
      setEvents((prev) => [...(prev ?? []), ...page.events]);
      setNextCursor(page.nextCursor);
    } catch {
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, [fetchPage, nextCursor, isLoading]);

  const refresh = useCallback(() => {
    startRefreshTransition(async () => {
      setLoadError(false);
      try {
        const page = await fetchPage(null);
        setEvents(page.events);
        setNextCursor(page.nextCursor);
      } catch {
        setLoadError(true);
      }
    });
  }, [fetchPage]);

  return {
    events,
    nextCursor,
    isLoading,
    isRefreshing,
    loadError,
    loadMore,
    refresh,
  };
}
