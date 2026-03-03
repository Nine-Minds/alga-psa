'use client';

import { createContext, useContext } from 'react';

export interface ClientDrawerContextType {
  openClientDrawer: (clientId: string) => void;
}

export const ClientDrawerContext = createContext<ClientDrawerContextType | undefined>(undefined);

/**
 * Returns the client drawer context, or undefined if no provider is present.
 * Callers should check for undefined before using.
 */
export function useClientDrawer(): ClientDrawerContextType | undefined {
  return useContext(ClientDrawerContext);
}
