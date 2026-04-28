import type {
  IBusinessHoursScheduleWithEntries,
  ISlaPolicyTarget,
  ISlaStatus,
  SlaPauseReason,
} from '../../types';

export interface ISlaBackend {
  startSlaTracking(
    ticketId: string,
    policyId: string,
    targets: ISlaPolicyTarget[],
    schedule: IBusinessHoursScheduleWithEntries,
    notificationThresholds?: number[]
  ): Promise<void>;
  pauseSla(ticketId: string, reason: SlaPauseReason): Promise<void>;
  resumeSla(ticketId: string): Promise<void>;
  completeSla(
    ticketId: string,
    type: 'response' | 'resolution',
    met: boolean | null
  ): Promise<void>;
  cancelSla(ticketId: string): Promise<void>;
  getSlaStatus(ticketId: string): Promise<ISlaStatus | null>;
}
