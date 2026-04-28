'use client';

import React, { createContext, useContext } from 'react';

export interface ExtraHiddenItem {
  id: string;
  title: string;
  onRestore: () => void | Promise<void>;
  isRestoring?: boolean;
}

const HiddenCardsExtrasContext = createContext<ExtraHiddenItem[]>([]);

interface ProviderProps {
  value: ExtraHiddenItem[];
  children: React.ReactNode;
}

export function HiddenCardsExtrasProvider({ value, children }: ProviderProps) {
  return (
    <HiddenCardsExtrasContext.Provider value={value}>
      {children}
    </HiddenCardsExtrasContext.Provider>
  );
}

export function useHiddenCardsExtras(): ExtraHiddenItem[] {
  return useContext(HiddenCardsExtrasContext);
}
