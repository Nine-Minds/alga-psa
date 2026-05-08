'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import type * as Y from 'yjs';
import { createYjsProvider } from '@alga-psa/ui/editor';

export type TicketLiveConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'unavailable';

export interface TicketLivePresenceUser {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  color: string;
  editingField?: string;
}

export interface TicketLiveRemoteUpdate {
  updatedFields: string[];
  updatedBy: {
    userId: string;
    displayName: string;
  };
  updatedAt: string;
}

interface UseTicketLiveCurrentUser {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
}

interface UseTicketLiveOptions {
  tenantId: string;
  ticketId: string;
  currentUser: UseTicketLiveCurrentUser;
  onRemoteUpdate?: (update: TicketLiveRemoteUpdate) => void;
  onPresenceChange?: (presence: TicketLivePresenceUser[]) => void;
  onReconnect?: () => void;
}

interface LiveTokenData {
  token: string;
  issuedAtMs: number;
  expiresAtMs: number;
}

const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 5;
const TOKEN_REFRESH_THRESHOLD = 0.8;
const USER_COLORS = [
  '#0ea5e9',
  '#14b8a6',
  '#f97316',
  '#ef4444',
  '#8b5cf6',
  '#22c55e',
  '#eab308',
  '#ec4899',
];

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

function getUserColor(userId: string) {
  return USER_COLORS[hashString(userId) % USER_COLORS.length] ?? USER_COLORS[0];
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload = ''] = token.split('.');
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`;
  const decoded = typeof window === 'undefined' ? Buffer.from(padded, 'base64').toString('utf8') : window.atob(padded);

  return JSON.parse(decoded) as Record<string, unknown>;
}

async function fetchLiveToken(ticketId: string): Promise<LiveTokenData> {
  const response = await fetch(`/api/tickets/${ticketId}/live-token`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch live token (${response.status})`);
  }

  const body = await response.json() as { token?: string };
  if (!body.token) {
    throw new Error('Live token response did not include a token.');
  }

  const payload = decodeJwtPayload(body.token);
  const issuedAtSeconds = typeof payload.iat === 'number' ? payload.iat : Math.floor(Date.now() / 1000);
  const expiresAtSeconds = typeof payload.exp === 'number' ? payload.exp : issuedAtSeconds + 300;

  return {
    token: body.token,
    issuedAtMs: issuedAtSeconds * 1000,
    expiresAtMs: expiresAtSeconds * 1000,
  };
}

function parseRemoteUpdate(payload: string): TicketLiveRemoteUpdate | null {
  try {
    const parsed = JSON.parse(payload) as Partial<TicketLiveRemoteUpdate>;

    if (!Array.isArray(parsed.updatedFields) || !parsed.updatedBy?.userId || !parsed.updatedBy.displayName || !parsed.updatedAt) {
      return null;
    }

    return {
      updatedFields: parsed.updatedFields.filter((field): field is string => typeof field === 'string'),
      updatedBy: {
        userId: parsed.updatedBy.userId,
        displayName: parsed.updatedBy.displayName,
      },
      updatedAt: parsed.updatedAt,
    };
  } catch (error) {
    console.warn('Failed to parse ticket live update payload:', error);
    return null;
  }
}

