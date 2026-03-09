'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { IClient } from '@alga-psa/types';

export interface QuickAddClientRenderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClientAdded: (client: IClient) => void;
  trigger?: ReactNode;
  skipSuccessDialog?: boolean;
}

export interface QuickAddClientCallbacks {
  renderQuickAddClient: (props: QuickAddClientRenderProps) => ReactNode;
}

const defaultCallbacks: QuickAddClientCallbacks = {
  renderQuickAddClient: () => null,
};

const QuickAddClientContext = createContext<QuickAddClientCallbacks>(defaultCallbacks);

export const QuickAddClientProvider = QuickAddClientContext.Provider;

export function useQuickAddClient(): QuickAddClientCallbacks {
  return useContext(QuickAddClientContext);
}
