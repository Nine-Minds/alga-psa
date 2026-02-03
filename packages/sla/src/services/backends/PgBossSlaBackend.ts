import { createTenantKnex, getConnection, getTenantContext, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import type { ISlaBackend } from './ISlaBackend';
import type {
  IBusinessHoursScheduleWithEntries,
  ISlaPolicyTarget,
  ISlaStatus,
  SlaPauseReason,
} from '../../types';
import { pauseSla, resumeSla } from '../slaPauseService';
import { getSlaStatus, recordFirstResponse, recordResolution } from '../slaService';

export class PgBossSlaBackend implements ISlaBackend {
  async startSlaTracking(
    _ticketId: string,
    _policyId: string,
    _targets: ISlaPolicyTarget[],
    _schedule: IBusinessHoursScheduleWithEntries
  ): Promise<void> {
    // No-op placeholder; CE polling handles SLA timers.
  }

  async pauseSla(ticketId: string, reason: SlaPauseReason): Promise<void> {
    await this.withTicketTransaction(ticketId, async (trx, tenant) => {
      await pauseSla(trx, tenant, ticketId, reason, undefined, {
        skipBackend: true,
      });
    });
  }

  async resumeSla(ticketId: string): Promise<void> {
    await this.withTicketTransaction(ticketId, async (trx, tenant) => {
      await resumeSla(trx, tenant, ticketId, undefined, {
        skipBackend: true,
      });
    });
  }

  async completeSla(
    ticketId: string,
    type: 'response' | 'resolution',
    _met: boolean
  ): Promise<void> {
    await this.withTicketTransaction(ticketId, async (trx, tenant) => {
      if (type === 'response') {
        await recordFirstResponse(trx, tenant, ticketId, new Date());
        return;
      }
      await recordResolution(trx, tenant, ticketId, new Date());
    });
  }

  async cancelSla(_ticketId: string): Promise<void> {
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

  private async withTicketTransaction(
    ticketId: string,
    fn: (trx: Knex.Transaction, tenant: string) => Promise<void>
  ): Promise<void> {
    const tenant = await this.resolveTenant(ticketId);
    if (!tenant) {
      return;
    }

    const { knex } = await createTenantKnex(tenant);
    await withTransaction(knex, async (trx) => fn(trx, tenant));
  }

  private async resolveTenant(ticketId: string): Promise<string | null> {
    const contextTenant = getTenantContext();
    if (contextTenant) {
      return contextTenant;
    }

    const knex = await getConnection(null);
    const ticket = await knex<{ tenant: string }>('tickets')
      .where({ ticket_id: ticketId })
      .select('tenant')
      .first();

    return ticket?.tenant ?? null;
  }
}
