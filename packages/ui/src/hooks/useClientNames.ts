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

/**
 * Resolves client ids to display rows in one go, chunked to the server's cap, without loading the
 * client list. For a screen that shows many mapped clients (an integration mapping table): look the
 * mapped ids up once when the table loads and hand the rows to each row's picker as `knownClients`,
 * so the pickers do not each ask. A chunk that fails is skipped; its rows resolve on their own.
 */
export async function lookupClientsByIds(
  search: ClientPickerSearchFn,
  ids: readonly string[],
): Promise<PickerClientOption[]> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const results = await Promise.all(
    chunkIds(unique).map((chunk) =>
      search({ ids: chunk, status: 'all' })
        .then((result) => result.clients)
        .catch((error) => {
          console.error('[lookupClientsByIds] Failed to look up clients:', error);
          return [] as PickerClientOption[];
        }),
    ),
  );
  return results.flat();
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
  /** Rows the caller already holds (see `lookupClientsByIds`); never looked up again. */
  knownClients?: readonly PickerClientOption[],
): ClientNames {
  const [clients, setClients] = useState<Record<string, PickerClientOption>>(() =>
    Object.fromEntries((knownClients ?? []).map((row) => [row.client_id, row])),
  );
  const [unresolved, setUnresolved] = useState<ReadonlySet<string>>(() => new Set());
  const requestedRef = useRef<Set<string>>(new Set((knownClients ?? []).map((row) => row.client_id)));
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

  // Declared before the lookup below so rows handed in later are known before it decides what to ask for.
  const knownKey = (knownClients ?? []).map((row) => row.client_id).join(',');
  useEffect(() => {
    if (knownClients && knownClients.length > 0) remember(knownClients);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knownKey, remember]);

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
