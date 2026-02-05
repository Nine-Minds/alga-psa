// Import from @alga-psa/types to break circular dependency:
// auth -> ee-stubs -> sla -> auth
import type {
  ISlaBackend,
  IBusinessHoursScheduleWithEntries,
  ISlaPolicyTarget,
  ISlaStatus,
  SlaPauseReason,
} from '@alga-psa/types';

export class TemporalSlaBackend implements ISlaBackend {
  private unavailable(): never {
    throw new Error('TemporalSlaBackend is only available in Enterprise Edition');
  }

  async startSlaTracking(
    _ticketId: string,
    _policyId: string,
    _targets: ISlaPolicyTarget[],
    _schedule: IBusinessHoursScheduleWithEntries
  ): Promise<void> {
    return this.unavailable();
  }

  async pauseSla(_ticketId: string, _reason: SlaPauseReason): Promise<void> {
    return this.unavailable();
  }

  async resumeSla(_ticketId: string): Promise<void> {
    return this.unavailable();
  }

  async completeSla(
    _ticketId: string,
    _type: 'response' | 'resolution',
    _met: boolean
  ): Promise<void> {
    return this.unavailable();
  }

  async cancelSla(_ticketId: string): Promise<void> {
    return this.unavailable();
  }

  async getSlaStatus(_ticketId: string): Promise<ISlaStatus | null> {
    return this.unavailable();
  }
}
