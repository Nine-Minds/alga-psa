'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type {
  ITicketListItem,
  ITicketListFilters,
  ITicket,
  ITicketCategory,
  IBoard,
} from '@alga-psa/types';

export interface QuickAddTicketRenderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTicketAdded: (ticket: ITicket) => void;
  prefilledClient?: { id: string; name: string };
  prefilledTitle?: string;
  prefilledDescription?: string;
  prefilledAssignedTo?: string;
  prefilledDueDate?: Date | string | null;
  prefilledAdditionalAgents?: { user_id: string; name?: string }[];
  isEmbedded?: boolean;
  renderBeforeFooter?: () => React.ReactNode;
}

export interface CategoryPickerRenderProps {
  id: string;
  categories: ITicketCategory[];
  selectedCategories: string[];
  onSelect: (categoryIds: string[], excludedIds?: string[]) => void;
  placeholder?: string;
  multiSelect?: boolean;
}

export interface PrioritySelectRenderProps {
  value: string | null;
  options: Array<{ value: string; label: string; color?: string }>;
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export interface TicketIntegrationContextType {
  // Data fetching
  getTicketsForList: (filters: ITicketListFilters) => Promise<ITicketListItem[]>;
  getConsolidatedTicketData: (ticketId: string) => Promise<any>;
  getTicketCategories: () => Promise<ITicketCategory[]>;
  getAllBoards: () => Promise<IBoard[]>;

  // Actions
  deleteTicket: (ticketId: string) => Promise<void>;

  // Component renderers
  renderQuickAddTicket: (props: QuickAddTicketRenderProps) => ReactNode;
  openTicketInDrawer: (ticketId: string) => Promise<void>;
  renderCategoryPicker: (props: CategoryPickerRenderProps) => ReactNode;
  renderPrioritySelect: (props: PrioritySelectRenderProps) => ReactNode;
}

const TicketIntegrationContext = createContext<TicketIntegrationContextType | null>(null);

export function useTicketIntegration(): TicketIntegrationContextType {
  const ctx = useContext(TicketIntegrationContext);
  if (!ctx) {
    throw new Error(
      'useTicketIntegration must be used within a TicketIntegrationProvider. ' +
      'Wrap your project page in a provider from the composition layer.'
    );
  }
  return ctx;
}

export function TicketIntegrationProvider({
  value,
  children,
}: {
  value: TicketIntegrationContextType;
  children: ReactNode;
}) {
  return (
    <TicketIntegrationContext.Provider value={value}>
      {children}
    </TicketIntegrationContext.Provider>
  );
}
