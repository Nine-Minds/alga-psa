import { z } from 'zod';
import { getDateTriggerSourceDefinition } from './dateTriggerSourceDefinitions';

/**
 * Parameters of a date trigger (`trigger.params`), validated per source.
 *
 * `ticket.status_age`: "ticket has been in status `statusName` (optionally on board `boardId`) for
 * `days` days (optionally with no activity), optionally repeating every `repeatEveryDays` days while
 * it stays there". Statuses are per board, so the status is matched by name (case-insensitively)
 * against the ticket's current status; renaming a status therefore breaks the trigger.
 */
export const ticketStatusAgeParamsSchema = z.object({
  statusName: z.string().trim().min(1, 'statusName is required'),
  boardId: z.string().uuid('boardId must be a board id').nullish(),
  days: z.number().int().min(1).max(365),
  repeatEveryDays: z.number().int().min(1).max(365).nullish(),
  requireNoActivity: z.boolean().optional(),
}).strict();

export type TicketStatusAgeParams = z.infer<typeof ticketStatusAgeParamsSchema>;

/** Params with defaults filled in and the status name normalised, so equal triggers hash equally. */
export type NormalizedTicketStatusAgeParams = {
  statusName: string;
  boardId: string | null;
  days: number;
  repeatEveryDays: number | null;
  requireNoActivity: boolean;
};

export const normalizeTicketStatusAgeParams = (params: TicketStatusAgeParams): NormalizedTicketStatusAgeParams => ({
  statusName: params.statusName.trim().toLowerCase(),
  boardId: params.boardId ?? null,
  days: params.days,
  repeatEveryDays: params.repeatEveryDays ?? null,
  requireNoActivity: params.requireNoActivity ?? false,
});

const PARAM_SCHEMAS: Record<string, z.ZodTypeAny> = {
  'ticket.status_age': ticketStatusAgeParamsSchema,
};

/** Per-source normal form: what the source query sees and what the fire key hashes. */
const PARAM_NORMALIZERS: Record<string, (params: never) => Record<string, unknown>> = {
  'ticket.status_age': normalizeTicketStatusAgeParams as (params: never) => Record<string, unknown>,
};

// A flat shape (not a discriminated union) so it narrows the same under strict and non-strict tsconfigs.
export type DateTriggerParamsValidation = { ok: boolean; params?: Record<string, unknown>; issues: string[] };

/**
 * Validates `params` for a date source and returns them in normal form (e.g. status name lower-cased,
 * defaults filled in): required and checked for sources that take params, and
 * rejected when a source that takes none is given some.
 */
export function validateDateTriggerParams(source: string, params: unknown): DateTriggerParamsValidation {
  const definition = getDateTriggerSourceDefinition(source);
  if (!definition?.hasParams) {
    if (params === undefined || params === null) return { ok: true, params: undefined, issues: [] };
    return { ok: false, issues: [`params: source "${source}" does not take params`] };
  }
  const schema = PARAM_SCHEMAS[source];
  if (!schema) return { ok: false, issues: [`params: no parameter schema is registered for source "${source}"`] };
  if (params === undefined || params === null) return { ok: false, issues: ['params: required for this source'] };
  const parsed = schema.safeParse(params);
  if (parsed.success) return { ok: true, issues: [], params: (PARAM_NORMALIZERS[source]?.(parsed.data as never) ?? parsed.data) as Record<string, unknown> };
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => `params${issue.path.length ? `.${issue.path.join('.')}` : ''}: ${issue.message}`),
  };
}

/**
 * Canonical JSON for a params object: keys sorted at every level, so the same params serialise
 * identically whatever order they were written in. The scheduler hashes this into the fire key.
 */
export function canonicalizeDateTriggerParams(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalizeDateTriggerParams).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalizeDateTriggerParams(record[key])}`).join(',')}}`;
}
