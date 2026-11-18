'use client';

import type { ReactNode } from 'react';
import { ProjectEffortIntegrationProvider } from '@alga-psa/projects/context/ProjectEffortIntegrationContext';
import { useCapability } from '@alga-psa/ui/hooks';
import CoManagedEffort from './CoManagedEffort';

function TaskEffort({ taskId }: { taskId: string }) {
  return <CoManagedEffort target={{ kind: 'local_task', taskId }} />;
}
const integration = { TaskEffort };

/** Mounted above both page content and the native drawer outlet. Closed (null) unless the workspace `serves` co-managed. */
export default function CoManagedProjectEffortProvider({ children }: { children: ReactNode }) {
  const { enabled } = useCapability('co-managed');
  return <ProjectEffortIntegrationProvider value={enabled ? integration : null}>{children}</ProjectEffortIntegrationProvider>;
}
