import type { dateTriggerPayloadSchemaRefs } from './schemas/dateTriggerPayloadSchemas';

/**
 * When a date trigger fires, and what its payload says about the date. One definition shared by the
 * scheduler (ee/packages/workflows dateTriggerLauncher) and the Run dialog, so a test payload is
 * built exactly like a real one.
 *
 * Sign convention: `offsetDays` is added to the occurrence date. A trigger set to "30 days before"
 * stores offsetDays = -30 and fires on occursOn - 30 days; "after" is positive; "on the day" is 0.
 */

export type WorkflowDateTriggerSourceId = keyof typeof dateTriggerPayloadSchemaRefs;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** YYYY-MM-DD from a date-only or timestamp value, or null. */
export const toIsoDateOnly = (value: unknown): string | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  if (typeof value !== 'string') return null;
  const match = ISO_DATE.exec(value.trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
};

const parseIsoDate = (date: string): { year: number; month: number; day: number } | null => {
  const match = ISO_DATE.exec(date);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
};

const formatUtcDate = (time: number): string => new Date(time).toISOString().slice(0, 10);

/** Calendar-day arithmetic on YYYY-MM-DD (UTC, so daylight saving never moves a day). */
export const addDaysToIsoDate = (date: string, days: number): string | null => {
  const parts = parseIsoDate(date);
  if (!parts || !Number.isFinite(days)) return null;
  return formatUtcDate(Date.UTC(parts.year, parts.month - 1, parts.day + Math.trunc(days)));
};

/** The day a date trigger fires for an occurrence: the occurrence date plus the trigger's offset. */
export const computeDateTriggerFireDate = (occursOn: string, offsetDays: number): string | null =>
  addDaysToIsoDate(occursOn, offsetDays);

const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * The first yearly anniversary of `anchor` on or after `onOrAfter`. The first-year date itself is
 * not an anniversary, and Feb 29 falls on Feb 28 in other years (the scheduler's rule; see
 * packages/jobs/src/lib/dateTriggers/annual.ts).
 */
export const nextAnnualOccurrenceOnOrAfter = (
  anchor: string,
  onOrAfter: string
): { occursOn: string; years: number } | null => {
  const start = parseIsoDate(anchor);
  const from = parseIsoDate(onOrAfter);
  if (!start || !from) return null;
  for (let year = Math.max(from.year, start.year + 1); year <= from.year + 1; year += 1) {
    const day = Math.min(start.day, daysInMonth(year, start.month));
    const occursOn = formatUtcDate(Date.UTC(year, start.month - 1, day));
    if (occursOn >= onOrAfter) return { occursOn, years: year - start.year };
  }
  return null;
};

type RecordFields = Record<string, unknown>;

export type DateTriggerOccurrence = {
  /** The date the trigger is about (the contract's end date, the anniversary…). */
  occursOn: string;
  /** Payload fields that come with that date for this source. */
  payload: Record<string, unknown>;
};

export type DateTriggerOccurrenceRule = {
  /** The kind of record a run of this source is about (the picker kind of its id field). */
  recordKind: 'client' | 'contract' | 'asset';
  /** Payload field holding the occurrence date itself, when the payload has one. */
  payloadDateField?: string;
  /** The occurrence for a record, as the scheduler would build it; null when the record has no such date. */
  fromRecord: (record: RecordFields, today: string) => DateTriggerOccurrence | null;
};

/**
 * Per date source: which record it is about and which of the record's dates it fires on. Mirrors the
 * scheduler's queries in packages/jobs/src/lib/dateTriggers/sources/*.
 */
export const DATE_TRIGGER_OCCURRENCE_RULES: Record<WorkflowDateTriggerSourceId, DateTriggerOccurrenceRule> = {
  'client.anniversary': {
    recordKind: 'client',
    fromRecord: (record, today) => {
      const sinceDate = toIsoDateOnly(record.client_since);
      const anchor = sinceDate ?? toIsoDateOnly(record.created_at);
      if (!anchor) return null;
      const next = nextAnnualOccurrenceOnOrAfter(anchor, today);
      if (!next) return null;
      return {
        occursOn: next.occursOn,
        payload: {
          anniversaryDate: next.occursOn,
          yearsAsClient: next.years,
          anniversarySource: sinceDate ? 'client_since' : 'created_at',
        },
      };
    },
  },
  'contract.renewal_decision': {
    recordKind: 'contract',
    fromRecord: (record) => {
      const occursOn = toIsoDateOnly(record.decision_due_date);
      if (!occursOn) return null;
      const endDate = toIsoDateOnly(record.end_date);
      return {
        occursOn,
        payload: {
          decisionDueDate: occursOn,
          ...(endDate ? { endDate } : {}),
          ...(typeof record.renewal_mode === 'string' ? { renewalMode: record.renewal_mode } : {}),
          ...(typeof record.renewal_cycle_key === 'string' ? { renewalCycleKey: record.renewal_cycle_key } : {}),
        },
      };
    },
  },
  'contract.end': {
    recordKind: 'contract',
    payloadDateField: 'endDate',
    fromRecord: (record) => {
      const occursOn = toIsoDateOnly(record.end_date);
      return occursOn ? { occursOn, payload: { endDate: occursOn } } : null;
    },
  },
  'asset.warranty_end': {
    recordKind: 'asset',
    payloadDateField: 'warrantyEndDate',
    fromRecord: (record) => {
      const occursOn = toIsoDateOnly(record.warranty_end_date);
      return occursOn ? { occursOn, payload: { warrantyEndDate: occursOn } } : null;
    },
  },
};

export const isWorkflowDateTriggerSource = (source: unknown): source is WorkflowDateTriggerSourceId =>
  typeof source === 'string' && Object.prototype.hasOwnProperty.call(DATE_TRIGGER_OCCURRENCE_RULES, source);

/**
 * The timing fields of a date-triggered payload, as the scheduler would send them:
 * - occursOn: from the picked record (`record`), else the payload's own date field (endDate…),
 *   else the payload's occursOn;
 * - offsetDays: the trigger's offset;
 * - fireDate: occursOn plus offsetDays.
 * Plus the source fields that come with the record's date (yearsAsClient, decisionDueDate…).
 */
export const deriveDateTriggerTiming = (params: {
  source: WorkflowDateTriggerSourceId;
  offsetDays: number;
  payload: Record<string, unknown>;
  record?: RecordFields | null;
  today: string;
}): Record<string, unknown> => {
  const rule = DATE_TRIGGER_OCCURRENCE_RULES[params.source];
  const occurrence = params.record ? rule.fromRecord(params.record, params.today) : null;
  const occursOn = occurrence?.occursOn
    ?? (rule.payloadDateField ? toIsoDateOnly(params.payload[rule.payloadDateField]) : null)
    ?? toIsoDateOnly(params.payload.occursOn);
  const fireDate = occursOn ? computeDateTriggerFireDate(occursOn, params.offsetDays) : null;
  return {
    ...(occurrence?.payload ?? {}),
    ...(occursOn ? { occursOn } : {}),
    ...(fireDate ? { fireDate } : {}),
    offsetDays: params.offsetDays,
  };
};
