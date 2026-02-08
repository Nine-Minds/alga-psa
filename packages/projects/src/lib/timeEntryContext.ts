import type { TimeEntryWorkItemContext } from '@alga-psa/types';

interface BuildTaskTimeEntryContextParams {
  taskId: string;
  taskName: string;
  projectName?: string;
  phaseName?: string;
  serviceId?: string | null;
  serviceName?: string | null;
}

export function buildTaskTimeEntryContext({
  taskId,
  taskName,
  projectName,
  phaseName,
  serviceId,
  serviceName,
}: BuildTaskTimeEntryContextParams): TimeEntryWorkItemContext {
  return {
    workItemId: taskId,
    workItemType: 'project_task',
    workItemName: taskName,
    projectName,
    phaseName,
    taskName,
    serviceId,
    serviceName,
  };
}
