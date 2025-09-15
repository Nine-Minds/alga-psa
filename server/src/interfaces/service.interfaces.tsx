// Service Level Management Interfaces for ITIL Integration

export interface IService {
  service_id: string;
  tenant: string;
  service_name: string;
  service_code: string; // Unique identifier
  description: string;
  service_category: 'business' | 'technical' | 'infrastructure' | 'application';
  service_type: 'customer_facing' | 'supporting' | 'management';
  
  // Service Ownership
  service_owner: string; // User ID of service owner
  technical_owner: string; // User ID of technical owner
  business_owner: string; // User ID of business owner
  
  // Service Status
  status: 'design' | 'transition' | 'live' | 'retired';
  lifecycle_stage: 'strategy' | 'design' | 'transition' | 'operation' | 'continual_improvement';
  
  // Service Details
  business_value: string;
  target_audience: string[];
  operating_hours: string; // JSON string describing operating schedule
  availability_target: number; // Percentage (e.g., 99.9)
  
  // Dependencies
  depends_on_services: string[]; // Array of service IDs
  supports_services: string[]; // Array of service IDs
  
  // Financial Information
  cost_center: string;
  annual_cost?: number;
  charging_model?: 'free' | 'subscription' | 'usage_based' | 'project_based';
  
  // Metadata
  created_date: Date;
  created_by: string;
  updated_date?: Date;
  updated_by?: string;
  retired_date?: Date;
  retired_reason?: string;
}

export interface IServiceLevelAgreement {
  sla_id: string;
  tenant: string;
  sla_name: string;
  service_id: string;
  
  // Agreement Details
  customer_id?: string; // If specific to a customer
  agreement_type: 'standard' | 'custom' | 'internal';
  status: 'draft' | 'active' | 'expired' | 'terminated';
  
  // Validity Period
  effective_date: Date;
  expiry_date?: Date;
  review_date?: Date;
  
  // Service Level Targets
  availability_target: number; // Percentage
  response_time_target: number; // Minutes for initial response
  resolution_time_targets: {
    priority_1: number; // Hours
    priority_2: number;
    priority_3: number;
    priority_4: number;
    priority_5: number;
  };
  
  // Performance Metrics
  uptime_measurement_period: 'monthly' | 'quarterly' | 'annually';
  exclusions: string[]; // Planned maintenance, force majeure, etc.
  penalties: {
    availability_breach: string;
    response_time_breach: string;
    resolution_time_breach: string;
  };
  
  // Service Credits
  service_credits_enabled: boolean;
  credit_thresholds: {
    threshold_percentage: number;
    credit_percentage: number;
  }[];
  
  // Reporting
  reporting_frequency: 'weekly' | 'monthly' | 'quarterly';
  report_recipients: string[]; // Array of user IDs
  
  // Escalation
  escalation_matrix: {
    level: number;
    time_minutes: number;
    escalate_to: string[]; // Array of user IDs or roles
  }[];
  
  // Metadata
  created_date: Date;
  created_by: string;
  updated_date?: Date;
  updated_by?: string;
  approved_by?: string;
  approved_date?: Date;
}

export interface IServiceLevelObjective {
  slo_id: string;
  tenant: string;
  sla_id: string;
  service_id: string;
  
  // Objective Details
  objective_name: string;
  description: string;
  metric_type: 'availability' | 'response_time' | 'resolution_time' | 'throughput' | 'error_rate' | 'customer_satisfaction';
  
  // Target Values
  target_value: number;
  target_unit: string; // %, minutes, hours, requests/sec, etc.
  measurement_period: 'hourly' | 'daily' | 'weekly' | 'monthly';
  
  // Measurement Configuration
  measurement_method: string;
  data_source: string; // Where to collect metrics from
  calculation_formula?: string;
  
  // Thresholds
  warning_threshold: number;
  critical_threshold: number;
  
  // Status
  status: 'active' | 'paused' | 'archived';
  
  // Metadata
  created_date: Date;
  created_by: string;
  last_measured?: Date;
  current_performance?: number;
}

