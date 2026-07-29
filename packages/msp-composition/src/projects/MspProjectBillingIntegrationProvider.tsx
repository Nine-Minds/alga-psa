'use client';

import React, { useMemo } from 'react';
import {
  ProjectBillingIntegrationProvider,
  type ProjectBillingIntegrationContextType,
} from '@alga-psa/projects/context/ProjectBillingIntegrationContext';
import { getProjectBillingOverview } from '@alga-psa/billing/actions/projectBillingConfigActions';
import ProjectBillingView from '@alga-psa/billing/components/project-billing/ProjectBillingView';
import ProjectPaymentWarningBanner from '@alga-psa/billing/components/project-billing/ProjectPaymentWarningBanner';
import ProjectBilledBar from '@alga-psa/billing/components/project-billing/ProjectBilledBar';
import { listProjectMaterials } from '@alga-psa/projects/actions';
import { ProjectMaterialsDrawer } from '@alga-psa/projects/components';
import { useDrawer } from '@alga-psa/ui';
import type { ProjectBillingViewProps } from '@alga-psa/projects/context/ProjectBillingIntegrationContext';

function IntegratedProjectBillingView(props: ProjectBillingViewProps) {
  const { openDrawer } = useDrawer();
  const onManageMaterials = () => {
    openDrawer(
      <ProjectMaterialsDrawer projectId={props.projectId} clientId={props.clientId} />,
      undefined,
      undefined,
      '560px',
    );
  };

  return (
    <ProjectBillingView
      {...props}
      loadMaterials={listProjectMaterials}
      onManageMaterials={onManageMaterials}
    />
  );
}

/**
 * Wires the billing package's project-billing surfaces into the projects
 * package's integration slot. projects must not import billing (vertical
 * feature packages are acyclic), so the composition layer owns this edge.
 */
export function MspProjectBillingIntegrationProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo<ProjectBillingIntegrationContextType>(() => ({
    fetchOverview: getProjectBillingOverview,
    BillingView: IntegratedProjectBillingView,
    PaymentWarningBanner: ProjectPaymentWarningBanner,
    BilledBar: ProjectBilledBar,
  }), []);

  return (
    <ProjectBillingIntegrationProvider value={value}>
      {children}
    </ProjectBillingIntegrationProvider>
  );
}
