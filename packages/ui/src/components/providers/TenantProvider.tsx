'use client';

import React, { createContext, useContext, type ReactNode } from 'react';

const TenantContext = createContext<string | null | undefined>(null);

export const useTenant = () => useContext(TenantContext);

export interface TenantProviderProps {
  tenant?: string | null;
  children: ReactNode;
}

export function TenantProvider({ tenant, children }: TenantProviderProps) {
  return <TenantContext.Provider value={tenant}>{children}</TenantContext.Provider>;
}

