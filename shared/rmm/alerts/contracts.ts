import { z } from 'zod';
import type { Knex } from 'knex';
import type { RmmProvider } from '@alga-psa/types';

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
  deviceName?: string | null;
  externalOrganizationId?: string | null;
  /** ISO timestamp of the provider-side occurrence. */
  occurredAt: string;
  /** Raw provider payload, persisted to rmm_alerts.metadata. */
  raw: Record<string, unknown>;
}

/** Optional per-provider outbound surface. Providers without one are skipped. */
export interface RmmAlertOutboundAdapter {
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
      });
    }
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value.timezone });
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown timezone: ${value.timezone}` });
    }
  });

export type RmmMaintenanceWindowRecurrence = z.infer<typeof rmmMaintenanceWindowRecurrenceSchema>;

export const rmmAlertRuleConditionsSchema = z
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
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'messagePattern is not a valid regular expression' });
        }
      }),
    /** Case-insensitive substrings matched against the alert message. */
    keywords: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type RmmAlertRuleConditions = z.infer<typeof rmmAlertRuleConditionsSchema>;

export const rmmAlertRuleActionsSchema = z
  .object({
    createTicket: z.boolean().default(true),
    boardId: z.string().uuid().optional(),
    /** priority_id override; severity mapping applies when absent. */
    priorityOverride: z.string().uuid().optional(),
    assignToUserId: z.string().uuid().optional(),
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
    autoResolveStatusId: z.string().uuid().optional(),
    /** Reset the alert in the RMM when the linked ticket is closed. */
    resetAlertOnTicketClose: z.boolean().default(true),
    notifyUserIds: z.array(z.string().uuid()).optional(),
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
  publishWorkflowEvent?: (args: {
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
