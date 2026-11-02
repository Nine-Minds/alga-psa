'use client';

import { useEffect, useRef } from 'react';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { createYjsProvider } from '@alga-psa/ui/editor';
import type { TicketListChange } from '../lib/listChangeFilters';

export function useTicketListChanges(tenantId: string | undefined, onChange: (event: TicketListChange) => void, options: {
  onUnavailable?: (since: number) => void;
  onRecovered?: (since: number) => void;
  shouldPollFallback?: () => boolean;
} = {}) {
  const callback = useRef(onChange);
  const unavailable = useRef(options.onUnavailable);
  const recovered = useRef(options.onRecovered);
  const shouldPollFallback = useRef(options.shouldPollFallback);
  callback.current = onChange;
  unavailable.current = options.onUnavailable;
  recovered.current = options.onRecovered;
  shouldPollFallback.current = options.shouldPollFallback;

  useEffect(() => {
    if (!tenantId) return;
    let disposed = false;
    let provider: HocuspocusProvider | null = null;
    let failures = 0;
    let everConnected = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tokenTimer: ReturnType<typeof setTimeout> | undefined;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    let reportedConnection = false;
    let reconnecting = false;
    let outageStartedAt: number | null = Date.now();
    let unavailableReported = false;
    const pollFallback = () => {
      if (disposed || unavailableReported) return;
      unavailableReported = true;
      if (outageStartedAt !== null) unavailable.current?.(outageStartedAt);
      const poll = () => {
        if (disposed || !reconnecting || outageStartedAt === null) return;
        unavailable.current?.(outageStartedAt);
        fallbackTimer = setTimeout(poll, 60_000);
      };
      fallbackTimer = setTimeout(poll, 60_000);
    };
    const pollRecoveredFallback = () => {
      if (disposed) return;
      fallbackTimer = setTimeout(() => {
        if (disposed || !shouldPollFallback.current?.()) { fallbackTimer = undefined; return; }
        recovered.current?.(Date.now());
        pollRecoveredFallback();
      }, 60_000);
    };
    const connect = async () => {
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
          tokenTimer = setTimeout(async () => {
            if (disposed || !provider) return;
            // The relay binds its principal and expiry to the handshake context.
            // Reconnect with a fresh token so that context and its expiry renew too.
            reconnecting = true;
            outageStartedAt ??= Date.now();
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
          } catch { /* Invalid broadcasts are ignored; the next successful refresh resets the snapshot. */ }
        });
        const markConnected = () => {
          if (reportedConnection) return;
          reportedConnection = true;
          failures = 0;
          const recoveredOutage = outageStartedAt;
          if (recoveredOutage !== null) recovered.current?.(recoveredOutage);
          everConnected = true;
          reconnecting = false;
          outageStartedAt = null;
          unavailableReported = false;
          if (fallbackTimer) clearTimeout(fallbackTimer);
          fallbackTimer = undefined;
          if (recoveredOutage !== null) pollRecoveredFallback();
        };
        provider.on('close', () => { if (!disposed) { reportedConnection = false; reconnecting = everConnected; scheduleReconnect(); } });
        provider.on('disconnect', () => { if (!disposed) { reportedConnection = false; reconnecting = everConnected; scheduleReconnect(); } });
        provider.on('connect', markConnected);
        provider.on('status', ({ status }: { status: string }) => {
          if (status === 'connected') markConnected();
          if (status === 'disconnected') { reportedConnection = false; reconnecting = everConnected; }
        });
      } catch {
        if (!disposed) scheduleReconnect();
      }
    };
    const scheduleReconnect = () => {
      if (timer) return;
      failures += 1;
      reconnecting = true;
      if (outageStartedAt === null) outageStartedAt = Date.now();
      if (failures >= 5) pollFallback();
      timer = setTimeout(() => { timer = undefined; void connect(); }, Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)));
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
