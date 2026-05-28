'use client';

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  useTicketLive,
  type TicketLiveConnectionStatus,
  type TicketLivePresenceUser,
  type TicketLiveRemoteUpdate,
} from '../../hooks/useTicketLive';

interface TicketLiveCurrentUser {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
}

interface TicketLiveContextValue {
  enabled: boolean;
  presence: TicketLivePresenceUser[];
  connectionStatus: TicketLiveConnectionStatus;
  setEditingField: (field: string | null) => void;
  lastRemoteUpdate: TicketLiveRemoteUpdate | null;
  reconnectVersion: number;
}

const defaultContextValue: TicketLiveContextValue = {
  enabled: false,
  presence: [],
  connectionStatus: 'unavailable',
  setEditingField: () => undefined,
  lastRemoteUpdate: null,
  reconnectVersion: 0,
};

const TicketLiveContext = createContext<TicketLiveContextValue>(defaultContextValue);

interface TicketLiveProviderProps {
  tenantId: string;
  ticketId: string;
  currentUser: TicketLiveCurrentUser;
  children: React.ReactNode;
}

export function TicketLiveProvider({
  tenantId,
  ticketId,
  currentUser,
  children,
}: TicketLiveProviderProps) {
  const [lastRemoteUpdate, setLastRemoteUpdate] = useState<TicketLiveRemoteUpdate | null>(null);
  const [reconnectVersion, setReconnectVersion] = useState(0);
  const handleReconnect = useCallback(() => {
    setReconnectVersion((value) => value + 1);
  }, []);

  const { presence, connectionStatus, setEditingField } = useTicketLive({
    tenantId,
    ticketId,
    currentUser,
    onRemoteUpdate: setLastRemoteUpdate,
    onReconnect: handleReconnect,
  });

  const value = useMemo<TicketLiveContextValue>(() => ({
    enabled: true,
    presence,
    connectionStatus,
    setEditingField,
    lastRemoteUpdate,
    reconnectVersion,
  }), [connectionStatus, lastRemoteUpdate, presence, reconnectVersion, setEditingField]);

  return (
    <TicketLiveContext.Provider value={value}>
      {children}
    </TicketLiveContext.Provider>
  );
}

export function useTicketLiveContext() {
  return useContext(TicketLiveContext);
}
