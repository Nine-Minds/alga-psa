'use client';

import React from 'react';
import { UIStateProvider } from './UIStateContext';
import { PageState } from './types';

interface ClientUIStateProviderProps {
  children: React.ReactNode;
  initialPageState: PageState;
}

export function ClientUIStateProvider({ children, initialPageState }: ClientUIStateProviderProps) {
  return (
    <UIStateProvider initialPageState={initialPageState}>
      {children}
    </UIStateProvider>
  );
}
