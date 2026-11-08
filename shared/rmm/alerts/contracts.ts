import { z } from 'zod';
import type { Knex } from 'knex';
import type { RmmProvider } from '@alga-psa/types';
import { predicateClauseSchema, predicateGroupSchema, validatePredicate } from '@alga-psa/predicates';
import type { PredicateGroup } from '@alga-psa/predicates';
import type { QuerySchema } from '@alga-psa/predicates';

/** Severity scale every provider normalizes into (matches rmm_alerts.severity). */
export type NormalizedRmmAlertSeverity = 'critical' | 'major' | 'moderate' | 'minor' | 'none';

export const NORMALIZED_RMM_ALERT_SEVERITIES = ['critical', 'major', 'moderate', 'minor', 'none'] as const;

export type NormalizedRmmAlertEventKind = 'triggered' | 'reset' | 'acknowledged';

/**
 * Provider-agnostic alert event. Webhook routes and the reconciliation poller
 * map provider payloads into this shape and hand it to processRmmAlertEvent().
 */
export interface NormalizedRmmAlertEvent {
  tenantId: string;
  integrationId: string;
  provider: RmmProvider;
  kind: NormalizedRmmAlertEventKind;
  externalAlertId: string;
  externalDeviceId?: string | null;
  /**
   * Stable identity of the firing condition on a device, used for dedup
   * (e.g. NinjaOne statusCode falling back to activityType). When absent the
   * pipeline falls back to alertClass/activityType/sourceType.
   */
  conditionIdentity?: string | null;
  activityType?: string | null;
  alertClass?: string | null;
  sourceType?: string | null;
  severity: NormalizedRmmAlertSeverity;
  message?: string | null;
  /** Provider's long-form alert body, kept verbatim for matching and audit. */
  details?: string | null;
  deviceName?: string | null;
  externalOrganizationId?: string | null;
  /** ISO timestamp of the provider-side occurrence. */
  occurredAt: string;
  /** Raw provider payload, persisted to rmm_alerts.metadata. */
  raw: Record<string, unknown>;
}

/** Optional per-provider outbound surface. Providers without one are skipped. */
export interface RmmAlertOutboundAdapter {
  /**
   * Optional opt-out checked before resetAlert. Returning false skips the
   * alert entirely, no remote call and no local resolve, exactly as for a
   * provider with no adapter. That keeps local state truthful (the alert stays
   * active because it is still firing remotely) rather than resolving it
   * locally only. It does not stop re-ticketing: processRmmAlertEvent's
   * linkedTicketGone path reopens a still-firing alert whose ticket closed.
   */
  isResetEnabled?(args: { tenantId: string; integrationId: string }): Promise<boolean>;
  resetAlert(args: {
    tenantId: string;
    integrationId: string;
    externalAlertId: string;
  }): Promise<void>;
}

const timeOfDayPattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export const rmmMaintenanceWindowRecurrenceSchema = z
  .object({
    type: z.literal('weekly'),
    /** Days of week, 0 = Sunday … 6 = Saturday. */
    days: z.array(z.number().int().min(0).max(6)).min(1),
    startTime: z.string().regex(timeOfDayPattern, 'startTime must be HH:mm'),
    endTime: z.string().regex(timeOfDayPattern, 'endTime must be HH:mm'),
    timezone: z.string().min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.startTime === value.endTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'startTime and endTime must differ (a window spanning a full day should use multiple days instead)',
        params: {
          messageKey: 'msp/integrations:errors.rmm.validation.timesMustDiffer',
        },
      });
    }
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value.timezone });
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown timezone: ${value.timezone}`,
        params: {
          messageKey: 'msp/integrations:errors.rmm.validation.unknownTimezone',
          messageParams: { timezone: value.timezone },
        },
      });
    }
  });

export type RmmMaintenanceWindowRecurrence = z.infer<typeof rmmMaintenanceWindowRecurrenceSchema>;

const legacyRmmAlertConditionsSchema = z
  .object({
    severities: z.array(z.enum(NORMALIZED_RMM_ALERT_SEVERITIES)).optional(),
    activityTypes: z.array(z.string().min(1)).optional(),
    alertClasses: z.array(z.string().min(1)).optional(),
    sourceTypes: z.array(z.string().min(1)).optional(),
    /** External organization IDs (provider-side). */
    organizationIds: z.array(z.string().min(1)).optional(),
    /** Regex tested against the alert message. Validated at save time. */
    messagePattern: z
      .string()
      .min(1)
      .optional()
      .superRefine((pattern, ctx) => {
        if (pattern === undefined) return;
        try {
          new RegExp(pattern);
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'messagePattern is not a valid regular expression',
            params: {
              messageKey: 'msp/integrations:errors.rmm.validation.messagePatternInvalid',
            },
          });
        }
      }),
    /** Case-insensitive substrings matched against the alert message. */
    keywords: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const rmmAlertQuerySchema: QuerySchema = {
  table: 'rmm_alerts',
  attributes: {
    severity: { kind: 'column', column: 'severity', type: 'string', operators: ['in', 'not_in', 'equals', 'not_equals'] },
    alertClass: { kind: 'column', column: 'alert_class', type: 'string', operators: ['in', 'not_in', 'contains_ci', 'not_contains_ci', 'equals', 'not_equals'] },
    activityType: { kind: 'column', column: 'activity_type', type: 'string', operators: ['in', 'not_in', 'contains_ci', 'not_contains_ci', 'equals', 'not_equals'] },
    sourceType: { kind: 'column', column: 'source_type', type: 'string', operators: ['in', 'not_in', 'contains_ci', 'not_contains_ci', 'equals', 'not_equals'] },
    organizationId: { kind: 'column', column: 'external_organization_id', type: 'string', operators: ['in', 'not_in', 'equals', 'not_equals'] },
    message: { kind: 'column', column: 'message', type: 'string', operators: ['contains_ci', 'not_contains_ci'] },
    details: { kind: 'column', column: 'details', type: 'string', operators: ['contains_ci', 'not_contains_ci'] },
    text: { kind: 'column', column: 'message', type: 'string', operators: ['contains_ci', 'not_contains_ci'] },
    deviceName: { kind: 'column', column: 'device_name', type: 'string', operators: ['contains_ci', 'not_contains_ci', 'equals', 'not_equals'] },
    externalDeviceId: { kind: 'column', column: 'external_device_id', type: 'string', operators: ['in', 'not_in', 'equals', 'not_equals'] },
  },
};

export type RmmAlertRuleConditions = PredicateGroup & { legacyMessagePattern?: string };

// Keep structural validation ahead of schema-aware validation: the latter assumes
// a well-formed tree and must never receive arbitrary action input.
const storedRmmAlertConditionsSchema = z.object({
  join: z.enum(['and', 'or']),
  clauses: z.array(z.union([predicateClauseSchema, predicateGroupSchema])),
  legacyMessagePattern: z.string().min(1).superRefine((pattern, ctx) => {
    if (!isValidRegex(pattern)) addInvalidRegexIssue(ctx);
  }).optional(),
}).strict();

export const rmmAlertRuleConditionsSchema = z.preprocess((value, ctx) => {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return value; }
  }
  const parsed = storedRmmAlertConditionsSchema.safeParse(value);
  if (parsed.success) return parsed.data;

  const legacy = legacyRmmAlertConditionsSchema.safeParse(value);
  if (legacy.success) return normalizeRmmAlertConditions(value);

  // Preserve the existing localized save error for legacy regex conditions.
  const pattern = (value as { messagePattern?: unknown } | null)?.messagePattern;
  if (typeof pattern === 'string' && !isValidRegex(pattern)) {
    addInvalidRegexIssue(ctx);
    return z.NEVER;
  }
  return value;
}, storedRmmAlertConditionsSchema).superRefine((group, ctx) => {
  for (const issue of validatePredicate(rmmAlertQuerySchema, group)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.path], message: issue.message });
  }
});

function isValidRegex(pattern: string): boolean { try { new RegExp(pattern); return true; } catch { return false; } }
function addInvalidRegexIssue(ctx: z.RefinementCtx) {
  ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'messagePattern is not a valid regular expression', params: { messageKey: 'msp/integrations:errors.rmm.validation.messagePatternInvalid' } });
}

function containsLegacyRegexPath(group: PredicateGroup): boolean {
  return group.clauses.some(clause => 'clauses' in clause ? containsLegacyRegexPath(clause) : clause.path === '__legacyMessagePattern');
}

/**
 * Convert pre-predicate rows at the read boundary; old rows remain editable.
 * Legacy messagePattern remains a root-only sidecar ANDed with the migrated
 * predicate group. It is never represented as a predicate clause.
 */
export function normalizeRmmAlertConditions(value: unknown): RmmAlertRuleConditions {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { throw new Error('Invalid stored RMM alert conditions: JSON could not be parsed'); }
  }
  const predicate = storedRmmAlertConditionsSchema.safeParse(value);
  if (predicate.success) {
    if (containsLegacyRegexPath(predicate.data)) throw new Error('Invalid stored RMM alert conditions: reserved legacy regex field');
    return predicate.data;
  }
  const legacy = legacyRmmAlertConditionsSchema.safeParse(value ?? {});
  if (!legacy.success) throw new Error(`Invalid stored RMM alert conditions (predicate: ${predicate.error.message}; legacy: ${legacy.error.message})`);
  const old = legacy.data;
  const clauses: PredicateGroup['clauses'] = [];
  const lists: Array<[keyof typeof old, string]> = [
    ['severities', 'severity'], ['activityTypes', 'activityType'], ['alertClasses', 'alertClass'],
    ['sourceTypes', 'sourceType'], ['organizationIds', 'organizationId'],
  ];
  for (const [key, path] of lists) {
    const values = old[key];
    if (Array.isArray(values) && values.length) clauses.push({ path, operator: 'in', value: values });
  }
  if (old.keywords?.length) clauses.push({ join: 'or', clauses: old.keywords.map(value => ({ path: 'text', operator: 'contains_ci' as const, value })) });
  // Persisted as a separate root sidecar so it survives reload without becoming an authorable predicate field.
  return { join: 'and', clauses, ...(old.messagePattern ? { legacyMessagePattern: old.messagePattern } : {}) };
}

export const rmmAlertRuleActionsSchema = z
  .object({
    createTicket: z.boolean().default(true),
    boardId: z.string().guid().optional(),
    /** priority_id override; severity mapping applies when absent. */
    priorityOverride: z.string().guid().optional(),
    assignToUserId: z.string().guid().optional(),
    ticketTemplate: z
      .object({
        titleTemplate: z.string().min(1).optional(),
        descriptionTemplate: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    /** Close the linked ticket (if untouched) when the alert resets. */
    autoResolveTicket: z.boolean().default(false),
    /** Status to close into; tenant's first is_closed status when absent. */
    autoResolveStatusId: z.string().guid().optional(),
    /** Reset the alert in the RMM when the linked ticket is closed. */
    resetAlertOnTicketClose: z.boolean().default(true),
    notifyUserIds: z.array(z.string().guid()).optional(),
  })
  .strict();

export type RmmAlertRuleActions = z.infer<typeof rmmAlertRuleActionsSchema>;

/** rmm_alert_rules row as read from the DB (conditions/actions already JSON). */
export interface RmmAlertRuleRow {
  tenant: string;
  rule_id: string;
  integration_id: string;
  name: string;
  description?: string | null;
  is_active: boolean;
  priority_order: number;
  conditions: RmmAlertRuleConditions;
  actions: RmmAlertRuleActions;
}

/** rmm_maintenance_windows row as read from the DB. */
export interface RmmMaintenanceWindowRow {
  tenant: string;
  window_id: string;
  integration_id?: string | null;
  client_id?: string | null;
  asset_id?: string | null;
  name: string;
  is_active: boolean;
  starts_at?: string | Date | null;
  ends_at?: string | Date | null;
  recurrence?: RmmMaintenanceWindowRecurrence | null;
}

export type RmmAlertProcessingOutcome =
  | 'suppressed'
  | 'ticket_created'
  | 'occurrence_appended'
  | 'recorded_only'
  | 'resolved'
  | 'acknowledged'
  /** Delivery is temporarily blocked; leave its durable transition pending. */
  | 'deferred'
  | 'skipped';

export interface RmmAlertProcessingResult {
  outcome: RmmAlertProcessingOutcome;
  alertId?: string;
  ticketId?: string | null;
  matchedRuleId?: string | null;
  suppressedByWindowId?: string | null;
  /** Non-fatal issues (e.g. a rule skipped over a bad stored regex). */
  warnings: string[];
}

/**
 * Side effects the pipeline triggers after commit. Injected by callers so
 * shared/ stays free of dependencies on the event-bus and notification
 * packages; see buildRmmAlertPipelineDeps() in @alga-psa/integrations.
 */
export interface RmmAlertPipelineDeps {
  publishRmmAlertEvent?: (args: {
    eventType: 'RMM_ALERT_TRIGGERED' | 'RMM_ALERT_RESOLVED';
    tenantId: string;
    payload: Record<string, unknown>;
  }) => Promise<void>;
  notifyUsers?: (args: {
    tenantId: string;
    userIds: string[];
    alert: { alertId: string; message?: string | null; severity: string; assetId?: string | null; ticketId?: string | null };
  }) => Promise<void>;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export interface RmmAlertProcessingContext {
  knex: Knex;
  deps?: RmmAlertPipelineDeps;
}
