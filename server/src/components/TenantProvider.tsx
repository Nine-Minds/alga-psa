'use client'

import React, { createContext, useContext, ReactNode } from 'react';

const TenantContext = createContext<string | null | undefined>(null);

export const useTenant = () => useContext(TenantContext);

interface TenantProviderProps {
  tenant?: string | null;
  children: ReactNode;
}

export function TenantProvider({ tenant, children }: TenantProviderProps) {
  return (
    <TenantContext.Provider value={tenant}>
      {children}
    </TenantContext.Provider>
  );
}
