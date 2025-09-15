// server/src/interfaces/change.interfaces.tsx
import { TenantEntity } from ".";
import { ITaggable } from './tag.interfaces';

/**
 * ITIL Change Request Interface
 * Manages all types of changes following ITIL Change Management processes
 */
export interface IChangeRequest extends TenantEntity, ITaggable {
  change_id?: string;
  change_number: string;
  title: string;
  description: string;
  justification: string; // Business justification for the change
  
  // Change classification
  change_type: ChangeType;
  change_category: ChangeCategory;
  priority_id: string;
  status_id: string;
  
  // Requestor and ownership
  requested_by: string;
  change_owner: string | null; // Person responsible for the change
  change_manager: string | null; // Assigned change manager
  implementer: string | null; // Person who will implement the change
  
  // Scheduling
  requested_implementation_date: string | null;
  scheduled_start_date: string | null;
  scheduled_end_date: string | null;
  actual_start_date: string | null;
  actual_end_date: string | null;
  
  // Impact and risk assessment
  business_impact: string | null;
  technical_impact: string | null;
  risk_level: RiskLevel;
  risk_assessment: string | null;
  affected_services: string[] | null; // Array of affected service IDs
  affected_cis: string[] | null; // Configuration Items affected
  
  // Implementation details
  implementation_plan: string | null;
  test_plan: string | null;
  backout_plan: string | null; // Rollback plan
  communication_plan: string | null;
  
  // Approval tracking
  cab_required: boolean; // Change Advisory Board approval required
  emergency_change: boolean; // Emergency change flag
  pre_approved: boolean; // Pre-approved standard change
  approval_notes: string | null;
  
  // Success criteria and validation
  success_criteria: string | null;
  validation_plan: string | null;
  post_implementation_review: string | null;
  
  // Relationships
  related_incident_ids: string[] | null;
  related_problem_ids: string[] | null;
  parent_change_id: string | null; // For change hierarchies
  child_change_ids: string[] | null;
  
  // Lifecycle tracking
  created_by: string;
  updated_by: string | null;
  approved_by: string | null;
  rejected_by: string | null;
  implemented_by: string | null;
  closed_by: string | null;
  
  // Timestamps
  created_at: string;
  updated_at: string | null;
  submitted_at: string | null; // When submitted for approval
  approved_at: string | null;
  rejected_at: string | null;
  implemented_at: string | null;
  closed_at: string | null;
  
  // Closure information
  closure_code: string | null;
  closure_notes: string | null;
  implementation_success: boolean | null;
  lessons_learned: string | null;
  
  // Additional metadata
  attributes: Record<string, unknown> | null;
}

/**
 * ITIL Change Types
 */
export enum ChangeType {
  STANDARD = 'standard',     // Pre-approved, low risk, routine changes
  NORMAL = 'normal',         // Requires CAB approval
  EMERGENCY = 'emergency'    // High urgency, expedited approval process
}

/**
 * Change Categories for classification
 */
export enum ChangeCategory {
  HARDWARE = 'hardware',
  SOFTWARE = 'software',
  NETWORK = 'network',
  PROCESS = 'process',
  DOCUMENTATION = 'documentation',
  SECURITY = 'security',
  INFRASTRUCTURE = 'infrastructure',
  APPLICATION = 'application',
  DATABASE = 'database',
  ENVIRONMENT = 'environment'
}

/**
 * Risk Assessment Levels
 */
export enum RiskLevel {
  VERY_LOW = 'very_low',
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  VERY_HIGH = 'very_high'
}

/**
 * Change Status Interface
 */
export interface IChangeStatus extends TenantEntity {
  status_id: string;
  name: string;
  description: string;
  is_active: boolean;
  is_closed: boolean;
  is_approved: boolean;
  is_rejected: boolean;
  order_number: number;
  color: string | null;
  allowed_transitions: string[] | null; // Valid next status IDs
}

/**
 * Standard ITIL Change statuses
 */
export enum ChangeStatus {
  DRAFT = 'draft',
  SUBMITTED = 'submitted',
  UNDER_REVIEW = 'under_review',
  AWAITING_CAB = 'awaiting_cab',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  SCHEDULED = 'scheduled',
  IN_PROGRESS = 'in_progress',
  IMPLEMENTED = 'implemented',
  FAILED = 'failed',
  BACKED_OUT = 'backed_out',
  CLOSED = 'closed',
  CANCELLED = 'cancelled'
}

/**
 * Change Advisory Board (CAB) Interface
 */
export interface ICAB extends TenantEntity {
  cab_id: string;
  name: string;
  description: string;
  is_active: boolean;
  
  // CAB composition
  chair_user_id: string; // CAB chairperson
  members: string[]; // Array of user IDs
  advisors: string[] | null; // Optional advisors
  
  // Meeting schedule
  meeting_schedule: string | null; // Cron expression or description
  meeting_duration_minutes: number;
  
  // Approval thresholds
  quorum_required: number; // Minimum members for decisions
  approval_threshold: number; // Percentage needed for approval
  
