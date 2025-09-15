// Configuration Management Database (CMDB) Interfaces for ITIL Integration

export interface IConfigurationItem {
  ci_id: string;
  tenant: string;
  
  // Basic CI Information
  ci_name: string;
  ci_number: string; // Unique identifier
  ci_type: string; // Hardware, Software, Service, Documentation, etc.
  ci_class: string; // More specific classification
  ci_status: 'planned' | 'ordered' | 'received' | 'under_development' | 'build_complete' | 'live' | 'withdrawn' | 'disposed';
  
  // Descriptive Information
  description: string;
  purpose: string;
  business_criticality: 'very_high' | 'high' | 'medium' | 'low' | 'very_low';
  environment: 'production' | 'staging' | 'testing' | 'development' | 'disaster_recovery';
  
  // Ownership and Responsibility
  owner: string; // User ID of CI owner
  custodian: string; // User ID of CI custodian
  supplier: string; // Supplier/vendor information
  
  // Technical Details (flexible JSON for different CI types)
  technical_attributes: {
    [key: string]: any;
  };
  
  // Location and Physical Details
  location: string;
  room?: string;
  rack?: string;
  position?: string;
  
  // Lifecycle Information
  acquisition_date?: Date;
  warranty_expiry_date?: Date;
  maintenance_schedule?: string;
  disposal_date?: Date;
  
  // Version and Change Control
  version: string;
  last_modified_date: Date;
  last_modified_by: string;
  change_control_record?: string; // Link to change request
  
  // Discovery Information
  discovered_by: 'manual' | 'automated' | 'import';
  discovery_source?: string;
  last_discovered?: Date;
  discovery_status: 'confirmed' | 'pending' | 'unconfirmed' | 'duplicate';
  
  // Compliance and Security
  compliance_requirements: string[];
  security_classification: 'public' | 'internal' | 'confidential' | 'restricted';
  
  // Metadata
  created_date: Date;
  created_by: string;
  updated_date?: Date;
  updated_by?: string;
}

export interface ICIRelationship {
  relationship_id: string;
  tenant: string;
  
  // Relationship Definition
  source_ci_id: string;
  target_ci_id: string;
  relationship_type: 'depends_on' | 'part_of' | 'connected_to' | 'installed_on' | 'uses' | 'provides' | 'manages' | 'backed_up_by' | 'clustered_with';
  
  // Relationship Details
  description?: string;
  strength: 'strong' | 'medium' | 'weak'; // Dependency strength
  criticality: 'critical' | 'important' | 'normal' | 'low';
  
  // Directional Information
  is_bidirectional: boolean;
  
  // Lifecycle
  start_date: Date;
  end_date?: Date;
  status: 'active' | 'inactive' | 'pending' | 'expired';
  
  // Discovery and Validation
  discovered_by: 'manual' | 'automated' | 'network_scan' | 'service_mapping';
  last_validated?: Date;
  validation_status: 'confirmed' | 'pending' | 'suspected' | 'invalid';
  
  // Metadata
  created_date: Date;
  created_by: string;
  updated_date?: Date;
  updated_by?: string;
}

export interface ICIType {
  ci_type_id: string;
  tenant: string;
  
  // Type Definition
  type_name: string;
  type_code: string;
  parent_type_id?: string; // For hierarchical types
  category: 'hardware' | 'software' | 'service' | 'documentation' | 'location' | 'person';
  
  // Type Configuration
  description: string;
  icon: string;
  color: string; // For visualization
  
  // Attribute Schema
  required_attributes: string[];
  optional_attributes: string[];
  attribute_definitions: {
    [attributeName: string]: {
      type: 'string' | 'number' | 'boolean' | 'date' | 'json' | 'reference';
      validation?: string;
      default_value?: any;
      reference_type?: string; // For reference attributes
    };
  };
  
  // Relationship Rules
  allowed_relationships: {
    relationship_type: string;
    target_ci_types: string[];
    cardinality: 'one_to_one' | 'one_to_many' | 'many_to_many';
    mandatory: boolean;
  }[];
  