export interface IServicePerformanceRecord {
  record_id: string;
  tenant: string;
  service_id: string;
  sla_id?: string;
  slo_id?: string;
  
  // Measurement Details
  measurement_date: Date;
  measurement_period_start: Date;
  measurement_period_end: Date;
  
  // Performance Metrics
  availability_percentage?: number;
  uptime_minutes?: number;
  downtime_minutes?: number;
  total_incidents?: number;
  
  // Response Time Metrics
  avg_response_time?: number; // Minutes
  p95_response_time?: number;
  p99_response_time?: number;
  
  // Resolution Time Metrics by Priority
  resolution_times: {
    priority_1_avg?: number; // Hours
    priority_2_avg?: number;
    priority_3_avg?: number;
    priority_4_avg?: number;
    priority_5_avg?: number;
  };
  
  // SLA Compliance
  sla_compliance_percentage: number;
  sla_breaches: number;
  
  // Customer Satisfaction
  csat_score?: number; // 1-5 scale
  csat_responses?: number;
  nps_score?: number; // -100 to +100
  nps_responses?: number;
  
  // Incidents and Changes
  total_incidents_p1?: number;
  total_incidents_p2?: number;
  total_incidents_p3?: number;
  total_incidents_p4?: number;
  total_incidents_p5?: number;
  
  total_changes?: number;
  successful_changes?: number;
  failed_changes?: number;
  
  // Financial Impact
  service_credits_applied?: number;
  penalty_amount?: number;
  
  // Metadata
  created_date: Date;
  created_by: string;
  data_sources: string[]; // Array of systems that provided data
}

export interface ICustomerSatisfactionSurvey {
  survey_id: string;
  tenant: string;
  
  // Survey Details
  survey_type: 'csat' | 'nps' | 'ces' | 'custom'; // Customer Effort Score
  title: string;
  description?: string;
  
  // Trigger Configuration
  trigger_type: 'ticket_closure' | 'scheduled' | 'manual' | 'service_interaction';
  trigger_conditions?: {
    service_ids?: string[];
    priority_levels?: number[];
    resolution_time_threshold?: number;
  };
  
  // Survey Questions
  questions: {
    question_id: string;
    question_text: string;
    question_type: 'rating_scale' | 'yes_no' | 'multiple_choice' | 'text' | 'nps_scale';
    required: boolean;
    options?: string[]; // For multiple choice questions
    scale_min?: number; // For rating scales
    scale_max?: number;
  }[];
  
  // Configuration
  status: 'draft' | 'active' | 'paused' | 'archived';
  send_delay_minutes: number; // Delay after trigger event
  reminder_enabled: boolean;
  reminder_days: number[];
  
  // Recipients
  target_audience: 'all_customers' | 'specific_customers' | 'service_users';
  customer_filter?: {
    company_ids?: string[];
    contact_ids?: string[];
    service_ids?: string[];
  };
  
  // Response Settings
  anonymous_responses: boolean;
  response_limit?: number; // Max responses per customer per period
  
  // Metadata
  created_date: Date;
  created_by: string;
  updated_date?: Date;
  updated_by?: string;
}

export interface ICustomerSatisfactionResponse {
  response_id: string;
  tenant: string;
  survey_id: string;
  
  // Respondent Information
  customer_id?: string; // Null if anonymous
  contact_id?: string;
  ticket_id?: string; // If triggered by ticket closure
  service_id?: string;
  
  // Response Data
  responses: {
    question_id: string;
    response_value: string | number;
    response_text?: string; // For text responses or additional comments
  }[];
  
  // Calculated Scores
  csat_score?: number; // 1-5 scale
  nps_score?: number; // 0-10 scale (converted to -100 to +100)
  ces_score?: number; // 1-7 scale
  overall_satisfaction?: number;
  
  // Response Metadata
  response_date: Date;
  response_channel: 'email' | 'web' | 'mobile' | 'phone' | 'sms';
  completion_time_seconds?: number;
  
  // Follow-up
  follow_up_requested: boolean;
  follow_up_completed: boolean;
  follow_up_notes?: string;
}

