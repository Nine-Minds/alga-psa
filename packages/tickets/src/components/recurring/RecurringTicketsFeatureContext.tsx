'use client';

import React, { createContext, useContext, type ReactNode } from 'react';

export interface RecurringAssetPickerProps {
  id: string;
  clientId: string;
  value: string[];
  onChange: (assetIds: string[]) => void;
  label: string;
  disabled?: boolean;
}

/**
 * Seams to features the tickets package must not import (feature packages may not depend on each
 * other). The composition layer provides them; a seam that is not provided simply hides its control.
 */
export interface RecurringTicketsCrossFeature {
  /** Multi-select of a client's assets, owned by the assets package. */
  renderAssetPicker?: (props: RecurringAssetPickerProps) => ReactNode;
}

const RecurringTicketsCrossFeatureContext = createContext<RecurringTicketsCrossFeature>({});

export function RecurringTicketsCrossFeatureProvider({
  value, children,
}: { value: RecurringTicketsCrossFeature; children: ReactNode }) {
  return (
    <RecurringTicketsCrossFeatureContext.Provider value={value}>{children}</RecurringTicketsCrossFeatureContext.Provider>
  );
}

export function useRecurringTicketsCrossFeature(): RecurringTicketsCrossFeature {
  return useContext(RecurringTicketsCrossFeatureContext);
}