  // Discovery Configuration
  discoverable: boolean;
  discovery_rules?: {
    [key: string]: any;
  };
  
  // Status
  active: boolean;
  
  // Metadata
  created_date: Date;
  created_by: string;
  updated_date?: Date;
  updated_by?: string;
}

export interface IDiscoveryRule {
  rule_id: string;
  tenant: string;
  
  // Rule Definition
  rule_name: string;
  rule_type: 'network_scan' | 'agent_based' | 'api_integration' | 'file_scan' | 'database_query';
  target_ci_types: string[];
  
  // Rule Configuration
  configuration: {
    [key: string]: any;
  };
  
  // Scheduling
  schedule_enabled: boolean;
  schedule_cron?: string;
  last_run?: Date;
  next_run?: Date;
  
  // Filtering and Mapping
  inclusion_filters: {
    [attribute: string]: any;
  };
  exclusion_filters: {
    [attribute: string]: any;
  };
  attribute_mapping: {
    [sourceField: string]: string; // Maps to CI attribute
  };
  
  // Processing Rules
  duplicate_handling: 'merge' | 'create_new' | 'skip' | 'flag';
  conflict_resolution: 'keep_existing' | 'update_existing' | 'manual_review';
  
  // Status and Performance
  active: boolean;
  success_rate: number; // Percentage of successful discoveries
  last_success_date?: Date;
  last_error?: string;
  
  // Metadata
  created_date: Date;
  created_by: string;
  updated_date?: Date;
  updated_by?: string;
}

export interface IDiscoveryResult {
  result_id: string;
  tenant: string;
  rule_id: string;
  
  // Discovery Session
  discovery_session_id: string;
  discovery_date: Date;
  
  // Results Summary
  total_items_found: number;
  items_created: number;
  items_updated: number;
  items_skipped: number;
  items_flagged: number;
  
  // Status
  status: 'completed' | 'failed' | 'partial' | 'in_progress';
  
  // Details
  discovered_items: {
    ci_id?: string;
    action: 'created' | 'updated' | 'skipped' | 'flagged';
    reason?: string;
    raw_data: any;
  }[];
  
  // Error Information
  errors: {
    error_type: string;
    error_message: string;
    error_count: number;
  }[];
  
  // Performance Metrics
  execution_time_ms: number;
  data_processed_mb: number;
  
  // Metadata
  created_date: Date;
}

export interface IImpactAnalysis {
  analysis_id: string;
  tenant: string;
  
  // Analysis Context
  trigger_type: 'change_request' | 'incident' | 'planned_maintenance' | 'manual';
  trigger_id?: string; // ID of the triggering entity
  
  // Analysis Scope
  source_ci_ids: string[];
  analysis_direction: 'upstream' | 'downstream' | 'both';
  max_depth: number; // How many relationship levels to analyze
  
  // Analysis Results
  impacted_cis: {
    ci_id: string;
    ci_name: string;
    ci_type: string;
    impact_level: 'direct' | 'indirect';
    impact_severity: 'critical' | 'high' | 'medium' | 'low';
    relationship_path: string[]; // Path from source to this CI
    business_impact: string;
    technical_impact: string;
  }[];
  
  // Impact Summary
  total_impacted: number;
  critical_impact_count: number;
  high_impact_count: number;
  medium_impact_count: number;
  low_impact_count: number;
  
  // Business Impact Assessment
  affected_services: string[];
  affected_users_estimate: number;
  estimated_downtime_minutes: number;
  financial_impact_estimate?: number;
  
  // Recommendations
  recommendations: {
    type: 'mitigation' | 'preparation' | 'communication' | 'rollback';
    priority: 'high' | 'medium' | 'low';
    description: string;
    actions: string[];
  }[];
  
  // Analysis Metadata
  analysis_date: Date;
  analysis_duration_ms: number;
  analyzer: 'automated' | 'manual';
  performed_by: string;
  
  // Status
  status: 'completed' | 'failed' | 'in_progress';
  confidence_score: number; // 0-100%
}

