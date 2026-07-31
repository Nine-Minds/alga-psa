import { createTenantKnex, getConnection, getTenantContext, tenantDb } from '@alga-psa/db';
import type { ISlaBackend } from './ISlaBackend';
import type {
  IBusinessHoursScheduleWithEntries,
  ISlaPolicyTarget,
  ISlaStatus,
  SlaPauseReason,
} from '../../types';
import { getSlaStatus } from '../slaService';

const SLA_TENANT_DISCOVERY = 'tenant-discovery';

/**
 * CE backend. The SLA columns are persisted by the caller before any backend
 * method runs, and CE timers/notifications are driven by polling, so every
 * mutation hook is a no-op. These methods must never write the tickets row:
 * re-doing the write on a second connection while the caller's transaction
 * holds the row lock self-deadlocks until pgbouncer reaps the session.
 */
export class PgBossSlaBackend implements ISlaBackend {
  async startSlaTracking(
    _ticketId: string,
    _policyId: string,
    _targets: ISlaPolicyTarget[],
    _schedule: IBusinessHoursScheduleWithEntries,
    _notificationThresholds?: number[]
  ): Promise<void> {
    // No-op; CE polling handles SLA timers.
  }

  async pauseSla(_ticketId: string, _reason: SlaPauseReason): Promise<void> {
    // No-op; sla_paused_at is already persisted by the caller.
  }

  async resumeSla(_ticketId: string): Promise<void> {
    // No-op; pause bookkeeping is already persisted by the caller.
  }

  async completeSla(
    _ticketId: string,
    _type: 'response' | 'resolution',
    _met: boolean | null
  ): Promise<void> {
    // No-op; sla_response_at/sla_resolution_at are already persisted by the caller.
  }

  async cancelSla(_tenantId: string, _ticketId: string): Promise<void> {
    // No-op placeholder; polling naturally excludes deleted tickets.
  }

  async getSlaStatus(ticketId: string): Promise<ISlaStatus | null> {
    const tenant = await this.resolveTenant(ticketId);
    if (!tenant) {
      return null;
    }

    const { knex } = await createTenantKnex(tenant);
    return getSlaStatus(knex, tenant, ticketId);
  }

  private async resolveTenant(ticketId: string): Promise<string | null> {
    const contextTenant = getTenantContext();
    if (contextTenant) {
      return contextTenant;
    }

    const knex = await getConnection(null);
    const ticket = await tenantDb(knex, SLA_TENANT_DISCOVERY)
      .unscoped('tickets', 'tenant discovery for SLA status lookup by ticket id')
      .where('ticket_id', ticketId)
      .select('tenant')
      .first<{ tenant: string } | undefined>();

    return ticket?.tenant ?? null;
  }
}
