'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { ITicket, IBoard, RmmCachedData } from '@alga-psa/types';
import type { ActionMessageError, ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

export interface AssetQuickAddTicketRenderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTicketAdded: (ticket?: ITicket) => void;
  prefilledClient?: { id: string; name: string };
  assetId?: string;
  /** Display name shown in the dialog so the operator sees which asset will be linked. */
  assetName?: string;
  prefilledTitle?: string;
  prefilledDescription?: string;
  prefilledDueDate?: Date | string | null;
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

export interface AssetRmmCommandResult {
  success: boolean;
  message: string;
  jobId?: string;
}

/**
 * RMM device actions for the asset page. Implemented by @alga-psa/integrations
 * (which owns the providers) and injected here, since feature packages may
 * not import each other.
 */
export interface AssetRmmCallbacks {
  getAssetRmmData: (assetId: string) => Promise<RmmCachedData | null>;
  refreshAssetRmmData: (assetId: string) => Promise<RmmCachedData | null>;
  triggerRmmReboot: (assetId: string) => Promise<AssetRmmCommandResult>;
}

export interface AssetCrossFeatureCallbacks {
  renderQuickAddTicket: (props: AssetQuickAddTicketRenderProps) => ReactNode;
  openTicketDetailsDrawer: (props: AssetTicketDetailsRenderProps) => Promise<void>;
  createTicketFromAsset: (data: CreateTicketFromAssetData) => Promise<ITicket | ActionMessageError | ActionPermissionError>;
  getAllBoards: (includeAll: boolean) => Promise<IBoard[]>;
  rmm: AssetRmmCallbacks;
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
