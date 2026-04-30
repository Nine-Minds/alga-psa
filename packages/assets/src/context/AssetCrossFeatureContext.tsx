'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { ITicket, IBoard } from '@alga-psa/types';

export interface AssetQuickAddTicketRenderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTicketAdded: (ticket?: ITicket) => void;
  prefilledClient?: { id: string; name: string };
  assetId?: string;
  /** Display name shown in the dialog so the operator sees which asset will be linked. */
  assetName?: string;
}

export interface AssetTicketDetailsRenderProps {
  ticketId: string;
}

export interface CreateTicketFromAssetData {
  title: string;
  description: string;
  priority_id: string;
  status_id: string;
  board_id: string;
  asset_id: string;
  client_id: string;
}

export interface AssetCrossFeatureCallbacks {
  renderQuickAddTicket: (props: AssetQuickAddTicketRenderProps) => ReactNode;
  openTicketDetailsDrawer: (props: AssetTicketDetailsRenderProps) => Promise<void>;
  createTicketFromAsset: (data: CreateTicketFromAssetData) => Promise<ITicket>;
  getAllBoards: (includeAll: boolean) => Promise<IBoard[]>;
}

const AssetCrossFeatureContext = createContext<AssetCrossFeatureCallbacks | null>(null);

export function useAssetCrossFeature(): AssetCrossFeatureCallbacks {
  const ctx = useContext(AssetCrossFeatureContext);
  if (!ctx) {
    throw new Error(
      'useAssetCrossFeature must be used within an AssetCrossFeatureProvider. ' +
      'Wrap your asset page in a provider from the composition layer.'
    );
  }
  return ctx;
}

export function AssetCrossFeatureProvider({
  value,
  children,
}: {
  value: AssetCrossFeatureCallbacks;
  children: ReactNode;
}) {
  return (
    <AssetCrossFeatureContext.Provider value={value}>
      {children}
    </AssetCrossFeatureContext.Provider>
  );
}
