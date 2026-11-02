'use client';

import { useEffect, useRef } from 'react';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { createYjsProvider } from '@alga-psa/ui/editor';
import type { TicketListChange } from '../lib/listChangeFilters';

async function fetchTicketChangeToken(): Promise<string> {
  const response = await fetch('/api/tickets/live-token', { credentials: 'include', cache: 'no-store' });
  if (!response.ok) throw new Error(`Ticket list token failed: ${response.status}`);
  const body = await response.json() as { token?: string };
  if (!body.token) throw new Error('Missing ticket list token');
  return body.token;
}

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
    let authRetryTimer: ReturnType<typeof setTimeout> | undefined;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    let outageStartedAt: number | null = Date.now();
    let unavailableReported = false;

    const clearAuthRetry = () => {
      if (authRetryTimer) clearTimeout(authRetryTimer);
      authRetryTimer = undefined;
    };

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

    const scheduleAuthenticationRetry = () => {
      if (disposed || authorized || authRetryTimer) return;
      failures += 1;
      if (outageStartedAt === null) outageStartedAt = Date.now();
      if (failures >= 5) reportUnavailable();
      authRetryTimer = setTimeout(() => {
        authRetryTimer = undefined;
        if (disposed || authorized || provider?.isAuthenticated) return;
        // Authentication rejection detaches this provider and stops its socket.
        // Reuse the same provider and explicitly restart its configured transport.
        const websocket = provider?.configuration.websocketProvider;
        if (!websocket) return;
        const connectAfterClose = ({ status }: { status: string }) => {
          if (status !== 'disconnected') return;
          websocket.off('status', connectAfterClose);
          if (!disposed && !authorized) void provider?.connect();
        };
        if (websocket.status === 'disconnected') {
          void provider?.connect();
        } else {
          websocket.on('status', connectAfterClose);
          websocket.disconnect();
        }
      }, Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)));
    };

    const open = async () => {
      if (disposed) return;
      const connection = createYjsProvider(`tenant:${tenantId}:ticket-changes`, {
        token: fetchTicketChangeToken,
        preserveConnection: false,
        websocketOptions: {
          // Socket loss is retried by the websocket provider. The hook owns only
          // rejected authentication retries, which need a fresh token each time.
          maxAttempts: 0,
          delay: 1000,
          initialDelay: 0,
          factor: 2,
          minDelay: 1000,
          maxDelay: 30_000,
          jitter: true,
        },
      });
      provider = connection.provider;
      provider.on('stateless', ({ payload }: { payload: string }) => {
        try {
          const message = JSON.parse(payload) as Partial<TicketListChange>;
          if (typeof message.ticketId !== 'string' || typeof message.updatedAt !== 'string' ||
            !Array.isArray(message.assigneeIds) || typeof message.statusId !== 'string') return;
          callback.current(message as TicketListChange);
        } catch { /* Ignore invalid messages; reconciliation is counts-only. */ }
      });
      provider.on('open', clearAuthRetry);
      provider.on('authenticated', () => {
        if (disposed || authorized) return;
        clearAuthRetry();
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
      provider.on('authenticationFailed', scheduleAuthenticationRetry);
      provider.on('close', () => {
        if (!authorized) return;
        authorized = false;
        outageStartedAt ??= Date.now();
      });
      provider.on('disconnect', () => {
        if (!authorized) return;
        authorized = false;
        outageStartedAt ??= Date.now();
      });
    };

    open();
    return () => {
      disposed = true;
      clearAuthRetry();
      if (fallbackTimer) clearTimeout(fallbackTimer);
      provider?.removeAllListeners();
      provider?.destroy();
    };
  }, [tenantId]);
}
