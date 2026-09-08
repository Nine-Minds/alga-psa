'use client';

import type { ReactNode } from 'react';
import { ProjectEffortIntegrationProvider } from '@alga-psa/projects/context/ProjectEffortIntegrationContext';
import { useProduct } from '@/context/ProductContext';
import CoManagedEffort from './CoManagedEffort';

function TaskEffort({ taskId }: { taskId: string }) {
  return <CoManagedEffort target={{ kind: 'local_task', taskId }} />;
}
const integration = { TaskEffort };

/** Mounted above both page content and the native drawer outlet. */
export default function CoManagedProjectEffortProvider({ children }: { children: ReactNode }) {
  const { productCode, isLoading, isMisconfigured } = useProduct();
  const enabled = productCode === 'co_managed' && !isLoading && !isMisconfigured;
  return <ProjectEffortIntegrationProvider value={enabled ? integration : null}>{children}</ProjectEffortIntegrationProvider>;
}
