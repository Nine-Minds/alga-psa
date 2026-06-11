/**
 * SLA Backend Actions
 *
 * The SLA service functions are pure DB mutators: they describe the backend
 * side effects they warrant (Temporal timers in EE, no-ops in CE) as
 * SlaBackendAction values instead of invoking the backend inside the caller's
 * transaction. Callers dispatch the returned actions with
 * dispatchSlaBackendActions() after their transaction commits, so no network
 * or cross-connection work ever runs while a ticket row lock is held.
 */

import {
  IBusinessHoursScheduleWithEntries,
  ISlaPolicyTarget,
  SlaPauseReason
} from '../types';
import { SlaBackendFactory } from './backends/SlaBackendFactory';

export type SlaBackendAction =
  | {
      kind: 'start';
      ticketId: string;
      policyId: string;
      targets: ISlaPolicyTarget[];
      schedule: IBusinessHoursScheduleWithEntries;
      notificationThresholds?: number[];
    }
  | { kind: 'pause'; ticketId: string; reason: SlaPauseReason }
  | { kind: 'resume'; ticketId: string }
  | { kind: 'complete'; ticketId: string; type: 'response' | 'resolution'; met: boolean | null }
  | { kind: 'cancel'; tenantId: string; ticketId: string };

/**
 * Dispatch backend actions returned by the SLA service functions.
 *
 * Call this only after the transaction that produced the actions has
 * committed. Failures are logged and swallowed per action: backend
 * scheduling is best-effort and must never undo a committed SLA write.
 */
export async function dispatchSlaBackendActions(
  actions: SlaBackendAction[] | undefined
): Promise<void> {
  if (!actions?.length) {
    return;
  }

  for (const action of actions) {
    try {
      const backend = await SlaBackendFactory.getBackend();
      switch (action.kind) {
        case 'start':
          await backend.startSlaTracking(
            action.ticketId,
            action.policyId,
            action.targets,
            action.schedule,
            action.notificationThresholds
          );
          break;
        case 'pause':
          await backend.pauseSla(action.ticketId, action.reason);
          break;
        case 'resume':
          await backend.resumeSla(action.ticketId);
          break;
        case 'complete':
          await backend.completeSla(action.ticketId, action.type, action.met);
          break;
        case 'cancel':
          await backend.cancelSla(action.tenantId, action.ticketId);
          break;
      }
    } catch (error) {
      console.warn(`Failed to dispatch SLA backend action '${action.kind}':`, error);
    }
  }
}
