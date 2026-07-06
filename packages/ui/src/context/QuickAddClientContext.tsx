'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { IClient, IContact, IInteraction } from '@alga-psa/types';

export interface QuickAddClientRenderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClientAdded: (client: IClient) => void;
  trigger?: ReactNode;
  skipSuccessDialog?: boolean;
}

export interface QuickAddContactRenderProps {
  isOpen: boolean;
  onClose: () => void;
  onContactAdded: (contact: IContact) => void;
  clients: IClient[];
  selectedClientId?: string | null;
}

export interface QuickAddInteractionRenderProps {
  id?: string;
  isOpen: boolean;
  onClose: () => void;
  entityId: string;
  entityType: 'contact' | 'client';
  clientId?: string;
  ticketId?: string;
  onInteractionAdded: (interaction: IInteraction) => void;
}

export interface QuickAddClientCallbacks {
  renderQuickAddClient: (props: QuickAddClientRenderProps) => ReactNode;
  renderQuickAddContact: (props: QuickAddContactRenderProps) => ReactNode;
  renderQuickAddInteraction: (props: QuickAddInteractionRenderProps) => ReactNode;
}

const defaultCallbacks: QuickAddClientCallbacks = {
  renderQuickAddClient: () => null,
  renderQuickAddContact: () => null,
  renderQuickAddInteraction: () => null,
};

const QuickAddClientContext = createContext<QuickAddClientCallbacks>(defaultCallbacks);

export const QuickAddClientProvider = QuickAddClientContext.Provider;

export function useQuickAddClient(): QuickAddClientCallbacks {
  return useContext(QuickAddClientContext);
}