  // Change type scope
  change_types: ChangeType[]; // Which change types this CAB handles
  risk_levels: RiskLevel[]; // Which risk levels require this CAB
  
  created_by: string;
  created_at: string;
  updated_at: string | null;
}

/**
 * CAB Meeting Interface
 */
export interface ICABMeeting extends TenantEntity {
  meeting_id: string;
  cab_id: string;
  meeting_date: string;
  duration_minutes: number | null;
  location: string | null;
  meeting_type: 'regular' | 'emergency' | 'special';
  
  // Participants
  chair_user_id: string;
  attendees: string[]; // User IDs who attended
  apologies: string[] | null; // User IDs who sent apologies
  
  // Meeting content
  agenda: string | null;
  minutes: string | null;
  decisions: ICABDecision[] | null;
  action_items: string[] | null;
  
  // Status
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  
  created_by: string;
  created_at: string;
  updated_at: string | null;
}

/**
 * CAB Decision Interface
 */
export interface ICABDecision extends TenantEntity {
  decision_id: string;
  meeting_id: string;
  change_id: string;
  
  // Decision details
  decision: 'approved' | 'rejected' | 'deferred' | 'conditional';
  rationale: string;
  conditions: string | null; // If conditional approval
  
  // Voting details
  votes_for: number;
  votes_against: number;
  abstentions: number;
  
  // Implementation constraints
  implementation_window: string | null;
  special_conditions: string | null;
  
  decided_by: string; // Chair or decision maker
  decided_at: string;
  
  created_at: string;
}

/**
 * Change Conflict Interface
 */
export interface IChangeConflict extends TenantEntity {
  conflict_id: string;
  change_id_1: string;
  change_id_2: string;
  conflict_type: ConflictType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  
  // Conflict details
  description: string;
  affected_resources: string[] | null;
  time_overlap: boolean;
  resource_contention: boolean;
  dependency_conflict: boolean;
  
  // Resolution
  status: 'identified' | 'under_review' | 'resolved' | 'accepted_risk';
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  
  detected_by: string; // System or user ID
  detected_at: string;
  
  created_at: string;
}

/**
 * Types of change conflicts
 */
export enum ConflictType {
  RESOURCE_CONFLICT = 'resource_conflict',
  TIME_OVERLAP = 'time_overlap',
  DEPENDENCY_CONFLICT = 'dependency_conflict',
  BLACKOUT_VIOLATION = 'blackout_violation',
  MAINTENANCE_WINDOW = 'maintenance_window'
}

/**
 * Change Calendar Event Interface
 */
export interface IChangeCalendarEvent extends TenantEntity {
  event_id: string;
  change_id: string | null; // Null for maintenance windows/blackouts
  event_type: 'change' | 'maintenance_window' | 'blackout' | 'freeze';
  
  title: string;
  description: string | null;
  
  // Timing
  start_date: string;
  end_date: string;
  all_day: boolean;
  timezone: string;
  
  // Scope
  affected_services: string[] | null;
  affected_environments: string[] | null;
  
  // Approval and ownership
  approved_by: string | null;
  owner: string | null;
  
  // Recurrence (for maintenance windows)
  recurrence_rule: string | null; // RRULE format
  recurrence_exceptions: string[] | null; // Exception dates
  
  created_by: string;
  created_at: string;
  updated_at: string | null;
}

/**
 * Change List Item for table views
 */
export interface IChangeListItem extends Omit<IChangeRequest, 'status_id' | 'priority_id' | 'requested_by' | 'change_owner'> {
  status_id: string | null;
  priority_id: string | null;
  requested_by: string | null;
  change_owner: string | null;
  
  // Populated fields
  status_name: string;
  priority_name: string;
  priority_color?: string;
  requested_by_name: string;
  change_owner_name: string | null;
  change_manager_name: string | null;
  implementer_name: string | null;
}

/**
 * Change filters for list views
 */
export interface IChangeListFilters {
  statusId?: string;
  priorityId?: string;
  changeType?: ChangeType;
  changeCategory?: ChangeCategory;
  riskLevel?: RiskLevel;
  requestedBy?: string;
  changeOwner?: string;
  changeManager?: string;
  cabRequired?: boolean;
  emergencyChange?: boolean;
  searchQuery?: string;
  tags?: string[];
  dateRange?: {
    startDate: string;
    endDate: string;
    field: 'created_at' | 'scheduled_start_date' | 'implemented_at';
  };
}

/**
 * Change metrics and statistics
 */
export interface IChangeMetrics {
  totalChanges: number;
  successfulChanges: number;
  failedChanges: number;
  backedOutChanges: number;
  
  // By status
  byStatus: Record<string, number>;
  
  // By type
  byType: Record<ChangeType, number>;
  
  // By category
  byCategory: Record<ChangeCategory, number>;
  
  // By risk level
  byRiskLevel: Record<RiskLevel, number>;
  
  // Success metrics
  successRate: number;
  averageImplementationTime: number; // in hours
  
  // CAB metrics
  cabChanges: number;
  emergencyChanges: number;
  standardChanges: number;
  
  // Timing metrics
  onTimeImplementation: number;
  averageApprovalTime: number; // in hours
}