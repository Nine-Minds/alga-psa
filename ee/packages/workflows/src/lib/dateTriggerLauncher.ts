import { createHash } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import type { Knex } from 'knex';
import { listPublishedWorkflowDefinitions } from '@alga-psa/workflows/persistence';
import { getSchemaRegistry, initializeWorkflowRuntimeV2 } from '@alga-psa/workflows/runtime/core';
import { computeDateTriggerFireDate } from '../../../../../shared/workflow/runtime/dateTriggerOccurrence';
import { getDateTriggerSourceDefinition } from '../../../../../shared/workflow/runtime/dateTriggerSourceDefinitions';
import { canonicalizeDateTriggerParams, validateDateTriggerParams } from '../../../../../shared/workflow/runtime/dateTriggerParams';
import { launchPublishedWorkflowRun } from './workflowRunLauncher';
import logger from '@alga-psa/core/logger';
import type { DateTriggerSource } from './dateTriggerSource';

const LOOKBACK_DAYS = 3;
const MAX_LAUNCHES_PER_TICK = 500;

export function getDateTriggerOccurrenceRange(today: string, offsetDays: number): { fromDate: string; toDate: string } {
  return {
    fromDate: Temporal.PlainDate.from(today).subtract({ days: offsetDays + LOOKBACK_DAYS }).toString(),
    toDate: Temporal.PlainDate.from(today).subtract({ days: offsetDays }).toString(),
  };
}

/** Stable short hash of a trigger's normalized params: key order never changes it. */
export function hashDateTriggerParams(params: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalizeDateTriggerParams(params)).digest('hex').slice(0, 16);
}

/**
 * `extra` is only given for condition sources, whose occurrences are identified by more than a date:
 * the cycle (for tickets, the full timestamp the ticket entered its status) and the trigger params
 * (a changed threshold is a different trigger). Window sources pass nothing, so their keys are
 * byte-identical to what was stored before condition sources existed.
 */
export function buildDateTriggerFireKey(
  workflowId: string,
  source: string,
  entityId: string,
  occursOn: string,
  offsetDays: number,
  extra?: { cycleKey: string; params: Record<string, unknown> },
): string {
  const base = `date:${workflowId}:${source}:${entityId}:${occursOn}:${offsetDays}`;
  return extra ? `${base}:${extra.cycleKey}:${hashDateTriggerParams(extra.params)}` : base;
}

const EXISTING_KEY_CHUNK = 500;

async function findExistingFireKeys(knex: Knex, tenantId: string, keys: string[]): Promise<Set<string>> {
  const existing = new Set<string>();
  for (let i = 0; i < keys.length; i += EXISTING_KEY_CHUNK) {
    const rows = await knex('workflow_runs').where({ tenant: tenantId }).whereIn('trigger_fire_key', keys.slice(i, i + EXISTING_KEY_CHUNK)).select('trigger_fire_key');
    for (const row of rows) existing.add(row.trigger_fire_key);
  }
  return existing;
}

