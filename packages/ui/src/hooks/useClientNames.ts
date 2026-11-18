'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientPickerSearchFn, PickerClientOption } from '../components/AsyncClientPicker';

/** The server's cap on one `ids` lookup (`CLIENT_PICKER_MAX_LOOKUP_IDS` in shared/ticketClients). */
export const CLIENT_NAME_LOOKUP_CHUNK = 100;

export function chunkIds(ids: readonly string[], size: number = CLIENT_NAME_LOOKUP_CHUNK): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  return chunks;
}

export interface ClientNames {
  /** Every client resolved so far, by id. */
  clients: Readonly<Record<string, PickerClientOption>>;
  /** Ids the server was asked about and did not return (deleted or not visible). */
  unresolved: ReadonlySet<string>;
  /** Records rows the caller already holds (a loaded picker page) so they are never looked up again. */
  remember: (clients: readonly PickerClientOption[]) => void;
}

/**
 * Resolves client ids to display rows through the picker's `ids` lookup, without ever loading the
 * client list. Ids not yet known are requested together when `ids` changes, in chunks of
 * `CLIENT_NAME_LOOKUP_CHUNK`; each id is requested at most once. The selected-value label of the
 * client picker and the ticket list's filter chips both read names from here.
 */
export function useClientNames(
  ids: readonly string[],
  searchClients: ClientPickerSearchFn | undefined,
): ClientNames {
  const [clients, setClients] = useState<Record<string, PickerClientOption>>({});
  const [unresolved, setUnresolved] = useState<ReadonlySet<string>>(() => new Set());
  const requestedRef = useRef<Set<string>>(new Set());
  const searchRef = useRef(searchClients);
  searchRef.current = searchClients;
  const idsKey = ids.join(',');

  const remember = useCallback((rows: readonly PickerClientOption[]) => {
    if (rows.length === 0) return;
    for (const row of rows) requestedRef.current.add(row.client_id);
    setClients((prev) => {
      const next = { ...prev };
      for (const row of rows) next[row.client_id] = row;
      return next;
    });
    setUnresolved((prev) => {
      if (!rows.some((row) => prev.has(row.client_id))) return prev;
      const next = new Set(prev);
      for (const row of rows) next.delete(row.client_id);
      return next;
    });
  }, []);

  useEffect(() => {
    const search = searchRef.current;
    if (!search) return;
    const pending = Array.from(new Set(ids)).filter((id) => id && !requestedRef.current.has(id));
    if (pending.length === 0) return;
    pending.forEach((id) => requestedRef.current.add(id));
    let cancelled = false;
    let done = false;
    void Promise.all(
      chunkIds(pending).map(async (chunk) => {
        try {
          const result = await search({ ids: chunk });
          return { chunk, rows: result.clients };
        } catch (error) {
          console.error('[useClientNames] Failed to look up client names:', error);
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      done = true;
      for (const result of results) {
        if (!result) continue;
        remember(result.rows);
        const found = new Set(result.rows.map((row) => row.client_id));
        const missing = result.chunk.filter((id) => !found.has(id));
        if (missing.length > 0) setUnresolved((prev) => new Set([...prev, ...missing]));
      }
    });
    return () => {
      cancelled = true;
      // A superseded lookup never reported: let the ids be requested again.
      if (!done) pending.forEach((id) => requestedRef.current.delete(id));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, remember]);

  return { clients, unresolved, remember };
}
