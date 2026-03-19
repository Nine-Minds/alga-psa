'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { IClient, IContact } from '@alga-psa/types';

export type ContactFilterStatus = 'active' | 'inactive' | 'all';

export interface QuickAddContactRenderProps {
  isOpen: boolean;
  onClose: () => void;
  onContactAdded: (newContact: IContact) => void;
  clients: IClient[];
  selectedClientId?: string | null;
}

export interface QuickAddClientRenderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClientAdded: (client: IClient) => void;
  skipSuccessDialog?: boolean;
}

export interface ClientDetailsRenderProps {
  client: IClient;
  isInDrawer?: boolean;
  quickView?: boolean;
}

export interface ClientIntegrationContextType {
  // Data fetching
  getContactsByClient: (clientId: string, status?: ContactFilterStatus, sortBy?: string, sortDirection?: 'asc' | 'desc') => Promise<IContact[]>;
  getAllContacts: (status?: ContactFilterStatus, sortBy?: string, sortDirection?: 'asc' | 'desc') => Promise<IContact[]>;
  getContactByContactNameId: (contactNameId: string) => Promise<IContact | null>;

  // Component renderers
  renderQuickAddContact: (props: QuickAddContactRenderProps) => ReactNode;
  renderQuickAddClient: (props: QuickAddClientRenderProps) => ReactNode;
  renderClientDetails: (props: ClientDetailsRenderProps) => ReactNode;
}

const ClientIntegrationContext = createContext<ClientIntegrationContextType | null>(null);

export function useClientIntegration(): ClientIntegrationContextType {
  const ctx = useContext(ClientIntegrationContext);
  if (!ctx) {
    throw new Error(
      'useClientIntegration must be used within a ClientIntegrationProvider. ' +
      'Wrap your project page in a provider from the composition layer.'
    );
  }
  return ctx;
}

export function ClientIntegrationProvider({
  value,
  children,
}: {
  value: ClientIntegrationContextType;
  children: ReactNode;
}) {
  return (
    <ClientIntegrationContext.Provider value={value}>
      {children}
    </ClientIntegrationContext.Provider>
  );
}
