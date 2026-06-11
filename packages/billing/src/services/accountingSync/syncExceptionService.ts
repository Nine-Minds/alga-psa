import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import logger from '@alga-psa/core/logger';
import type { SyncExceptionInput, SyncExceptionService, SyncExceptionType } from './syncExceptions.types';

/**
 * Files sync exceptions as system workflow tasks in the existing task inbox
 * (task definitions from migration 20260611100200). Deduplicated: one OPEN
 * task per entity+type — repeat occurrences update the task's context instead
 * of spamming the inbox every cycle.
 */

const OPEN_STATUSES = ['pending', 'in_progress'];

function dedupeKey(entityType: string, entityId: string): string {
  return `${entityType}:${entityId}`;
}

export class WorkflowTaskSyncExceptionService implements SyncExceptionService {
  constructor(
    private readonly knex: Knex,
    private readonly tenantId: string
  ) {}

  private openTaskQuery(type: SyncExceptionType, entityType: string, entityId: string) {
    return this.knex('workflow_tasks')
      .where({
        tenant: this.tenantId,
        task_definition_type: 'system',
        system_task_definition_task_type: type
      })
      .whereIn('status', OPEN_STATUSES)
      .whereRaw("context_data->>'dedupe_key' = ?", [dedupeKey(entityType, entityId)]);
  }

  async createOrUpdate(input: SyncExceptionInput): Promise<{ created: boolean }> {
    const contextData = {
      dedupe_key: dedupeKey(input.entityType, input.entityId),
      entity_type: input.entityType,
      entity_id: input.entityId,
      message: input.title,
      details: JSON.stringify(input.context, null, 2),
      ...input.context,
      last_seen_at: new Date().toISOString()
    };

    const existing = await this.openTaskQuery(input.type, input.entityType, input.entityId).first();

    if (existing) {
      await this.knex('workflow_tasks')
        .where({ tenant: this.tenantId, task_id: existing.task_id })
        .update({
          context_data: JSON.stringify(contextData),
          updated_at: new Date().toISOString()
        });
      return { created: false };
    }

    await this.knex('workflow_tasks').insert({
      task_id: uuidv4(),
      tenant: this.tenantId,
      execution_id: uuidv4(), // standalone inbox task; no workflow execution behind it
      task_definition_type: 'system',
      system_task_definition_task_type: input.type,
      title: input.title,
      description: '',
      status: 'pending',
      priority: 'medium',
      context_data: JSON.stringify(contextData),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    logger.info('[accountingSync] Filed sync exception', {
      tenantId: this.tenantId,
      type: input.type,
      entityType: input.entityType,
      entityId: input.entityId
    });

    return { created: true };
  }

  async resolve(type: SyncExceptionType, entityType: string, entityId: string): Promise<void> {
    await this.openTaskQuery(type, entityType, entityId).update({
      status: 'completed',
      updated_at: new Date().toISOString()
    });
  }

  /** Open exception count for the health panel. */
  async countOpen(): Promise<number> {
    const row = await this.knex('workflow_tasks')
      .where({ tenant: this.tenantId, task_definition_type: 'system' })
      .whereIn('system_task_definition_task_type', [
        'accounting_sync_drift',
        'accounting_sync_unmapped_payment',
        'accounting_sync_export_error',
        'accounting_sync_customer_unlinked',
        'accounting_connection_expired'
      ])
      .whereIn('status', OPEN_STATUSES)
      .count<{ count: string }[]>('* as count')
      .first();

    return Number(row?.count ?? 0);
  }
}
