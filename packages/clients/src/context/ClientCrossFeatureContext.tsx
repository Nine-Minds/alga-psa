'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { ITicket, SurveyClientSatisfactionSummary } from '@alga-psa/types';

export interface QuickAddTicketRenderProps {
  id?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTicketAdded: (ticket: ITicket) => void;
  prefilledClient?: { id: string; name: string };
}

export interface TicketFormOptions {
  statusOptions: any[];
  priorityOptions: any[];
  boardOptions: any[];
  categories: any[];
  tags: any[];
  users: any[];
}

export interface SurveySummaryRenderProps {
  summary: SurveyClientSatisfactionSummary | null;
}

export interface ClientCrossFeatureCallbacks {
  renderQuickAddTicket: (props: QuickAddTicketRenderProps) => ReactNode;
  getTicketFormOptions: () => Promise<TicketFormOptions>;
  renderSurveySummaryCard: (props: SurveySummaryRenderProps) => ReactNode;
}

const ClientCrossFeatureContext = createContext<ClientCrossFeatureCallbacks | null>(null);

export function useClientCrossFeature(): ClientCrossFeatureCallbacks {
  const ctx = useContext(ClientCrossFeatureContext);
  if (!ctx) {
    throw new Error(
      'useClientCrossFeature must be used within a ClientCrossFeatureProvider. ' +
      'Wrap your client page in a provider from the composition layer.'
    );
  }
  return ctx;
}

export function ClientCrossFeatureProvider({
  value,
  children,
}: {
  value: ClientCrossFeatureCallbacks;
  children: ReactNode;
}) {
  return (
    <ClientCrossFeatureContext.Provider value={value}>
      {children}
    </ClientCrossFeatureContext.Provider>
  );
}
