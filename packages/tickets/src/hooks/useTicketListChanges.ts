'use client';

import { useEffect, useRef } from 'react';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { createYjsProvider } from '@alga-psa/ui/editor';
import type { TicketListChange } from '../lib/listChangeFilters';

export function useTicketListChanges(tenantId: string | undefined, onChange: (event: TicketListChange) => void, options: {
  onUnavailable?: (since: number) => void;
  onRecovered?: (since: number) => void;
} = {}) {
  const callback = useRef(onChange);
  const unavailable = useRef(options.onUnavailable);
  const recovered = useRef(options.onRecovered);
  callback.current = onChange;
  unavailable.current = options.onUnavailable;
  recovered.current = options.onRecovered;

  useEffect(() => {
    if (!tenantId) return;
    let disposed = false;
    let provider: HocuspocusProvider | null = null;
    let failures = 0;
    let everAuthorized = false;
    let authorized = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tokenTimer: ReturnType<typeof setTimeout> | undefined;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    let outageStartedAt: number | null = Date.now();
    let unavailableReported = false;

    const reportUnavailable = () => {
      if (disposed || unavailableReported || outageStartedAt === null) return;
      unavailableReported = true;
      unavailable.current?.(outageStartedAt);
      fallbackTimer = setTimeout(function poll() {
        if (disposed || outageStartedAt === null) return;
        unavailable.current?.(outageStartedAt);
        fallbackTimer = setTimeout(poll, 60_000);
      }, 60_000);
    };

    const scheduleReconnect = () => {
      if (disposed || timer) return;
      failures += 1;
      authorized = false;
      if (outageStartedAt === null) outageStartedAt = Date.now();
      if (failures >= 5) reportUnavailable();
      timer = setTimeout(() => {
        timer = undefined;
        void connect();
      }, Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)));
    };

    const connect = async () => {
      if (disposed) return;
      if (provider) {
        provider.removeAllListeners();
        provider.destroy();
        provider = null;
      }
      try {
        const response = await fetch('/api/tickets/live-token', { credentials: 'include', cache: 'no-store' });
        if (!response.ok) throw new Error(`Ticket list token failed: ${response.status}`);
        const body = await response.json() as { token?: string; expiresAt?: number };
        if (!body.token) throw new Error('Missing ticket list token');
        if (disposed) return;
        const connection = createYjsProvider(`tenant:${tenantId}:ticket-changes`, { token: body.token, preserveConnection: false, maxAttempts: 1 });
        provider = connection.provider;
        if (tokenTimer) clearTimeout(tokenTimer);
        if (typeof body.expiresAt === 'number') {
          tokenTimer = setTimeout(() => {
            if (disposed || !provider) return;
            provider.disconnect();
            scheduleReconnect();
          }, Math.max(1000, body.expiresAt - Date.now() - 30_000));
        }
        provider.on('stateless', ({ payload }: { payload: string }) => {
          try {
            const message = JSON.parse(payload) as Partial<TicketListChange>;
            if (typeof message.ticketId !== 'string' || typeof message.updatedAt !== 'string' ||
              !Array.isArray(message.assigneeIds) || typeof message.statusId !== 'string') return;
            callback.current(message as TicketListChange);
          } catch { /* Ignore invalid messages; reconciliation is counts-only. */ }
        });
        provider.on('authenticated', () => {
          if (disposed || authorized) return;
          authorized = true;
          failures = 0;
          const recoveredOutage = outageStartedAt;
          if (everAuthorized || recoveredOutage !== null) recovered.current?.(recoveredOutage ?? Date.now());
          everAuthorized = true;
          outageStartedAt = null;
          unavailableReported = false;
          if (fallbackTimer) clearTimeout(fallbackTimer);
          fallbackTimer = undefined;
        });
        provider.on('authenticationFailed', () => scheduleReconnect());
        provider.on('close', () => scheduleReconnect());
        provider.on('disconnect', () => scheduleReconnect());
      } catch {
        scheduleReconnect();
      }
    };

    void connect();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      if (tokenTimer) clearTimeout(tokenTimer);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      provider?.removeAllListeners();
      provider?.destroy();
    };
  }, [tenantId]);
}
