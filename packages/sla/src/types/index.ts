/**
 * @alga-psa/sla - Types
 *
 * SLA-related type definitions for Alga PSA.
 */

import type { TenantScopedEntity, ISODateString } from '@alga-psa/types';

// ============================================================================
// SLA Policy Interfaces
// ============================================================================

/**
 * SLA Policy defines the service level agreements for tickets.
 * A policy contains multiple targets (one per priority level) and can be
 * linked to specific business hours schedules.
 */
export interface ISlaPolicy {
  tenant?: string;
  /** Unique identifier for the SLA policy */
  sla_policy_id: string;
  /** Human-readable name of the policy */
  policy_name: string;
  /** Optional description of the policy */
  description?: string | null;
  /** Whether this is the default policy for the tenant */
  is_default: boolean;
  /** Optional reference to business hours schedule */
  business_hours_schedule_id?: string | null;
  /** When the policy was created */
  created_at?: ISODateString;
  /** When the policy was last updated */
  updated_at?: ISODateString;
}

/**
 * SLA Policy Target defines response and resolution time targets
 * for a specific priority level within an SLA policy.
 */
export interface ISlaPolicyTarget {
  tenant?: string;
  /** Unique identifier for the target */
  target_id: string;
  /** Reference to the parent SLA policy */
  sla_policy_id: string;
  /** Reference to the priority this target applies to */
  priority_id: string;
  /** Maximum response time in minutes (null = no target) */
  response_time_minutes?: number | null;
  /** Maximum resolution time in minutes (null = no target) */
  resolution_time_minutes?: number | null;
  /** Percentage of time elapsed before first escalation (0-100) */
  escalation_1_percent: number;
  /** Percentage of time elapsed before second escalation (0-100) */
  escalation_2_percent: number;
  /** Percentage of time elapsed before third escalation (0-100) */
  escalation_3_percent: number;
  /** Whether this target uses 24x7 hours instead of business hours */
  is_24x7: boolean;
  /** When the target was created */
  created_at?: ISODateString;
  /** When the target was last updated */
  updated_at?: ISODateString;
}

// ============================================================================
// SLA Settings Interfaces
// ============================================================================

/**
 * Global SLA settings for a tenant.
 * Controls tenant-wide SLA behavior.
 */
export interface ISlaSettings {
  tenant?: string;
  /** Whether to pause SLA timers when ticket is awaiting client response */
  pause_on_awaiting_client: boolean;
  /** When the settings were created */
  created_at?: ISODateString;
  /** When the settings were last updated */
  updated_at?: ISODateString;
}

/**
 * Configuration for whether a specific status pauses SLA timers.
 * Allows fine-grained control over which statuses pause SLA calculations.
 */
export interface IStatusSlaPauseConfig {
  tenant?: string;
  /** Unique identifier for the configuration */
  config_id: string;
  /** Reference to the ticket status */
  status_id: string;
  /** Whether this status pauses SLA timers */
  pauses_sla: boolean;
  /** When the configuration was created */
  created_at?: ISODateString;
}

// ============================================================================
// Business Hours Interfaces
// ============================================================================

/**
 * Business hours schedule defines when the support team is available.
 * Used for SLA time calculations.
 */
export interface IBusinessHoursSchedule {
  tenant?: string;
  /** Unique identifier for the schedule */
  schedule_id: string;
  /** Human-readable name of the schedule */
  schedule_name: string;
  /** IANA timezone identifier (e.g., 'America/New_York') */
  timezone: string;
  /** Whether this is the default schedule for the tenant */
  is_default: boolean;
  /** Whether this schedule represents 24x7 availability */
  is_24x7: boolean;
  /** When the schedule was created */
  created_at?: ISODateString;
  /** When the schedule was last updated */
  updated_at?: ISODateString;
}

/**
 * Business hours entry defines working hours for a specific day of the week.
 */
export interface IBusinessHoursEntry {
  tenant?: string;
  /** Unique identifier for the entry */
  entry_id: string;
  /** Reference to the parent schedule */
  schedule_id: string;
  /** Day of the week (0=Sunday, 1=Monday, ..., 6=Saturday) */
  day_of_week: number;
  /** Start time in HH:MM format (24-hour) */
  start_time: string;
  /** End time in HH:MM format (24-hour) */
  end_time: string;
  /** Whether this day is enabled for work */
  is_enabled: boolean;
}

/**
 * Holiday definition for excluding specific dates from business hours.
 */
export interface IHoliday {
  tenant?: string;
  /** Unique identifier for the holiday */
  holiday_id: string;
  /** Optional reference to a specific schedule (null = applies to all) */
  schedule_id?: string | null;
  /** Human-readable name of the holiday */
  holiday_name: string;
  /** Date of the holiday in YYYY-MM-DD format */
  holiday_date: string;
  /** Whether this holiday recurs annually */
  is_recurring: boolean;
  /** When the holiday was created */
  created_at?: ISODateString;
}

