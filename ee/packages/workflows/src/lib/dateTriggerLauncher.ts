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
    if (trigger?.type !== 'date' || !trigger.source || !Number.isInteger(trigger.offsetDays)) continue;
    if (!definition) continue;
    const source = params.sources.find((candidate) => candidate.id === trigger.source);
    if (!source) continue;
    const expectedSchemaRef = source.payloadSchemaRef;
    const schemaRef = typeof definition.payloadSchemaRef === 'string' ? definition.payloadSchemaRef : '';
    if (!expectedSchemaRef || schemaRef !== expectedSchemaRef || !schemaRegistry.has(schemaRef)) continue;

    const offsetDays = trigger.offsetDays as number;
    const { fromDate, toDate } = getDateTriggerOccurrenceRange(params.today, offsetDays);
    const occurrences = await source.findOccurrences(params.knex, params.tenantId, fromDate, toDate);
    const localTime = trigger.localTime ?? '08:00';
    const localTimezone = trigger.timezone ?? params.timezone;
    if (localTimeAt(params.now, localTimezone) < localTime) continue;

    for (const occurrence of occurrences) {
      const fireDate = Temporal.PlainDate.from(occurrence.occursOn).add({ days: offsetDays }).toString();
      const missedDays = Temporal.PlainDate.from(fireDate).until(Temporal.PlainDate.from(params.today), { largestUnit: 'day' }).days;
      if (missedDays < 0 || missedDays > LOOKBACK_DAYS) continue;
      const payload = { ...occurrence.payload, occursOn: occurrence.occursOn, fireDate, offsetDays };
      if (!schemaRegistry.get(schemaRef).safeParse(payload).success) continue;
      if (launched >= MAX_LAUNCHES_PER_TICK) { remaining += 1; continue; }
      const triggerFireKey = buildDateTriggerFireKey(workflow.workflow_id, trigger.source, occurrence.entityId, occurrence.occursOn, offsetDays);
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
    }
  }
  if (remaining > 0) logger.info('Date-trigger scan reached the per-tenant launch cap', { tenantId: params.tenantId, launched, remaining });
}
