'use client';

import { useEffect, useRef } from 'react';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { createYjsProvider } from '@alga-psa/ui/editor';
import type { TicketListChange } from '../lib/listChangeFilters';

export function useTicketListChanges(tenantId: string | undefined, onChange: (event: TicketListChange) => void, onUnavailable?: () => void) {
  const callback = useRef(onChange);
  const unavailable = useRef(onUnavailable);
  callback.current = onChange;
  unavailable.current = onUnavailable;

  useEffect(() => {
    if (!tenantId) return;
    let disposed = false;
    let provider: HocuspocusProvider | null = null;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connect = async () => {
      if (provider) {
        provider.removeAllListeners();
        provider.destroy();
        provider = null;
      }
      try {
        const response = await fetch('/api/tickets/live-token', { credentials: 'include', cache: 'no-store' });
        if (!response.ok) throw new Error(`Ticket list token failed: ${response.status}`);
        const body = await response.json() as { token?: string };
        if (!body.token) throw new Error('Missing ticket list token');
        if (disposed) return;
        const connection = createYjsProvider(`tenant:${tenantId}:ticket-changes`, { token: body.token, preserveConnection: true });
        provider = connection.provider;
        provider.on('stateless', ({ payload }: { payload: string }) => {
          try {
            const message = JSON.parse(payload) as Partial<TicketListChange>;
            if (typeof message.ticketId !== 'string' || typeof message.updatedAt !== 'string') return;
            callback.current({
              ticketId: message.ticketId,
              changeKind: message.changeKind === 'created' ? 'created' : 'updated',
              boardId: typeof message.boardId === 'string' ? message.boardId : null,
              statusId: typeof message.statusId === 'string' ? message.statusId : null,
              assigneeIds: Array.isArray(message.assigneeIds) ? message.assigneeIds : [],
              searchText: typeof message.searchText === 'string' ? message.searchText : '',
              actorUserId: typeof message.actorUserId === 'string' ? message.actorUserId : null,
              updatedAt: message.updatedAt,
            });
          } catch { /* Invalid broadcasts are ignored; the next successful refresh resets the snapshot. */ }
        });
        provider.on('close', () => { if (!disposed) scheduleReconnect(); });
        provider.on('disconnect', () => { if (!disposed) scheduleReconnect(); });
        provider.on('connect', () => { failures = 0; });
      } catch {
        if (!disposed) scheduleReconnect();
      }
    };
    const scheduleReconnect = () => {
      if (timer) return;
      failures += 1;
      if (failures >= 5) unavailable.current?.();
      timer = setTimeout(() => { timer = undefined; void connect(); }, Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)));
    };
    void connect();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      provider?.removeAllListeners();
      provider?.destroy();
    };
  }, [tenantId]);
}