// ============================================================================
// SLA Notification Interfaces
// ============================================================================

/**
 * Notification types for SLA thresholds
 */
export type SlaNotificationType = 'warning' | 'breach';

/**
 * Notification channels available for SLA alerts
 */
export type SlaNotificationChannel = 'in_app' | 'email';

/**
 * SLA notification threshold defines when and who to notify
 * as an SLA approaches or reaches breach.
 */
export interface ISlaNotificationThreshold {
  tenant?: string;
  /** Unique identifier for the threshold */
  threshold_id: string;
  /** Reference to the parent SLA policy */
  sla_policy_id: string;
  /** Percentage of SLA time elapsed that triggers this notification (0-100) */
  threshold_percent: number;
  /** Type of notification (warning or breach) */
  notification_type: SlaNotificationType;
  /** Whether to notify the ticket assignee */
  notify_assignee: boolean;
  /** Whether to notify the board manager */
  notify_board_manager: boolean;
  /** Whether to notify the escalation manager */
  notify_escalation_manager: boolean;
  /** Channels to send notifications through */
  channels: SlaNotificationChannel[];
  /** When the threshold was created */
  created_at?: ISODateString;
}

// ============================================================================
// Extended Interfaces (for UI/API usage)
// ============================================================================

/**
 * SLA policy with its associated targets and notification thresholds.
 * Used when loading complete policy data for editing or display.
 */
export interface ISlaPolicyWithTargets extends ISlaPolicy {
  /** List of targets for each priority level */
  targets: ISlaPolicyTarget[];
  /** Optional list of notification thresholds */
  notification_thresholds?: ISlaNotificationThreshold[];
}

/**
 * Business hours schedule with its daily entries and holidays.
 * Used when loading complete schedule data for editing or display.
 */
export interface IBusinessHoursScheduleWithEntries extends IBusinessHoursSchedule {
  /** List of daily hour entries */
  entries: IBusinessHoursEntry[];
  /** Optional list of holidays */
  holidays?: IHoliday[];
}

// ============================================================================
// Form/Input Types
// ============================================================================

/**
 * Input type for creating or updating an SLA policy.
 * Excludes system-generated fields like IDs and timestamps.
 */
export interface ISlaPolicyInput {
  /** Human-readable name of the policy */
  policy_name: string;
  /** Optional description of the policy */
  description?: string;
  /** Whether this is the default policy for the tenant */
  is_default?: boolean;
  /** Optional reference to business hours schedule */
  business_hours_schedule_id?: string;
}

/**
 * Input type for creating or updating an SLA policy target.
 * Excludes system-generated fields like IDs and timestamps.
 */
export interface ISlaPolicyTargetInput {
  /** Reference to the priority this target applies to */
  priority_id: string;
  /** Maximum response time in minutes */
  response_time_minutes?: number;
  /** Maximum resolution time in minutes */
  resolution_time_minutes?: number;
  /** Percentage of time elapsed before first escalation */
  escalation_1_percent?: number;
  /** Percentage of time elapsed before second escalation */
  escalation_2_percent?: number;
  /** Percentage of time elapsed before third escalation */
  escalation_3_percent?: number;
  /** Whether this target uses 24x7 hours instead of business hours */
  is_24x7?: boolean;
}

/**
 * Input type for creating or updating a business hours schedule.
 */
export interface IBusinessHoursScheduleInput {
  /** Human-readable name of the schedule */
  schedule_name: string;
  /** IANA timezone identifier */
  timezone: string;
  /** Whether this is the default schedule for the tenant */
  is_default?: boolean;
  /** Whether this schedule represents 24x7 availability */
  is_24x7?: boolean;
}

/**
 * Input type for creating or updating a business hours entry.
 */
export interface IBusinessHoursEntryInput {
  /** Day of the week (0=Sunday, 1=Monday, ..., 6=Saturday) */
  day_of_week: number;
  /** Start time in HH:MM format (24-hour) */
  start_time: string;
  /** End time in HH:MM format (24-hour) */
  end_time: string;
  /** Whether this day is enabled for work */
  is_enabled: boolean;
}

/**
 * Input type for creating or updating a holiday.
 */
export interface IHolidayInput {
  /** Human-readable name of the holiday */
  holiday_name: string;
  /** Date of the holiday in YYYY-MM-DD format */
  holiday_date: string;
  /** Whether this holiday recurs annually */
  is_recurring?: boolean;
  /** Optional reference to a specific schedule */
  schedule_id?: string;
}

/**
 * Input type for creating or updating a notification threshold.
 */
