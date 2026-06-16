'use client';

import React, { createContext, useContext, useMemo, useState } from 'react';
import type { ITicketListFilters } from '@alga-psa/types';
import type { SelectOption } from '@alga-psa/ui/components/CustomSelect';

export interface TicketsRouteSelectedTicketDetail {
  ticket_id: string;
  ticket_number?: string;
  title?: string;
  client_id?: string | null;
  client_name?: string;
  board_id?: string | null;
}

interface TicketsRouteState {
  filters: ITicketListFilters;
  setFilters: React.Dispatch<React.SetStateAction<ITicketListFilters>>;
  totalCount: number;
  setTotalCount: React.Dispatch<React.SetStateAction<number>>;
  selectedTicketIds: Set<string>;
  selectedTicketIdsArray: string[];
  setSelectedTicketIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  clearSelectedTicketIds: () => void;
  selectedTicketDetails: TicketsRouteSelectedTicketDetail[];
  setSelectedTicketDetails: React.Dispatch<React.SetStateAction<TicketsRouteSelectedTicketDetail[]>>;
  selectedTicketsSharedBoardId: string | null;
  setSelectedTicketsSharedBoardId: React.Dispatch<React.SetStateAction<string | null>>;
  isResolvingSelectedBoards: boolean;
  setIsResolvingSelectedBoards: React.Dispatch<React.SetStateAction<boolean>>;
  priorityOptions: SelectOption[];
  setPriorityOptions: React.Dispatch<React.SetStateAction<SelectOption[]>>;
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
  const [selectedTicketDetails, setSelectedTicketDetails] = useState<TicketsRouteSelectedTicketDetail[]>([]);
  const [selectedTicketsSharedBoardId, setSelectedTicketsSharedBoardId] = useState<string | null>(null);
  const [isResolvingSelectedBoards, setIsResolvingSelectedBoards] = useState(false);
  const [priorityOptions, setPriorityOptions] = useState<SelectOption[]>([]);

  const value = useMemo<TicketsRouteState>(() => ({
    filters,
    setFilters,
    totalCount,
    setTotalCount,
    selectedTicketIds,
    selectedTicketIdsArray: Array.from(selectedTicketIds),
    setSelectedTicketIds,
    clearSelectedTicketIds: () => setSelectedTicketIds(new Set()),
    selectedTicketDetails,
    setSelectedTicketDetails,
    selectedTicketsSharedBoardId,
    setSelectedTicketsSharedBoardId,
    isResolvingSelectedBoards,
    setIsResolvingSelectedBoards,
    priorityOptions,
    setPriorityOptions,
  }), [filters, isResolvingSelectedBoards, priorityOptions, selectedTicketDetails, selectedTicketIds, selectedTicketsSharedBoardId, totalCount]);

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
  const [fallbackSelectedTicketDetails, setFallbackSelectedTicketDetails] = useState<TicketsRouteSelectedTicketDetail[]>([]);
  const [fallbackSelectedTicketsSharedBoardId, setFallbackSelectedTicketsSharedBoardId] = useState<string | null>(null);
  const [fallbackIsResolvingSelectedBoards, setFallbackIsResolvingSelectedBoards] = useState(false);
  const [fallbackPriorityOptions, setFallbackPriorityOptions] = useState<SelectOption[]>([]);

  return context ?? {
    filters: fallbackFilters,
    setFilters: setFallbackFilters,
    totalCount: fallbackTotalCount,
    setTotalCount: setFallbackTotalCount,
    selectedTicketIds: fallbackSelectedTicketIds,
    selectedTicketIdsArray: Array.from(fallbackSelectedTicketIds),
    setSelectedTicketIds: setFallbackSelectedTicketIds,
    clearSelectedTicketIds: () => setFallbackSelectedTicketIds(new Set()),
    selectedTicketDetails: fallbackSelectedTicketDetails,
    setSelectedTicketDetails: setFallbackSelectedTicketDetails,
    selectedTicketsSharedBoardId: fallbackSelectedTicketsSharedBoardId,
    setSelectedTicketsSharedBoardId: setFallbackSelectedTicketsSharedBoardId,
    isResolvingSelectedBoards: fallbackIsResolvingSelectedBoards,
    setIsResolvingSelectedBoards: setFallbackIsResolvingSelectedBoards,
    priorityOptions: fallbackPriorityOptions,
    setPriorityOptions: setFallbackPriorityOptions,
  };
}
