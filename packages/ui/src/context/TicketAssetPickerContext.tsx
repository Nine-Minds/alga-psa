'use client';

import { createContext, useContext, type ReactNode } from 'react';

export interface TicketAssetPickerRenderProps {
  id: string;
  clientId: string;
  value: string[];
  onChange: (assetIds: string[]) => void;
  label: string;
  disabled?: boolean;
}

/**
 * Multi-select of a client's assets, for the ticket-create dialog
 * (alga-2026-0002785). Assets are a PSA-only surface and the tickets package
 * may not import the assets package, so the composition layer provides the
 * control; where it is not provided (AlgaDesk, the client portal) the dialog
 * simply shows no asset field.
 */
export interface TicketAssetPickerCallbacks {
  renderAssetPicker?: (props: TicketAssetPickerRenderProps) => ReactNode;
}

const TicketAssetPickerContext = createContext<TicketAssetPickerCallbacks>({});

export const TicketAssetPickerProvider = TicketAssetPickerContext.Provider;

export function useTicketAssetPicker(): TicketAssetPickerCallbacks {
  return useContext(TicketAssetPickerContext);
}