export function useTicketLive({
  tenantId,
  ticketId,
  currentUser,
  onRemoteUpdate,
  onPresenceChange,
  onReconnect,
}: UseTicketLiveOptions) {
  const [presence, setPresence] = useState<TicketLivePresenceUser[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<TicketLiveConnectionStatus>('connecting');

  const providerRef = useRef<HocuspocusProvider | null>(null);
  const ydocRef = useRef<Y.Doc | null>(null);
  const tokenRef = useRef<LiveTokenData | null>(null);
  const editingFieldRef = useRef<string | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectFailuresRef = useRef(0);
  const disposedRef = useRef(false);
  const hasConnectedRef = useRef(false);
  const shouldRefetchOnConnectRef = useRef(false);

  const roomName = useMemo(() => `ticket:${tenantId}:${ticketId}`, [tenantId, ticketId]);

  const buildLocalPresence = useCallback(
    (editingField: string | null): TicketLivePresenceUser => ({
      userId: currentUser.userId,
      displayName: currentUser.displayName,
      avatarUrl: currentUser.avatarUrl ?? null,
      color: getUserColor(currentUser.userId),
      ...(editingField ? { editingField } : {}),
    }),
    [currentUser.avatarUrl, currentUser.displayName, currentUser.userId]
  );

  const emitPresence = useCallback((provider: HocuspocusProvider | null) => {
    if (!provider) {
      setPresence([]);
      onPresenceChange?.([]);
      return;
    }

    const awarenessStates = provider.awareness?.getStates();
    if (!awarenessStates) {
      setPresence([]);
      onPresenceChange?.([]);
      return;
    }

    const nextPresence = Array.from(awarenessStates.values())
      .map((state) => state?.user as TicketLivePresenceUser | undefined)
      .filter((user): user is TicketLivePresenceUser => Boolean(user?.userId && user.displayName))
      .filter((user) => user.userId !== currentUser.userId);

    setPresence(nextPresence);
    onPresenceChange?.(nextPresence);
  }, [currentUser.userId, onPresenceChange]);

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const destroyProvider = useCallback(() => {
    const provider = providerRef.current;
    const ydoc = ydocRef.current;

    providerRef.current = null;
    ydocRef.current = null;

    if (provider) {
      provider.removeAllListeners();
      provider.destroy();
    }

    ydoc?.destroy();
  }, []);

  const scheduleTokenRefresh = useCallback(() => {
    clearRefreshTimer();

    const tokenData = tokenRef.current;
    if (!tokenData) {
      return;
    }

    const ttlMs = Math.max(tokenData.expiresAtMs - tokenData.issuedAtMs, 0);
    const refreshAtMs = tokenData.issuedAtMs + ttlMs * TOKEN_REFRESH_THRESHOLD;
    const delayMs = Math.max(refreshAtMs - Date.now(), 0);

    refreshTimerRef.current = window.setTimeout(async () => {
      try {
        const nextToken = await fetchLiveToken(ticketId);
        tokenRef.current = nextToken;
        providerRef.current?.setConfiguration({ token: nextToken.token });
        scheduleTokenRefresh();
      } catch (error) {
        console.warn('Ticket live token refresh failed:', error);
        clearReconnectTimer();
        clearRefreshTimer();
        destroyProvider();
        setConnectionStatus('unavailable');
        setPresence([]);
        onPresenceChange?.([]);
      }
    }, delayMs);
  }, [clearRefreshTimer, clearReconnectTimer, destroyProvider, onPresenceChange, ticketId]);

  const connectRef = useRef<(mode: 'initial' | 'reconnect') => Promise<void>>(async () => undefined);

  const connect = useCallback(async (mode: 'initial' | 'reconnect') => {
    clearReconnectTimer();
    destroyProvider();

    if (disposedRef.current) {
      return;
    }

    setConnectionStatus(mode === 'initial' ? 'connecting' : 'reconnecting');

    try {
      const nextToken = await fetchLiveToken(ticketId);
      tokenRef.current = nextToken;
      scheduleTokenRefresh();

      const { provider, ydoc } = createYjsProvider(roomName, {
        token: nextToken.token,
        parameters: { token: nextToken.token },
        connect: false,
        preserveConnection: false,
        maxAttempts: 1,
      });

      const handleStatus = ({ status }: { status: string }) => {
        if (disposedRef.current) {
          return;
        }

        if (status === 'connected') {
          provider.awareness?.setLocalStateField('user', buildLocalPresence(editingFieldRef.current));
          emitPresence(provider);
          reconnectFailuresRef.current = 0;
          setConnectionStatus('connected');

          if (shouldRefetchOnConnectRef.current) {
            shouldRefetchOnConnectRef.current = false;
            onReconnect?.();
          }

          hasConnectedRef.current = true;
        }
      };

      const handleAwarenessChange = () => {
        emitPresence(provider);
      };

      const handleStateless = ({ payload }: { payload: string }) => {
        const update = parseRemoteUpdate(payload);
        if (update) {
          onRemoteUpdate?.(update);
        }
      };

      const handleDisconnect = () => {
        if (disposedRef.current || providerRef.current !== provider) {
          return;
        }

        destroyProvider();
        emitPresence(null);

        if (hasConnectedRef.current) {
          shouldRefetchOnConnectRef.current = true;
        }

        reconnectFailuresRef.current += 1;
        if (reconnectFailuresRef.current > MAX_RECONNECT_ATTEMPTS) {
          setConnectionStatus('unavailable');
          return;
        }

        const delayMs = Math.min(
          INITIAL_RECONNECT_DELAY_MS * 2 ** (reconnectFailuresRef.current - 1),
          MAX_RECONNECT_DELAY_MS
        );

        setConnectionStatus('reconnecting');
        console.log(`Ticket live reconnect attempt ${reconnectFailuresRef.current} in ${delayMs}ms`);
        reconnectTimerRef.current = window.setTimeout(() => {
          void connectRef.current('reconnect');
        }, delayMs);
      };

      provider.on('status', handleStatus);
      provider.on('awarenessChange', handleAwarenessChange);
      provider.on('awarenessUpdate', handleAwarenessChange);
      provider.on('stateless', handleStateless);
      provider.on('disconnect', handleDisconnect);
      provider.on('authenticationFailed', handleDisconnect);

      providerRef.current = provider;
      ydocRef.current = ydoc;

      provider.connect();
    } catch (error) {
      console.warn('Ticket live connection setup failed:', error);
      reconnectFailuresRef.current += 1;

      if (reconnectFailuresRef.current > MAX_RECONNECT_ATTEMPTS) {
        setConnectionStatus('unavailable');
        return;
      }

      const delayMs = Math.min(
        INITIAL_RECONNECT_DELAY_MS * 2 ** (reconnectFailuresRef.current - 1),
        MAX_RECONNECT_DELAY_MS
      );

      setConnectionStatus(mode === 'initial' ? 'connecting' : 'reconnecting');
      reconnectTimerRef.current = window.setTimeout(() => {
        void connectRef.current('reconnect');
      }, delayMs);
    }
  }, [
    buildLocalPresence,
    clearReconnectTimer,
    destroyProvider,
    emitPresence,
    onReconnect,
    onRemoteUpdate,
    roomName,
    scheduleTokenRefresh,
    ticketId,
  ]);

  connectRef.current = connect;

  useEffect(() => {
    disposedRef.current = false;
    reconnectFailuresRef.current = 0;
    hasConnectedRef.current = false;
    shouldRefetchOnConnectRef.current = false;
    setPresence([]);
    setConnectionStatus('connecting');

    void connect('initial');

    return () => {
      disposedRef.current = true;
      clearRefreshTimer();
      clearReconnectTimer();
      destroyProvider();
      setPresence([]);
    };
  }, [clearReconnectTimer, clearRefreshTimer, connect, destroyProvider, roomName]);

  useEffect(() => {
    const provider = providerRef.current;
    if (!provider || connectionStatus !== 'connected') {
      return;
    }

    provider.awareness?.setLocalStateField('user', buildLocalPresence(editingFieldRef.current));
    emitPresence(provider);
  }, [buildLocalPresence, connectionStatus, emitPresence]);

  const setEditingField = useCallback((field: string | null) => {
    editingFieldRef.current = field;

    const provider = providerRef.current;
    if (!provider) {
      return;
    }

    provider.awareness?.setLocalStateField('user', buildLocalPresence(field));
  }, [buildLocalPresence]);

  return {
    presence,
    connectionStatus,
    setEditingField,
  };
}

export { decodeJwtPayload, fetchLiveToken, getUserColor, parseRemoteUpdate };
