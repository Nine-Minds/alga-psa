'use client';

import React from 'react';
import { TicketIntegrationProvider } from '@alga-psa/projects/context/TicketIntegrationContext';
import ProjectPage from '@alga-psa/projects/components/ProjectPage';
import { useTicketIntegrationValue } from './useTicketIntegrationValue';
import ProjectMaterialsDrawer from './ProjectMaterialsDrawer';
import ProjectDetailsEdit from './ProjectDetailsEdit';

export default function MspProjectPageClient(props: { params: Promise<{ id: string }> }) {
  const contextValue = useTicketIntegrationValue();

  return (
    <TicketIntegrationProvider value={contextValue}>
      <ProjectPage
        params={props.params}
        renderMaterialsDrawer={({ projectId, clientId }) => (
          <ProjectMaterialsDrawer projectId={projectId} clientId={clientId} />
        )}
        ProjectDetailsEditComponent={ProjectDetailsEdit}
      />
    </TicketIntegrationProvider>
  );
}
