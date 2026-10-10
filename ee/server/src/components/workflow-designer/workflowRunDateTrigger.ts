import type { TFunction } from 'i18next';

import {
  DATE_TRIGGER_OCCURRENCE_RULES,
  deriveDateTriggerTiming,
  isWorkflowDateTriggerSource,
  type WorkflowDateTriggerSourceId,
} from '@alga-psa/workflows/authoring';

/**
 * Test payloads for date-triggered workflows. The scheduler fills occursOn, offsetDays and fireDate
 * itself; the Run dialog derives them the same way (shared dateTriggerOccurrence rules) from the
 * workflow's trigger and the record picked in the form, so nobody has to work them out by hand.
 */

export type RunDialogDateTrigger = { source: WorkflowDateTriggerSourceId; offsetDays: number; params?: Record<string, unknown> };

/** The date trigger of a workflow definition's trigger, or null for any other trigger. */
export const toRunDialogDateTrigger = (trigger: unknown): RunDialogDateTrigger | null => {
  if (!trigger || typeof trigger !== 'object') return null;
  const candidate = trigger as { type?: unknown; source?: unknown; offsetDays?: unknown; params?: unknown };
  if (candidate.type !== 'date' || !isWorkflowDateTriggerSource(candidate.source)) return null;
  const offsetDays = typeof candidate.offsetDays === 'number' && Number.isInteger(candidate.offsetDays) ? candidate.offsetDays : 0;
  const params = candidate.params && typeof candidate.params === 'object' && !Array.isArray(candidate.params)
    ? candidate.params as Record<string, unknown>
    : undefined;
  return params ? { source: candidate.source, offsetDays, params } : { source: candidate.source, offsetDays };
};

/** Today's calendar date where the dialog runs (YYYY-MM-DD). */
export const localTodayIsoDate = (now: Date = new Date()): string => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

export const DATE_TRIGGER_TIMING_FIELDS = ['occursOn', 'offsetDays', 'fireDate'] as const;

const isRecordObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Writes the derived timing (and the source fields that come with the record's date) into a payload.
 * Only fields the person hasn't typed themselves are written (`canOverwrite`). An offset the person
 * changed is respected when working out the fire date.
 */
export const applyDateTriggerTiming = (
  payload: unknown,
  params: {
    trigger: RunDialogDateTrigger;
    record?: Record<string, unknown> | null;
    today: string;
    canOverwrite: (key: string) => boolean;
  }
): Record<string, unknown> => {
  const current = isRecordObject(payload) ? payload : {};
  const offsetDays = !params.canOverwrite('offsetDays') && typeof current.offsetDays === 'number'
    ? current.offsetDays
    : params.trigger.offsetDays;
  const derived = deriveDateTriggerTiming({
    source: params.trigger.source,
    offsetDays,
    params: params.trigger.params,
    payload: current,
    record: params.record,
    today: params.today,
  });
  let next = current;
  for (const [key, value] of Object.entries(derived)) {
    if (value === undefined || Object.is(current[key], value)) continue;
    const isEmpty = current[key] === undefined || current[key] === null || current[key] === '';
    if (!isEmpty && !params.canOverwrite(key)) continue;
    next = next === current ? { ...current } : next;
    next[key] = value;
  }
  return next;
};

/** The record kind whose pick sets the date for this trigger (contract, client, asset). */
export const getDateTriggerRecordKind = (trigger: RunDialogDateTrigger): string =>
  DATE_TRIGGER_OCCURRENCE_RULES[trigger.source].recordKind;

const SOURCE_DATE_NAMES: Record<WorkflowDateTriggerSourceId, { key: string; defaultValue: string }> = {
  'client.anniversary': { key: 'runDialog.dateTrigger.dateNames.anniversary', defaultValue: "the client's next anniversary" },
  'contract.renewal_decision': { key: 'runDialog.dateTrigger.dateNames.renewal', defaultValue: "the contract's renewal decision date" },
  'contract.end': { key: 'runDialog.dateTrigger.dateNames.contractEnd', defaultValue: "the contract's end date" },
  'asset.warranty_end': { key: 'runDialog.dateTrigger.dateNames.warrantyEnd', defaultValue: "the asset's warranty end date" },
  'ticket.status_age': { key: 'runDialog.dateTrigger.dateNames.ticketStatusAge', defaultValue: 'the day the ticket reaches the number of days in status' },
};

/** Plain-language help for the timing fields of a date-triggered payload; null for other fields. */
export const describeDateTriggerPayloadField = (
  t: TFunction,
  key: string,
  trigger: RunDialogDateTrigger
): string | null => {
  const dateName = t(SOURCE_DATE_NAMES[trigger.source].key, { defaultValue: SOURCE_DATE_NAMES[trigger.source].defaultValue });
  switch (key) {
    case 'occursOn':
      return t('runDialog.dateTrigger.help.occursOn', {
        defaultValue: 'The date this run is about: {{dateName}}. Filled in from the record you pick.',
        dateName,
      });
    case 'offsetDays': {
      const days = Math.abs(trigger.offsetDays);
      const timing = trigger.offsetDays < 0
        ? t('runDialog.dateTrigger.timing.before', { defaultValue: '{{days}} days before', days })
        : trigger.offsetDays > 0
          ? t('runDialog.dateTrigger.timing.after', { defaultValue: '{{days}} days after', days })
          : t('runDialog.dateTrigger.timing.onTheDay', { defaultValue: 'on the day' });
      return t('runDialog.dateTrigger.help.offsetDays', {
        defaultValue: 'Days between that date and the run, from the trigger ({{timing}}). Negative means before, positive after.',
        timing,
      });
    }
    case 'fireDate':
      return t('runDialog.dateTrigger.help.fireDate', {
        defaultValue: 'The day the scheduler would start this run: the date above plus the offset.',
      });
    default:
      return null;
  }
};