export interface ICMDBAuditLog {
  audit_id: string;
  tenant: string;
  
  // Audit Context
  ci_id?: string;
  relationship_id?: string;
  entity_type: 'configuration_item' | 'relationship' | 'ci_type' | 'discovery_rule';
  
  // Change Information
  action: 'created' | 'updated' | 'deleted' | 'status_changed' | 'discovered' | 'validated';
  field_changes?: {
    field_name: string;
    old_value: any;
    new_value: any;
  }[];
  
  // Context
  change_reason?: 'manual_update' | 'discovery' | 'import' | 'change_request' | 'incident_resolution';
  change_request_id?: string;
  incident_id?: string;
  
  // Metadata
  performed_by: string;
  performed_date: Date;
  source_system?: string;
  notes?: string;
  
  // Validation
  validated: boolean;
  validation_date?: Date;
  validated_by?: string;
}

export interface ICMDBReport {
  report_id: string;
  tenant: string;
  
  // Report Configuration
  report_name: string;
  report_type: 'inventory' | 'relationships' | 'compliance' | 'change_impact' | 'discovery_status' | 'data_quality';
  
  // Scope and Filters
  ci_types?: string[];
  statuses?: string[];
  owners?: string[];
  locations?: string[];
  date_range?: {
    start: Date;
    end: Date;
  };
  
  // Report Content
  include_sections: {
    summary: boolean;
    detailed_listings: boolean;
    relationship_maps: boolean;
    compliance_status: boolean;
    recommendations: boolean;
  };
  
  // Scheduling
  is_scheduled: boolean;
  schedule_frequency?: 'daily' | 'weekly' | 'monthly' | 'quarterly';
  next_generation_date?: Date;
  
  // Distribution
  recipients: string[]; // User IDs
  delivery_format: 'pdf' | 'excel' | 'csv' | 'json';
  
  // Generation Status
  status: 'pending' | 'generating' | 'completed' | 'failed';
  generated_date?: Date;
  file_path?: string;
  
  // Metadata
  created_date: Date;
  created_by: string;
  updated_date?: Date;
  updated_by?: string;
}

// Supporting Types and Enums
export type CIStatus = 'planned' | 'ordered' | 'received' | 'under_development' | 'build_complete' | 'live' | 'withdrawn' | 'disposed';
export type BusinessCriticality = 'very_high' | 'high' | 'medium' | 'low' | 'very_low';
export type Environment = 'production' | 'staging' | 'testing' | 'development' | 'disaster_recovery';
export type RelationshipType = 'depends_on' | 'part_of' | 'connected_to' | 'installed_on' | 'uses' | 'provides' | 'manages' | 'backed_up_by' | 'clustered_with';
export type DiscoveryMethod = 'manual' | 'automated' | 'import' | 'network_scan' | 'agent_based' | 'api_integration';

// CMDB Dashboard Metrics
export interface ICMDBMetrics {
  inventory: {
    total_cis: number;
    by_type: { [type: string]: number };
    by_status: { [status: string]: number };
    by_environment: { [env: string]: number };
  };
  relationships: {
    total_relationships: number;
    by_type: { [type: string]: number };
    orphaned_cis: number;
    circular_dependencies: number;
  };
  discovery: {
    last_discovery_date: Date;
    discovery_success_rate: number;
    pending_validations: number;
    duplicate_suspects: number;
  };
  quality: {
    completeness_score: number; // Percentage of CIs with required attributes
    accuracy_score: number; // Based on validation results
    consistency_score: number; // Relationship consistency
    freshness_score: number; // How recent the data is
  };
  compliance: {
    compliant_cis: number;
    non_compliant_cis: number;
    compliance_by_type: { [type: string]: number };
    audit_findings: number;
  };
}

export default {
  IConfigurationItem,
  ICIRelationship,
  ICIType,
  IDiscoveryRule,
  IDiscoveryResult,
  IImpactAnalysis,
  ICMDBAuditLog,
  ICMDBReport,
  ICMDBMetrics
};