export interface ISlaNotificationThresholdInput {
  /** Percentage of SLA time elapsed that triggers this notification */
  threshold_percent: number;
  /** Type of notification (warning or breach) */
  notification_type: SlaNotificationType;
  /** Whether to notify the ticket assignee */
  notify_assignee?: boolean;
  /** Whether to notify the board manager */
  notify_board_manager?: boolean;
  /** Whether to notify the escalation manager */
  notify_escalation_manager?: boolean;
  /** Channels to send notifications through */
  channels?: SlaNotificationChannel[];
}

// ============================================================================
// SLA Calculation Types (for Phase 3)
// ============================================================================

/**
 * Status of an SLA timer.
 * - 'on_track': SLA is within acceptable limits
 * - 'at_risk': SLA is approaching breach threshold
 * - 'response_breached': Response time SLA has been breached
 * - 'resolution_breached': Resolution time SLA has been breached
 * - 'paused': SLA timer is currently paused
 */
export type SlaTimerStatus = 'on_track' | 'at_risk' | 'response_breached' | 'resolution_breached' | 'paused';

/**
 * Reason why an SLA timer is paused.
 */
export type SlaPauseReason = 'awaiting_client' | 'status_pause';

/**
 * Current SLA status for a ticket.
 * Used for displaying SLA information in ticket views.
 */
export interface ISlaStatus {
  /** Overall status of the SLA timer */
  status: SlaTimerStatus;
  /** Minutes remaining until response SLA breach (negative if breached) */
  response_remaining_minutes?: number;
  /** Minutes remaining until resolution SLA breach (negative if breached) */
  resolution_remaining_minutes?: number;
  /** Whether the SLA timer is currently paused */
  is_paused: boolean;
  /** Reason for the pause (if paused) */
  pause_reason?: SlaPauseReason;
  /** Total minutes the SLA has been paused */
  total_pause_minutes: number;
}

/**
 * SLA tracking record for a ticket.
 * Stores the calculated SLA deadlines and current state.
 */
export interface ITicketSlaTracking {
  tenant?: string;
  /** Unique identifier for the tracking record */
  tracking_id: string;
  /** Reference to the ticket */
  ticket_id: string;
  /** Reference to the SLA policy applied */
  sla_policy_id: string;
  /** Calculated response deadline */
  response_deadline?: ISODateString | null;
  /** Calculated resolution deadline */
  resolution_deadline?: ISODateString | null;
  /** When the ticket first received a response */
  first_response_at?: ISODateString | null;
  /** When the ticket was resolved */
  resolved_at?: ISODateString | null;
  /** Whether response SLA was met */
  response_met?: boolean | null;
  /** Whether resolution SLA was met */
  resolution_met?: boolean | null;
  /** Total minutes the SLA was paused */
  total_pause_minutes: number;
  /** When tracking started */
  created_at?: ISODateString;
  /** When tracking was last updated */
  updated_at?: ISODateString;
}

/**
 * Record of SLA pause events for a ticket.
 * Used for auditing and calculating total pause time.
 */
export interface ISlaPauseHistory {
  tenant?: string;
  /** Unique identifier for the pause record */
  pause_id: string;
  /** Reference to the ticket */
  ticket_id: string;
  /** When the pause started */
  paused_at: ISODateString;
  /** When the pause ended (null if still paused) */
  resumed_at?: ISODateString | null;
  /** Reason for the pause */
  pause_reason: SlaPauseReason;
  /** Reference to status that caused pause (if applicable) */
  status_id?: string | null;
}

// ============================================================================
// Escalation Manager Interfaces (Phase 4)
// ============================================================================

/**
 * Escalation manager configuration for a board level.
 * When a ticket reaches this escalation level, the configured manager
 * is added as a resource and notified.
 */
export interface IEscalationManager {
  tenant?: string;
  /** Unique identifier for the configuration */
  config_id: string;
  /** Reference to the board this config applies to */
  board_id: string;
  /** Escalation level (1, 2, or 3) */
  escalation_level: 1 | 2 | 3;
  /** Reference to the manager user */
  manager_user_id: string | null;
  /** Notification channels for this manager */
  notify_via: SlaNotificationChannel[];
  /** When the configuration was created */
  created_at?: ISODateString;
  /** When the configuration was last updated */
  updated_at?: ISODateString;
}

/**
 * Input type for setting an escalation manager.
 */
export interface IEscalationManagerInput {
  /** Reference to the board */
  board_id: string;
  /** Escalation level (1, 2, or 3) */
  escalation_level: 1 | 2 | 3;
  /** Reference to the manager user (null to remove) */
  manager_user_id: string | null;
  /** Notification channels for this manager */
  notify_via?: SlaNotificationChannel[];
}

/**
 * Escalation manager with user details for display.
 */