export interface IServiceReport {
  report_id: string;
  tenant: string;
  
  // Report Configuration
  report_name: string;
  report_type: 'sla_performance' | 'service_availability' | 'customer_satisfaction' | 'service_overview' | 'executive_summary';
  service_ids: string[];
  sla_ids?: string[];
  
  // Report Period
  period_start: Date;
  period_end: Date;
  reporting_frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annually' | 'custom';
  
  // Report Content
  sections: {
    section_id: string;
    section_name: string;
    section_type: 'metrics_summary' | 'trend_analysis' | 'sla_compliance' | 'incident_summary' | 'customer_feedback';
    include_charts: boolean;
    include_raw_data: boolean;
  }[];
  
  // Distribution
  recipients: string[]; // Array of user IDs
  distribution_method: 'email' | 'portal' | 'both';
  auto_generate: boolean;
  
  // Generation Status
  status: 'pending' | 'generating' | 'completed' | 'failed';
  generated_date?: Date;
  file_path?: string; // Path to generated report file
  
  // Metadata
  created_date: Date;
  created_by: string;
  template_id?: string; // Reference to report template
}

// Supporting Types and Enums
export type ServiceStatus = 'design' | 'transition' | 'live' | 'retired';
export type ServiceCategory = 'business' | 'technical' | 'infrastructure' | 'application';
export type ServiceType = 'customer_facing' | 'supporting' | 'management';
export type SLAStatus = 'draft' | 'active' | 'expired' | 'terminated';
export type SLOStatus = 'active' | 'paused' | 'archived';
export type MetricType = 'availability' | 'response_time' | 'resolution_time' | 'throughput' | 'error_rate' | 'customer_satisfaction';
export type SurveyType = 'csat' | 'nps' | 'ces' | 'custom';
export type ReportType = 'sla_performance' | 'service_availability' | 'customer_satisfaction' | 'service_overview' | 'executive_summary';

// Service Level Management Statistics
export interface IServiceLevelStats {
  overall_availability: number;
  average_response_time: number;
  average_resolution_time: number;
  sla_compliance_rate: number;
  customer_satisfaction_score: number;
  total_incidents: number;
  incidents_by_priority: {
    priority_1: number;
    priority_2: number;
    priority_3: number;
    priority_4: number;
    priority_5: number;
  };
  trend_data: {
    period: string;
    availability: number;
    response_time: number;
    csat_score: number;
    incident_count: number;
  }[];
}

// Service Dependency Mapping
export interface IServiceDependency {
  dependency_id: string;
  tenant: string;
  service_id: string; // Dependent service
  depends_on_service_id: string; // Service being depended on
  dependency_type: 'hard' | 'soft' | 'operational';
  impact_level: 'high' | 'medium' | 'low';
  description?: string;
  created_date: Date;
  created_by: string;
}

export interface IServiceMetrics {
  metric_id: string;
  tenant: string;
  service_id: string;
  service_name?: string;
  sla_id?: string;
  
  // Metric Details
  metric_type: 'availability' | 'response_time' | 'resolution_time' | 'incident_count' | 'change_success_rate' | 'customer_satisfaction';
  measurement_period: 'hourly' | 'daily' | 'weekly' | 'monthly';
  recorded_date: Date;
  
  // Metric Values
  target_value?: number;
  actual_value: number;
  average_value: number;
  min_value?: number;
  max_value?: number;
  
  // Performance Analysis
  trend?: 'improving' | 'stable' | 'declining';
  variance_percentage?: number;
  is_meeting_target: boolean;
  
  // Metadata
  data_source: string;
  collection_method: 'automatic' | 'manual';
  created_date: Date;
}

export default {
  IService,
  IServiceLevelAgreement,
  IServiceLevelObjective,
  IServicePerformanceRecord,
  ICustomerSatisfactionSurvey,
  ICustomerSatisfactionResponse,
  IServiceReport,
  IServiceLevelStats,
  IServiceDependency,
  IServiceMetrics
};