import { isTimeEntryService } from '@alga-psa/core';
import type { ProjectServiceSource, TimeEntryWorkItemContext } from '@alga-psa/types';

/** A resolved phase/project default, as `getEffectiveTaskService` reports it. */
export interface InheritedServiceDefault {
  serviceId: string | null;
  serviceName: string | null;
  billingMethod: string | null;
  source: 'phase' | 'project' | null;
}

export interface ApplicableServiceDefault {
  serviceId: string;
  serviceName: string | null;
  source: 'phase' | 'project';
}

/**
 * The inherited default a time entry can actually use. The billing method rides
 * along on the resolution so this holds without a service-catalog fetch — the
 * entry is launched on click, before any catalog list is guaranteed to be loaded.
 */
export function applicableServiceDefault(
  inherited: InheritedServiceDefault | null | undefined,
): ApplicableServiceDefault | null {
  if (!inherited?.serviceId || !inherited.source) return null;
  if (!isTimeEntryService({
    service_id: inherited.serviceId,
    service_name: inherited.serviceName ?? '',
    billing_method: inherited.billingMethod,
  })) {
    return null;
  }
  return {
    serviceId: inherited.serviceId,
    serviceName: inherited.serviceName,
    source: inherited.source,
  };
}

interface BuildTaskTimeEntryContextParams {
  taskId: string;
  taskName: string;
  projectName?: string;
  phaseName?: string;
  serviceId?: string | null;
  serviceName?: string | null;
  serviceSource?: ProjectServiceSource | null;
}

export function buildTaskTimeEntryContext({
  taskId,
  taskName,
  projectName,
  phaseName,
  serviceId,
  serviceName,
  serviceSource,
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
    serviceSource: serviceSource ?? undefined,
  };
}
