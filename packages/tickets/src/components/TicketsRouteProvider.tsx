'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
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
  // False until selection has been rehydrated from sessionStorage on mount. Consumers
  // that redirect on empty selection (the bulk-action modal routes) must wait for this
  // so a reload doesn't bounce away before the persisted selection is restored.
  selectionHydrated: boolean;
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

// Ticket selection is lifted to this provider (rendered in tickets/layout.tsx) so the
// intercepting bulk-action modal routes — sibling subtrees that can't read the list
// page's state — can see it. That context is in-memory only, so a full page reload of a
// modal route (where Next renders the non-intercepted route, not the @modal slot) would
// otherwise lose the selection. We persist it to sessionStorage (per-tab, cleared on tab
// close — the right scope; not URL-encoded because "select all matching" can be thousands
// of ids) and rehydrate on mount so selection survives reload.
const SELECTION_STORAGE_KEY = 'tickets:route-selection';

interface PersistedSelection {
  ids: string[];
  details: TicketsRouteSelectedTicketDetail[];
  sharedBoardId: string | null;
}

function readPersistedSelection(): PersistedSelection | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(SELECTION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedSelection;
    if (!Array.isArray(parsed?.ids)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePersistedSelection(selection: PersistedSelection | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!selection || selection.ids.length === 0) {
      window.sessionStorage.removeItem(SELECTION_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // sessionStorage unavailable (private mode/quota) — selection just won't survive reload.
  }
}

export function TicketsRouteProvider({ children }: { children: React.ReactNode }) {
  const [filters, setFilters] = useState<ITicketListFilters>(EMPTY_FILTERS);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedTicketIds, setSelectedTicketIds] = useState<Set<string>>(() => new Set());
  const [selectedTicketDetails, setSelectedTicketDetails] = useState<TicketsRouteSelectedTicketDetail[]>([]);
  const [selectedTicketsSharedBoardId, setSelectedTicketsSharedBoardId] = useState<string | null>(null);
  const [isResolvingSelectedBoards, setIsResolvingSelectedBoards] = useState(false);
  const [priorityOptions, setPriorityOptions] = useState<SelectOption[]>([]);
  const [selectionHydrated, setSelectionHydrated] = useState(false);

  // Rehydrate selection from sessionStorage once on mount (client-only, after hydration
  // to avoid an SSR mismatch). Runs before the persist effect can clobber storage because
  // that effect is gated on selectionHydrated.
  useEffect(() => {
    const persisted = readPersistedSelection();
    if (persisted) {
      setSelectedTicketIds(new Set(persisted.ids));
      setSelectedTicketDetails(persisted.details ?? []);
      setSelectedTicketsSharedBoardId(persisted.sharedBoardId ?? null);
    }
    setSelectionHydrated(true);
  }, []);

  // Persist selection on every change (only after rehydration, so the initial empty state
  // doesn't overwrite a stored selection during mount).
  useEffect(() => {
    if (!selectionHydrated) return;
    writePersistedSelection({
      ids: Array.from(selectedTicketIds),
      details: selectedTicketDetails,
      sharedBoardId: selectedTicketsSharedBoardId,
    });
  }, [selectionHydrated, selectedTicketIds, selectedTicketDetails, selectedTicketsSharedBoardId]);

  const value = useMemo<TicketsRouteState>(() => ({
    filters,
    setFilters,
    totalCount,
    setTotalCount,
    selectedTicketIds,
    selectedTicketIdsArray: Array.from(selectedTicketIds),
    setSelectedTicketIds,
    clearSelectedTicketIds: () => {
      setSelectedTicketIds(new Set());
      setSelectedTicketDetails([]);
      setSelectedTicketsSharedBoardId(null);
    },
    selectionHydrated,
    selectedTicketDetails,
    setSelectedTicketDetails,
    selectedTicketsSharedBoardId,
    setSelectedTicketsSharedBoardId,
    isResolvingSelectedBoards,
    setIsResolvingSelectedBoards,
    priorityOptions,
    setPriorityOptions,
  }), [filters, isResolvingSelectedBoards, priorityOptions, selectedTicketDetails, selectedTicketIds, selectedTicketsSharedBoardId, selectionHydrated, totalCount]);

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
    selectionHydrated: true,
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
