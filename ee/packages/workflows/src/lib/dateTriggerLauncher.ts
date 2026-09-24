import { Temporal } from '@js-temporal/polyfill';
import type { Knex } from 'knex';
import { listPublishedWorkflowDefinitions } from '@alga-psa/workflows/persistence';
import { getSchemaRegistry, initializeWorkflowRuntimeV2 } from '@alga-psa/workflows/runtime/core';
import { launchPublishedWorkflowRun } from './workflowRunLauncher';
import logger from '@alga-psa/core/logger';
import type { DateTriggerSource } from '@alga-psa/jobs/date-triggers';

const LOOKBACK_DAYS = 3;
const MAX_LAUNCHES_PER_TICK = 500;

export function getDateTriggerOccurrenceRange(today: string, offsetDays: number): { fromDate: string; toDate: string } {
  return {
    fromDate: Temporal.PlainDate.from(today).subtract({ days: offsetDays + LOOKBACK_DAYS }).toString(),
    toDate: Temporal.PlainDate.from(today).subtract({ days: offsetDays }).toString(),
  };
}

export function buildDateTriggerFireKey(workflowId: string, source: string, entityId: string, occursOn: string, offsetDays: number): string {
  return `date:${workflowId}:${source}:${entityId}:${occursOn}:${offsetDays}`;
}

function localTimeAt(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.hour}:${values.minute}`;
}

export async function launchDateTriggeredWorkflows(params: {
  tenantId: string;
  today: string;
  now: Date;
  timezone: string;
  knex: Knex;
  sources: readonly DateTriggerSource[];
}): Promise<void> {
  initializeWorkflowRuntimeV2();
  const schemaRegistry = getSchemaRegistry();
  const published = await listPublishedWorkflowDefinitions(params.knex, params.tenantId);
  let launched = 0;
  let remaining = 0;

  for (const { workflow, definition } of published) {
    const trigger = definition?.trigger as { type?: string; source?: string; offsetDays?: number; localTime?: string; timezone?: string } | undefined;
    if (trigger?.type !== 'date' || !trigger.source || !Number.isInteger(trigger.offsetDays) || !definition) continue;
    const source = params.sources.find((candidate) => candidate.id === trigger.source);
    if (!source) {
      logger.warn('Skipping date workflow with unknown source', { tenantId: params.tenantId, workflowId: workflow.workflow_id, source: trigger.source, entityId: null });
      continue;
    }
    const localTime = trigger.localTime ?? '08:00';
    const localTimezone = trigger.timezone ?? params.timezone;
    try {
      if (localTimeAt(params.now, localTimezone) < localTime) continue;
    } catch (error) {
      logger.warn('Skipping date workflow with invalid timezone', { tenantId: params.tenantId, workflowId: workflow.workflow_id, source: trigger.source, entityId: null, timezone: localTimezone, error });
      continue;
    }
    const expectedSchemaRef = source.payloadSchemaRef;
    const schemaRef = typeof definition.payloadSchemaRef === 'string' ? definition.payloadSchemaRef : '';
    const schemaMatches = Boolean(expectedSchemaRef && schemaRef === expectedSchemaRef && schemaRegistry.has(schemaRef));

    const offsetDays = trigger.offsetDays as number;
    const { fromDate, toDate } = getDateTriggerOccurrenceRange(params.today, offsetDays);
    let occurrences: Awaited<ReturnType<DateTriggerSource['findOccurrences']>>;
    try {
      occurrences = await source.findOccurrences(params.knex, params.tenantId, fromDate, toDate);
    } catch (error) {
      logger.error('Failed to query date-trigger source', { tenantId: params.tenantId, workflowId: workflow.workflow_id, source: trigger.source, entityId: null, error });
      continue;
    }

    for (const occurrence of occurrences) {
      if (!schemaMatches) {
        logger.warn('Skipping date workflow with payload schema mismatch', { tenantId: params.tenantId, workflowId: workflow.workflow_id, source: trigger.source, entityId: occurrence.entityId, expectedSchemaRef, actualSchemaRef: schemaRef });
        continue;
      }
      const fireDate = Temporal.PlainDate.from(occurrence.occursOn).add({ days: offsetDays }).toString();
      const missedDays = Temporal.PlainDate.from(fireDate).until(Temporal.PlainDate.from(params.today), { largestUnit: 'day' }).days;
      if (missedDays < 0 || missedDays > LOOKBACK_DAYS) continue;
      const payload = { ...occurrence.payload, occursOn: occurrence.occursOn, fireDate, offsetDays };
      const validation = schemaRegistry.get(schemaRef).safeParse(payload);
      if (!validation.success) {
        logger.warn('Skipping date occurrence with invalid payload', { tenantId: params.tenantId, workflowId: workflow.workflow_id, source: trigger.source, entityId: occurrence.entityId, issues: validation.error?.issues });
        continue;
      }
      if (launched >= MAX_LAUNCHES_PER_TICK) { remaining += 1; continue; }
      const triggerFireKey = buildDateTriggerFireKey(workflow.workflow_id, trigger.source, occurrence.entityId, occurrence.occursOn, offsetDays);
      try {
        await launchPublishedWorkflowRun(params.knex, {
        workflowId: workflow.workflow_id,
        tenantId: params.tenantId,
        payload,
        triggerType: 'date',
        triggerFireKey,
        triggerMetadata: { source: trigger.source, occursOn: occurrence.occursOn, offsetDays, entityId: occurrence.entityId },
        sourcePayloadSchemaRef: schemaRef,
        });
        launched += 1;
      } catch (error) {
        logger.error('Failed to launch date-triggered workflow occurrence', { tenantId: params.tenantId, workflowId: workflow.workflow_id, source: trigger.source, entityId: occurrence.entityId, error });
      }
    }
  }
  if (remaining > 0) logger.info('Date-trigger scan reached the per-tenant launch cap', { tenantId: params.tenantId, launched, remaining });
}
