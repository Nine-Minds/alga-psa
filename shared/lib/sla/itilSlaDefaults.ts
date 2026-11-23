/**
 * The ITIL Standard SLA policy's defaults: one definition, two writers.
 *
 * `packages/sla/services/itilSlaService` creates the policy when an ITIL board is created, and
 * `ee/temporal-workflows`'s `ensureSlaParity` creates it during a product upgrade. The two used to
 * carry their own copies of the same numbers, which is how a tenant could end up with one set of
 * targets from a board create and another from an upgrade (F127 of
 * `ee/plans/2026-11-21-itil-remediation`).
 *
 * The policy itself is identified by `sla_policies.is_itil_standard`, never by this name: a tenant
 * may rename it, and a tenant's own policy may happen to be called the same thing.
 */

export const ITIL_SLA_POLICY_NAME = 'ITIL Standard';

export const ITIL_SLA_POLICY_DESCRIPTION =
  'Industry-standard SLA targets for ITIL priority levels. Auto-created when using ITIL priority mode.';

export interface ItilSlaTarget {
  /** Minutes from the SLA start until a first response is due. */
  responseTimeMinutes: number;
  /** Minutes from the SLA start until resolution is due. */
  resolutionTimeMinutes: number;
  /** A level-1 incident runs against the clock around the clock. */
  is24x7: boolean;
}

/** Keyed by `priorities.itil_priority_level` (1 = critical … 5 = planning). */
export const ITIL_SLA_TARGETS: Readonly<Record<number, ItilSlaTarget>> = {
  1: { responseTimeMinutes: 15, resolutionTimeMinutes: 60, is24x7: true },
  2: { responseTimeMinutes: 30, resolutionTimeMinutes: 240, is24x7: false },
  3: { responseTimeMinutes: 60, resolutionTimeMinutes: 1440, is24x7: false },
  4: { responseTimeMinutes: 240, resolutionTimeMinutes: 4320, is24x7: false },
  5: { responseTimeMinutes: 480, resolutionTimeMinutes: 10080, is24x7: false },
};

/** The escalation points every ITIL target is created with, as percentages of the target time. */
export const ITIL_SLA_ESCALATION_PERCENTS = {
  escalation_1_percent: 70,
  escalation_2_percent: 90,
  escalation_3_percent: 110,
} as const;

export interface ItilSlaNotificationThreshold {
  threshold_percent: number;
  notification_type: 'warning' | 'breach';
  notify_assignee: boolean;
  notify_board_manager: boolean;
  notify_escalation_manager: boolean;
  channels: readonly string[];
}

export const ITIL_SLA_NOTIFICATION_THRESHOLDS: readonly ItilSlaNotificationThreshold[] = [
  {
    threshold_percent: 50,
    notification_type: 'warning',
    notify_assignee: true,
    notify_board_manager: false,
    notify_escalation_manager: false,
    channels: ['in_app'],
  },
  {
    threshold_percent: 75,
    notification_type: 'warning',
    notify_assignee: true,
    notify_board_manager: true,
    notify_escalation_manager: false,
    channels: ['in_app'],
  },
  {
    threshold_percent: 90,
    notification_type: 'warning',
    notify_assignee: true,
    notify_board_manager: true,
    notify_escalation_manager: true,
    channels: ['in_app', 'email'],
  },
  {
    threshold_percent: 100,
    notification_type: 'breach',
    notify_assignee: true,
    notify_board_manager: true,
    notify_escalation_manager: true,
    channels: ['in_app', 'email'],
  },
];
