/**
 * SLA Backend Interface Types
 *
 * These types define the contract for SLA backend implementations.
 * They are placed in @alga-psa/types to avoid circular dependencies:
 * auth -> ee-stubs -> sla -> auth
 *
 * Both @alga-psa/sla and @alga-psa/ee-stubs can import these types from here.
 */

// Define locally to avoid import issues within the same package
type ISODateString = string;

// ============================================================================
// Business Hours Interfaces
// ============================================================================

/**
 * Business hours schedule defines when the support team is available.
 */
export interface IBusinessHoursSchedule {
  tenant?: string;
  schedule_id: string;
  schedule_name: string;
  timezone: string;
  is_default: boolean;
  is_24x7: boolean;
  created_at?: ISODateString;
  updated_at?: ISODateString;
}

/**
 * Business hours entry defines working hours for a specific day of the week.
 */
export interface IBusinessHoursEntry {
  tenant?: string;
  entry_id: string;
  schedule_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_enabled: boolean;
}

/**
 * Holiday definition for excluding specific dates from business hours.
 */
export interface IHoliday {
  tenant?: string;
  holiday_id: string;
  schedule_id?: string | null;
  holiday_name: string;
  holiday_date: string;
  is_recurring: boolean;
  created_at?: ISODateString;
}

/**
 * Business hours schedule with its daily entries and holidays.
 */
export interface IBusinessHoursScheduleWithEntries extends IBusinessHoursSchedule {
  entries: IBusinessHoursEntry[];
  holidays?: IHoliday[];
}

// ============================================================================
// SLA Policy Interfaces
// ============================================================================

/**
 * SLA Policy Target defines response and resolution time targets
 * for a specific priority level within an SLA policy.
 */
export interface ISlaPolicyTarget {
  tenant?: string;
  target_id: string;
  sla_policy_id: string;
  priority_id: string;
  response_time_minutes?: number | null;
  resolution_time_minutes?: number | null;
  escalation_1_percent: number;
  escalation_2_percent: number;
  escalation_3_percent: number;
  is_24x7: boolean;
  created_at?: ISODateString;
  updated_at?: ISODateString;
}

// ============================================================================
// SLA Status Types
// ============================================================================

/**
 * Status of an SLA timer.
 */
export type SlaTimerStatus =
  | 'on_track'
  | 'at_risk'
  | 'response_breached'
  | 'resolution_breached'
  | 'paused';

/**
 * Reason why an SLA timer is paused.
 */
export type SlaPauseReason = 'awaiting_client' | 'status_pause';

/**
 * Current SLA status for a ticket.
 */
export interface ISlaStatus {
  status: SlaTimerStatus;
  response_remaining_minutes?: number;
  resolution_remaining_minutes?: number;
  is_paused: boolean;
  pause_reason?: SlaPauseReason;
  total_pause_minutes: number;
}

// ============================================================================
// SLA Backend Interface
// ============================================================================

/**
 * Interface for SLA backend implementations.
 * Defines the contract for starting, pausing, resuming, and completing SLA tracking.
 */
export interface ISlaBackend {
  startSlaTracking(
    ticketId: string,
    policyId: string,
    targets: ISlaPolicyTarget[],
    schedule: IBusinessHoursScheduleWithEntries
  ): Promise<void>;
  pauseSla(ticketId: string, reason: SlaPauseReason): Promise<void>;
  resumeSla(ticketId: string): Promise<void>;
  completeSla(
    ticketId: string,
    type: 'response' | 'resolution',
    met: boolean
  ): Promise<void>;
  cancelSla(ticketId: string): Promise<void>;
  getSlaStatus(ticketId: string): Promise<ISlaStatus | null>;
}
