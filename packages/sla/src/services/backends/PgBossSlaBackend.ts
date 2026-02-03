import type { ISlaBackend } from './ISlaBackend';
import type {
  IBusinessHoursScheduleWithEntries,
  ISlaPolicyTarget,
  ISlaStatus,
  SlaPauseReason,
} from '../../types';

export class PgBossSlaBackend implements ISlaBackend {
  async startSlaTracking(
    _ticketId: string,
    _policyId: string,
    _targets: ISlaPolicyTarget[],
    _schedule: IBusinessHoursScheduleWithEntries
  ): Promise<void> {
    // No-op placeholder; CE polling handles SLA timers.
  }

  async pauseSla(_ticketId: string, _reason: SlaPauseReason): Promise<void> {
    // No-op placeholder; pause/resume handled by existing services.
  }

  async resumeSla(_ticketId: string): Promise<void> {
    // No-op placeholder; pause/resume handled by existing services.
  }

  async completeSla(
    _ticketId: string,
    _type: 'response' | 'resolution',
    _met: boolean
  ): Promise<void> {
    // No-op placeholder; completion handled by existing services.
  }

  async cancelSla(_ticketId: string): Promise<void> {
    // No-op placeholder; polling naturally excludes deleted tickets.
  }

  async getSlaStatus(_ticketId: string): Promise<ISlaStatus | null> {
    return null;
  }
}
