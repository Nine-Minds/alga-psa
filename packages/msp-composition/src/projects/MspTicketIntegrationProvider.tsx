'use client';

import React from 'react';
import { TicketIntegrationProvider } from '@alga-psa/projects/context/TicketIntegrationContext';
import { useTicketIntegrationValue } from './useTicketIntegrationValue';

interface MspTicketIntegrationProviderProps {
  children: React.ReactNode;
}

export const MspTicketIntegrationProvider: React.FC<MspTicketIntegrationProviderProps> = ({ children }) => {
  const value = useTicketIntegrationValue();

  return (
    <TicketIntegrationProvider value={value}>
      {children}
    </TicketIntegrationProvider>
  );
};
