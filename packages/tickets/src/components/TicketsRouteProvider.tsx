'use client';

import React, { createContext, useContext, useMemo, useState } from 'react';
import type { ITicketListFilters } from '@alga-psa/types';

interface TicketsRouteState {
  filters: ITicketListFilters;
  setFilters: React.Dispatch<React.SetStateAction<ITicketListFilters>>;
  totalCount: number;
  setTotalCount: React.Dispatch<React.SetStateAction<number>>;
  selectedTicketIds: Set<string>;
  selectedTicketIdsArray: string[];
  setSelectedTicketIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  clearSelectedTicketIds: () => void;
}

const EMPTY_FILTERS: ITicketListFilters = {
  searchQuery: '',
  statusId: 'open',
  priorityId: 'all',
  boardFilterState: 'active',
  showOpenOnly: true,
  sortBy: 'entered_at',
  sortDirection: 'desc',
  bundleView: 'bundled',
};

const TicketsRouteContext = createContext<TicketsRouteState | null>(null);

export function TicketsRouteProvider({ children }: { children: React.ReactNode }) {
  const [filters, setFilters] = useState<ITicketListFilters>(EMPTY_FILTERS);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedTicketIds, setSelectedTicketIds] = useState<Set<string>>(() => new Set());

  const value = useMemo<TicketsRouteState>(() => ({
    filters,
    setFilters,
    totalCount,
    setTotalCount,
    selectedTicketIds,
    selectedTicketIdsArray: Array.from(selectedTicketIds),
    setSelectedTicketIds,
    clearSelectedTicketIds: () => setSelectedTicketIds(new Set()),
  }), [filters, selectedTicketIds, totalCount]);

  return (
    <TicketsRouteContext.Provider value={value}>
      {children}
    </TicketsRouteContext.Provider>
  );
}

export function useTicketsRouteState(): TicketsRouteState {
  const context = useContext(TicketsRouteContext);
  const [fallbackFilters, setFallbackFilters] = useState<ITicketListFilters>(EMPTY_FILTERS);
  const [fallbackTotalCount, setFallbackTotalCount] = useState(0);
  const [fallbackSelectedTicketIds, setFallbackSelectedTicketIds] = useState<Set<string>>(() => new Set());

  return context ?? {
    filters: fallbackFilters,
    setFilters: setFallbackFilters,
    totalCount: fallbackTotalCount,
    setTotalCount: setFallbackTotalCount,
    selectedTicketIds: fallbackSelectedTicketIds,
    selectedTicketIdsArray: Array.from(fallbackSelectedTicketIds),
    setSelectedTicketIds: setFallbackSelectedTicketIds,
    clearSelectedTicketIds: () => setFallbackSelectedTicketIds(new Set()),
  };
}