function localTimeAt(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.hour}:${values.minute}`;
}

function localDateAt(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
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
    const trigger = definition?.trigger as { type?: string; source?: string; offsetDays?: number; localTime?: string; timezone?: string; params?: unknown } | undefined;
    if (trigger?.type !== 'date' || !trigger.source || !Number.isInteger(trigger.offsetDays) || !definition) continue;
    const source = params.sources.find((candidate) => candidate.id === trigger.source);
    if (!source) {
      logger.warn('Skipping date workflow with unknown source', { tenantId: params.tenantId, workflowId: workflow.workflow_id, source: trigger.source, entityId: null });
      continue;
    }
    const localTime = trigger.localTime ?? '08:00';
    const localTimezone = trigger.timezone ?? params.timezone;
    let workflowToday: string;
    try {
      if (localTimeAt(params.now, localTimezone) < localTime) continue;
      workflowToday = localDateAt(params.now, localTimezone);
    } catch (error) {
      logger.warn('Skipping date workflow with invalid timezone', { tenantId: params.tenantId, workflowId: workflow.workflow_id, source: trigger.source, entityId: null, timezone: localTimezone, error });
      continue;
    }
    const sourceDefinition = getDateTriggerSourceDefinition(trigger.source);
    if (!sourceDefinition) {
      logger.warn('Skipping date workflow with unknown source', { tenantId: params.tenantId, workflowId: workflow.workflow_id, source: trigger.source, entityId: null });
      continue;
    }
    const isCondition = sourceDefinition.mode === 'condition';
    let sourceParams: Record<string, unknown> | undefined;
    if (sourceDefinition.hasParams) {
      const parsed = validateDateTriggerParams(trigger.source, trigger.params);
      if (!parsed.ok) {
        logger.warn('Skipping date workflow with invalid trigger params', { tenantId: params.tenantId, workflowId: workflow.workflow_id, source: trigger.source, entityId: null, issues: parsed.issues });
        continue;
      }
      sourceParams = parsed.params as Record<string, unknown>;
    }
    const expectedSchemaRef = sourceDefinition.payloadSchemaRef;
    const schemaRef = typeof definition.payloadSchemaRef === 'string' ? definition.payloadSchemaRef : '';
    const schemaMatches = Boolean(expectedSchemaRef && schemaRef === expectedSchemaRef && schemaRegistry.has(schemaRef));

    const offsetDays = trigger.offsetDays as number;
    const { fromDate, toDate } = getDateTriggerOccurrenceRange(workflowToday, offsetDays);
    let occurrences: Awaited<ReturnType<DateTriggerSource['findOccurrences']>>;
    try {
      occurrences = isCondition
        ? await source.findOccurrences(params.knex, params.tenantId, workflowToday, workflowToday, { params: sourceParams, today: workflowToday, timezone: localTimezone })
        : await source.findOccurrences(params.knex, params.tenantId, fromDate, toDate);
    } catch (error) {
      logger.error('Failed to query date-trigger source', { tenantId: params.tenantId, workflowId: workflow.workflow_id, source: trigger.source, entityId: null, error });
      continue;
    }

    const fireKeyFor = (occurrence: typeof occurrences[number]): string => buildDateTriggerFireKey(
      workflow.workflow_id, trigger.source as string, occurrence.entityId, occurrence.occursOn, offsetDays,
      isCondition ? { cycleKey: occurrence.cycleKey, params: sourceParams ?? {} } : undefined,
    );
    // A condition source reports every qualifying entity on every scan, so most were launched by an
    // earlier scan. Skip those in one query instead of attempting thousands of launches.
    let alreadyLaunched = new Set<string>();
    if (isCondition && occurrences.length > 0) {
      try {
        alreadyLaunched = await findExistingFireKeys(params.knex, params.tenantId, occurrences.map(fireKeyFor));
      } catch (error) {
        logger.warn('Could not pre-check existing date-trigger fire keys; relying on launch-time dedup', { tenantId: params.tenantId, workflowId: workflow.workflow_id, source: trigger.source, entityId: null, error });
      }
    }

    for (const occurrence of occurrences) {
      if (!schemaMatches) {
        logger.warn('Skipping date workflow with payload schema mismatch', { tenantId: params.tenantId, workflowId: workflow.workflow_id, source: trigger.source, entityId: occurrence.entityId, expectedSchemaRef, actualSchemaRef: schemaRef });
        continue;
      }
      // occursOn + offsetDays ("30 days before" is -30): the same rule the Run dialog uses for test payloads.
      const fireDate = computeDateTriggerFireDate(occurrence.occursOn, offsetDays);
      if (!fireDate) continue;
      // Window sources only fire inside the lookback window. Condition sources are "true as of today":
      // there is no window, and an unfired backlog is picked up on the next scan.
      if (!isCondition) {
        const missedDays = Temporal.PlainDate.from(fireDate).until(Temporal.PlainDate.from(workflowToday), { largestUnit: 'day' }).days;
        if (missedDays < 0 || missedDays > LOOKBACK_DAYS) continue;
      }
      const triggerFireKey = fireKeyFor(occurrence);
      if (alreadyLaunched.has(triggerFireKey)) continue;
      const payload = { ...occurrence.payload, occursOn: occurrence.occursOn, fireDate, offsetDays };
      const validation = schemaRegistry.get(schemaRef).safeParse(payload);
      if (!validation.success) {
        logger.warn('Skipping date occurrence with invalid payload', { tenantId: params.tenantId, workflowId: workflow.workflow_id, source: trigger.source, entityId: occurrence.entityId, issues: validation.error?.issues });
        continue;
      }
      if (launched >= MAX_LAUNCHES_PER_TICK) { remaining += 1; continue; }
      try {
        const result = await launchPublishedWorkflowRun(params.knex, {
        workflowId: workflow.workflow_id,
        tenantId: params.tenantId,
        payload,
        triggerType: 'date',
        triggerFireKey,
        triggerMetadata: { source: trigger.source, occursOn: occurrence.occursOn, offsetDays, entityId: occurrence.entityId },
        sourcePayloadSchemaRef: schemaRef,
        });
        if (result.created) launched += 1;
      } catch (error) {
        logger.error('Failed to launch date-triggered workflow occurrence', { tenantId: params.tenantId, workflowId: workflow.workflow_id, source: trigger.source, entityId: occurrence.entityId, error });
      }
    }
  }
  if (remaining > 0) logger.info('Date-trigger scan reached the per-tenant launch cap', { tenantId: params.tenantId, launched, remaining });
}
