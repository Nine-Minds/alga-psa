// server/src/interfaces/problem.interfaces.tsx
import { TenantEntity } from ".";
import { ITaggable } from './tag.interfaces';

/**
 * ITIL Problem Record Interface
 * Problems represent the underlying cause of one or more incidents
 */
export interface IProblem extends TenantEntity, ITaggable {
  problem_id?: string;
  problem_number: string;
  title: string;
  description: string;
  status_id: string;
  priority_id: string;
  category_id: string | null;
  subcategory_id: string | null;
  
  // Problem Management specific fields
  problem_type: 'proactive' | 'reactive'; // Proactive (identified before incidents) or Reactive (from incidents)
  root_cause: string | null;
  workaround: string | null;
  permanent_solution: string | null;
  
  // Assignment and ownership
  assigned_to: string | null; // Problem Manager/Analyst
  problem_manager: string | null; // Overall problem owner
  investigation_team: string[] | null; // Array of user IDs on investigation team
  
  // Timestamps
  created_by: string;
  updated_by: string | null;
  resolved_by: string | null;
  closed_by: string | null;
  created_at: string;
  updated_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  
  // Analysis tracking
  investigation_started_at: string | null;
  investigation_completed_at: string | null;
  solution_implemented_at: string | null;
  
  // Business impact
  business_impact: string | null;
  affected_services: string[] | null; // Array of affected service IDs
  estimated_cost: number | null; // Financial impact estimation
  
  // KEDB (Known Error Database) fields
  is_known_error: boolean;
  known_error_date: string | null;
  error_pattern: string | null; // Symptom pattern for identification
  detection_criteria: string | null; // How to detect this error
  
  // Relationships
  parent_problem_id: string | null; // For problem hierarchies
  duplicate_of_problem_id: string | null; // If this is a duplicate
  related_change_ids: string[] | null; // Changes created to resolve this problem
  
  // Metrics
  incident_count: number; // Number of related incidents
  recurrence_count: number; // Number of times this problem has recurred
  last_occurrence: string | null; // When this problem last occurred
  
  // Closure information
  closure_code: string | null;
  closure_notes: string | null;
  lessons_learned: string | null;
  
  // Additional metadata
  attributes: Record<string, unknown> | null;
}

/**
 * Problem Status types following ITIL lifecycle
 */
export interface IProblemStatus extends TenantEntity {
  status_id: string;
  name: string;
  description: string;
  is_active: boolean;
  is_closed: boolean;
  is_resolved: boolean;
  order_number: number;
  color: string | null;
}

/**
 * Standard ITIL Problem statuses
 */
export enum ProblemStatus {
  LOGGED = 'logged',
  ASSIGNED = 'assigned',
  UNDER_INVESTIGATION = 'under_investigation',
  KNOWN_ERROR = 'known_error',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
  CANCELLED = 'cancelled'
}

/**
 * Problem-Incident relationship
 */
export interface IProblemIncident extends TenantEntity {
  problem_incident_id: string;
  problem_id: string;
  incident_id: string; // References ticket_id from tickets table
  relationship_type: 'caused_by' | 'related_to' | 'symptom_of';
  created_by: string;
  created_at: string;
  notes: string | null;
}

/**
 * Known Error Database (KEDB) Entry
 */
export interface IKnownError extends TenantEntity {
  known_error_id: string;
  problem_id: string;
  error_code: string; // Unique identifier for the error
  title: string;
  description: string;
  symptoms: string; // How to identify this error
  workaround: string | null;
  resolution_steps: string | null;
  affected_cis: string[] | null; // Configuration Items affected
  
  // Classification
  error_type: 'software' | 'hardware' | 'network' | 'process' | 'environmental';
  severity: 'critical' | 'high' | 'medium' | 'low';
  
  // Lifecycle
  identified_date: string;
  resolved_date: string | null;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string | null;
  
  // Metrics
  occurrence_count: number;
  last_occurrence: string | null;
  avg_resolution_time: number | null; // In hours
  
  // Documentation
  documentation_url: string | null;
  vendor_reference: string | null;
  internal_reference: string | null;
  
  attributes: Record<string, unknown> | null;
}

/**
 * Problem Analysis Session
 * Tracks investigation sessions and findings
 */
export interface IProblemAnalysis extends TenantEntity {
  analysis_id: string;
  problem_id: string;
  session_date: string;
  duration_minutes: number | null;
  
  // Participants
  lead_analyst: string;
  participants: string[] | null;
  
  // Analysis details
  analysis_type: 'root_cause_analysis' | 'impact_assessment' | 'solution_design' | 'review';
  findings: string;
  actions_identified: string | null;
  recommendations: string | null;
  
  // Follow-up
  next_steps: string | null;
  next_session_date: string | null;
  
  // Documentation
  meeting_notes: string | null;
  attachments: string[] | null;
  
  created_by: string;
  created_at: string;
  updated_at: string | null;
}

/**
 * Problem List Item for table views
 */
export interface IProblemListItem extends Omit<IProblem, 'status_id' | 'priority_id' | 'category_id' | 'created_by' | 'assigned_to'> {
  status_id: string | null;
  priority_id: string | null;
  category_id: string | null;
  created_by: string | null;
  assigned_to: string | null;
  
  // Populated fields
  status_name: string;
  priority_name: string;
  priority_color?: string;
  category_name: string;
  created_by_name: string;
  assigned_to_name: string | null;
  problem_manager_name: string | null;
}

/**
 * Problem filters for list views
 */
export interface IProblemListFilters {
  statusId?: string;
  priorityId?: string;
  categoryId?: string;
  problemType?: 'proactive' | 'reactive';
  assignedTo?: string;
  problemManager?: string;
  isKnownError?: boolean;
  searchQuery?: string;
  tags?: string[];
  dateRange?: {
    startDate: string;
    endDate: string;
    field: 'created_at' | 'resolved_at' | 'closed_at';
  };
}

/**
 * Problem metrics and statistics
 */
export interface IProblemMetrics {
  totalProblems: number;
  openProblems: number;
  resolvedProblems: number;
  knownErrors: number;
  
  // By status
  byStatus: Record<string, number>;
  
  // By priority
  byPriority: Record<string, number>;
  
  // By type
  proactiveProblems: number;
  reactiveProblems: number;
  
  // Resolution metrics
  averageResolutionTime: number; // in hours
  averageInvestigationTime: number; // in hours
  
  // Recurrence tracking
  recurringProblems: number;
  totalRecurrences: number;
  
  // Business impact
  highImpactProblems: number;
  estimatedTotalCost: number;
}