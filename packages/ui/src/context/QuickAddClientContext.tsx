'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { IClient, IContact } from '@alga-psa/types';

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

export interface QuickAddClientCallbacks {
  renderQuickAddClient: (props: QuickAddClientRenderProps) => ReactNode;
  renderQuickAddContact: (props: QuickAddContactRenderProps) => ReactNode;
}

const defaultCallbacks: QuickAddClientCallbacks = {
  renderQuickAddClient: () => null,
  renderQuickAddContact: () => null,
};

const QuickAddClientContext = createContext<QuickAddClientCallbacks>(defaultCallbacks);

export const QuickAddClientProvider = QuickAddClientContext.Provider;

export function useQuickAddClient(): QuickAddClientCallbacks {
  return useContext(QuickAddClientContext);
}