export interface IEscalationManagerWithUser extends IEscalationManager {
  /** Manager's first name */
  manager_first_name?: string;
  /** Manager's last name */
  manager_last_name?: string;
  /** Manager's email */
  manager_email?: string;
}

/**
 * Board escalation configuration - all three levels for a board.
 */
export interface IBoardEscalationConfig {
  board_id: string;
  board_name: string;
  level_1?: IEscalationManagerWithUser | null;
  level_2?: IEscalationManagerWithUser | null;
  level_3?: IEscalationManagerWithUser | null;
}

// ============================================================================
// SLA Reporting Interfaces (Phase 5)
// ============================================================================

/**
 * Filters for SLA reporting queries.
 */
export interface ISlaReportingFilters {
  /** Start date for the reporting period */
  dateFrom?: string;
  /** End date for the reporting period */
  dateTo?: string;
  /** Filter by specific board */
  boardId?: string;
  /** Filter by specific client/company */
  clientId?: string;
  /** Filter by specific priority */
  priorityId?: string;
  /** Filter by specific technician/assignee */
  technicianId?: string;
  /** Filter by specific SLA policy */
  slaPolicyId?: string;
}

/**
 * SLA compliance rate metrics.
 */
export interface ISlaComplianceRate {
  /** Overall compliance rate (0-100) */
  overallRate: number;
  /** Response SLA compliance rate (0-100) */
  responseRate: number;
  /** Resolution SLA compliance rate (0-100) */
  resolutionRate: number;
  /** Total tickets with SLA tracking */
  totalTickets: number;
  /** Tickets that met response SLA */
  responseMetCount: number;
  /** Tickets that breached response SLA */
  responseBreachedCount: number;
  /** Tickets that met resolution SLA */
  resolutionMetCount: number;
  /** Tickets that breached resolution SLA */
  resolutionBreachedCount: number;
}

/**
 * Average time metrics for SLA reporting.
 */
export interface ISlaAverageTimeMetrics {
  /** Average response time in minutes */
  avgResponseMinutes: number;
  /** Average resolution time in minutes */
  avgResolutionMinutes: number;
  /** Average target response time in minutes */
  avgTargetResponseMinutes: number;
  /** Average target resolution time in minutes */
  avgTargetResolutionMinutes: number;
}

/**
 * Breach rate grouped by a dimension (priority, technician, client).
 */
export interface ISlaBreachRateByDimension {
  /** Dimension ID (priority_id, user_id, company_id) */
  dimensionId: string;
  /** Dimension name for display */
  dimensionName: string;
  /** Total tickets in this dimension */
  totalTickets: number;
  /** Number of breached tickets */
  breachedCount: number;
  /** Breach rate (0-100) */
  breachRate: number;
}

/**
 * SLA trend data point for a single day.
 */
export interface ISlaTrendDataPoint {
  /** Date in YYYY-MM-DD format */
  date: string;
  /** Compliance rate for this day (0-100) */
  complianceRate: number;
  /** Number of tickets closed this day */
  ticketCount: number;
  /** Number of breaches this day */
  breachCount: number;
}

/**
 * Recent breach record for display.
 */
export interface ISlaRecentBreach {
  /** Ticket ID */
  ticketId: string;
  /** Ticket number */
  ticketNumber: string;
  /** Ticket title */
  ticketTitle: string;
  /** Client/company name */
  companyName: string;
  /** Priority name */
  priorityName: string;
  /** Assignee name */
  assigneeName: string | null;
  /** Whether response SLA was breached */
  responseBreached: boolean;
  /** Whether resolution SLA was breached */
  resolutionBreached: boolean;
  /** When the breach occurred */
  breachedAt: string;
}

/**
 * Ticket at risk of SLA breach.
 */
export interface ISlaTicketAtRisk {
  /** Ticket ID */
  ticketId: string;
  /** Ticket number */
  ticketNumber: string;
  /** Ticket title */
  ticketTitle: string;
  /** Client/company name */
  companyName: string;
  /** Priority name */
  priorityName: string;
  /** Assignee name */
  assigneeName: string | null;
  /** Minutes remaining until breach (negative if already breached) */
  minutesRemaining: number;
  /** Percentage of SLA time elapsed */
  percentElapsed: number;
  /** Type of SLA at risk (response or resolution) */
  slaType: 'response' | 'resolution';
  /** Due date/time */
  dueAt: string;
}

/**
 * Combined SLA overview for dashboard.
 */
export interface ISlaOverview {
  /** Compliance metrics */
  compliance: ISlaComplianceRate;
  /** Average time metrics */
  averageTimes: ISlaAverageTimeMetrics;
  /** Active tickets count */
  activeTicketsCount: number;
  /** Tickets at risk count */
  atRiskCount: number;
  /** Currently breached count */
  breachedCount: number;
  /** Paused tickets count */
  pausedCount: number;
}
