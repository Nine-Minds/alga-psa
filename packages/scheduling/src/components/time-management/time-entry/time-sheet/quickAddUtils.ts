import type { IExtendedWorkItem, ITimeEntryWithWorkItemString } from '@alga-psa/types';

export function resolveQuickAddBehavior(
  workItem: Pick<IExtendedWorkItem, 'service_id'>,
  existingEntry?: Pick<ITimeEntryWithWorkItemString, 'service_id'>
): { mode: 'save'; serviceId: string } | { mode: 'dialog' } {
  const existingEntryServiceId = existingEntry?.service_id?.trim();
  if (existingEntryServiceId) {
    return {
      mode: 'save',
      serviceId: existingEntryServiceId,
    };
  }

  const workItemServiceId = workItem.service_id?.trim();
  if (workItemServiceId) {
    return {
      mode: 'save',
      serviceId: workItemServiceId,
    };
  }

  return {
    mode: 'dialog',
  };
}
