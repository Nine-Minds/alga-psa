import logger from '@alga-psa/core/logger';
import { getConnection } from '@alga-psa/db';
import type { ISlaBackend } from '@alga-psa/sla/services';
import type {
  IBusinessHoursScheduleWithEntries,
  ISlaPolicyTarget,
  ISlaStatus,
  SlaPauseReason,
} from '@alga-psa/sla/types';

const DEFAULT_TEMPORAL_ADDRESS =
  'temporal-frontend.temporal.svc.cluster.local:7233';
const DEFAULT_TEMPORAL_NAMESPACE = 'default';
const DEFAULT_SLA_TASK_QUEUE = 'sla-workflows';

export class TemporalSlaBackend implements ISlaBackend {
  private clientPromise: Promise<any> | null = null;

  async startSlaTracking(
    ticketId: string,
    _policyId: string,
    targets: ISlaPolicyTarget[],
    schedule: IBusinessHoursScheduleWithEntries
  ): Promise<void> {
    const tenantId = schedule.tenant;
    if (!tenantId) {
      throw new Error('SLA workflow requires tenantId on schedule');
    }

    const client = await this.getClient();
    const workflowId = this.getWorkflowId(tenantId, ticketId);

    await client.workflow.start('slaTicketWorkflow', {
      args: [
        {
          ticketId,
          tenantId,
          policyTargets: targets,
          businessHoursSchedule: schedule,
        },
      ],
      taskQueue: this.getTaskQueue(),
      workflowId,
      workflowExecutionTimeout: '365d',
    });
  }

  async pauseSla(ticketId: string, reason: SlaPauseReason): Promise<void> {
    const handle = await this.getHandle(ticketId);
    await handle.signal('pause', { reason });
  }

  async resumeSla(ticketId: string): Promise<void> {
    const handle = await this.getHandle(ticketId);
    await handle.signal('resume');
  }

  async completeSla(
    ticketId: string,
    type: 'response' | 'resolution',
    met: boolean
  ): Promise<void> {
    const handle = await this.getHandle(ticketId);
    const signalName = type === 'response' ? 'completeResponse' : 'completeResolution';
    await handle.signal(signalName, { met });
  }

  async cancelSla(ticketId: string): Promise<void> {
    const handle = await this.getHandle(ticketId);
    await handle.signal('cancel');
  }

  async getSlaStatus(ticketId: string): Promise<ISlaStatus | null> {
    const handle = await this.getHandle(ticketId);
    try {
      const state = await handle.query('getState');
      return state as ISlaStatus | null;
    } catch (error) {
      logger.error('[TemporalSlaBackend] Failed to query SLA workflow', {
        ticketId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async getHandle(ticketId: string): Promise<any> {
    const tenantId = await this.resolveTenantId(ticketId);
    const client = await this.getClient();
    const workflowId = this.getWorkflowId(tenantId, ticketId);
    return client.workflow.getHandle(workflowId);
  }

  private async resolveTenantId(ticketId: string): Promise<string> {
    const knex = await getConnection(null);
    const ticket = await knex<{ tenant: string }>('tickets')
      .where({ ticket_id: ticketId })
      .select('tenant')
      .first();

    if (!ticket?.tenant) {
      throw new Error(`Tenant ID not available for SLA workflow ticket ${ticketId}`);
    }

    return ticket.tenant;
  }

  private getWorkflowId(tenantId: string, ticketId: string): string {
    return `sla-ticket-${tenantId}-${ticketId}`;
  }

  private getTaskQueue(): string {
    return process.env.TEMPORAL_SLA_TASK_QUEUE || DEFAULT_SLA_TASK_QUEUE;
  }

  private async getClient(): Promise<any> {
    if (this.clientPromise) {
      return this.clientPromise;
    }

    this.clientPromise = (async () => {
      const mod: any = await import('@temporalio/client').catch(() => null);
      if (!mod) {
        throw new Error('Temporal client not available');
      }

      const address = process.env.TEMPORAL_ADDRESS || DEFAULT_TEMPORAL_ADDRESS;
      const namespace = process.env.TEMPORAL_NAMESPACE || DEFAULT_TEMPORAL_NAMESPACE;

      const connection = await mod.Connection.connect({ address });
      return new mod.Client({ connection, namespace });
    })();

    return this.clientPromise;
  }
}
