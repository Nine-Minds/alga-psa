import logger from '@alga-psa/core/logger';
import { tenantDb } from '@alga-psa/db';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import { computeEntryAmounts, evaluateDateReadiness } from '@alga-psa/billing/services';
import type { IProjectBillingConfig, IProjectBillingScheduleEntry } from '@alga-psa/types';
import { runWithTenant } from 'server/src/lib/db';
import { getConnection } from 'server/src/lib/db/db';

export const PROJECT_DATE_READINESS_JOB = 'project-date-readiness';

export interface ProjectDateReadinessJobData extends Record<string, unknown> {
  tenantId: string;
}

export async function projectDateReadinessHandler(data: ProjectDateReadinessJobData): Promise<void> {
  if (!data.tenantId) {
    throw new Error('Tenant ID is required for project date readiness');
  }

  await runWithTenant(data.tenantId, async () => {
    const readyEntries = await evaluateDateReadiness(new Date());
    if (readyEntries.length === 0) return;

    const knex = await getConnection(data.tenantId);
    const db = tenantDb(knex, data.tenantId);
    const configIds = Array.from(new Set(readyEntries.map((entry) => entry.config_id)));
    const configs = await db.table<IProjectBillingConfig>('project_billing_configs')
      .whereIn('config_id', configIds)
      .select('*');
    const configById = new Map(configs.map((config) => [config.config_id, config]));
    const entries = await db.table<IProjectBillingScheduleEntry>('project_billing_schedule_entries')
      .whereIn('config_id', configIds)
      .select('*')
      .orderBy('config_id', 'asc')
      .orderBy('display_order', 'asc')
      .orderBy('created_at', 'asc')
      .orderBy('schedule_entry_id', 'asc');
    const entriesByConfig = new Map<string, IProjectBillingScheduleEntry[]>();
    for (const entry of entries) {
      const grouped = entriesByConfig.get(entry.config_id) ?? [];
      grouped.push(entry);
      entriesByConfig.set(entry.config_id, grouped);
    }

    const computedAmountByEntryId = new Map<string, number>();
    for (const configId of configIds) {
      const config = configById.get(configId);
      const configEntries = entriesByConfig.get(configId) ?? [];
      if (!config) continue;
      computeEntryAmounts(config, configEntries).forEach((amount, index) => {
        const entry = configEntries[index];
        if (entry) computedAmountByEntryId.set(entry.schedule_entry_id, amount);
      });
    }

    for (const entry of readyEntries) {
      const config = configById.get(entry.config_id);
      if (!config) {
        logger.warn('[projectDateReadinessHandler] Missing config for ready entry', {
          tenantId: data.tenantId,
          entryId: entry.schedule_entry_id,
          configId: entry.config_id,
        });
        continue;
      }
      await publishEvent({
        eventType: 'PROJECT_MILESTONE_READY',
        payload: {
          tenantId: data.tenantId,
          projectId: config.project_id,
          entryId: entry.schedule_entry_id,
          description: entry.description,
          computedAmount: computedAmountByEntryId.get(entry.schedule_entry_id) ?? 0,
          trigger: 'date',
        },
      });
      await publishEvent({
        eventType: 'PROJECT_BILLING_SCHEDULE_STATUS_CHANGED',
        payload: {
          tenantId: data.tenantId,
          projectId: config.project_id,
          configId: entry.config_id,
          entryId: entry.schedule_entry_id,
          description: entry.description,
          status: 'ready',
          previousStatus: 'pending',
          requiresPaymentBeforeWork: entry.requires_payment_before_work,
        },
      });
    }

    logger.info('[projectDateReadinessHandler] Evaluated project schedule readiness', {
      tenantId: data.tenantId,
      readyCount: readyEntries.length,
    });
  });
}
