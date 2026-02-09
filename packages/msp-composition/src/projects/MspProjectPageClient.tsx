'use client';

import React from 'react';
import { TicketIntegrationProvider } from '@alga-psa/projects/context/TicketIntegrationContext';
import { UnsavedChangesProvider } from '@alga-psa/ui/context';
import ProjectPage from '@alga-psa/projects/components/ProjectPage';
import { useTicketIntegrationValue } from './useTicketIntegrationValue';

export default function MspProjectPageClient(props: { params: Promise<{ id: string }> }) {
  const contextValue = useTicketIntegrationValue();

  return (
    <UnsavedChangesProvider>
      <TicketIntegrationProvider value={contextValue}>
        <ProjectPage params={props.params} />
      </TicketIntegrationProvider>
    </UnsavedChangesProvider>
  );
}
