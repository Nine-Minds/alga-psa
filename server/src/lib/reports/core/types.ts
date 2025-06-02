// Core types and interfaces for the hierarchical report system

export type ReportCategory = 'billing' | 'operations' | 'financial' | 'analytics' | 'compliance';
export type MetricType = 'count' | 'sum' | 'average' | 'min' | 'max' | 'ratio' | 'trend';
export type AggregationType = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'count_distinct';
export type FilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_in' | 'like' | 'is_null' | 'is_not_null';
export type JoinType = 'inner' | 'left' | 'right' | 'full';

export interface ReportDefinition {
  id: string;                     // Unique identifier (e.g., 'billing.overview')
  name: string;                   // Human-readable name
  description: string;            // Report description
  category: ReportCategory;       // Category for organization
  version: string;                // Version for compatibility
  
  metrics: MetricDefinition[];    // List of metrics to calculate
  parameters?: ParameterDefinition[]; // Optional input parameters
  
  permissions: {                  // Access control
    roles: string[];              // Required roles
    resources: string[];          // Required resource permissions
  };
  
  caching?: {                     // Caching configuration
    ttl: number;                  // Time to live in seconds
    key: string;                  // Cache key template
    invalidateOn?: string[];      // Events that invalidate cache
  };
  
  scheduling?: {                  // For scheduled reports
    frequency: string;            // Cron expression
    enabled: boolean;
  };
}

export interface MetricDefinition {
  id: string;                     // Metric identifier
  name: string;                   // Display name
  description?: string;           // Optional description
  type: MetricType;               // Type of metric (count, sum, avg, etc.)
  
  query: QueryDefinition;         // How to calculate the metric
  formatting?: FormattingOptions; // Display formatting
  
  dependencies?: string[];        // Other metrics this depends on
  conditions?: ConditionDefinition[]; // Conditional logic
}

export interface QueryDefinition {
  table: string;                  // Primary table
  joins?: JoinDefinition[];       // Table joins
  fields?: string[];              // Fields to select
  aggregation?: AggregationType;  // Aggregation method
  filters?: FilterDefinition[];   // Where conditions
  groupBy?: string[];             // Group by fields
  orderBy?: OrderDefinition[];    // Sorting
  limit?: number;                 // Result limit
}

export interface JoinDefinition {
  type: JoinType;                 // Type of join
  table: string;                  // Table to join
  on: JoinCondition[];            // Join conditions
}

export interface JoinCondition {
  left: string;                   // Left side of condition
  right: string;                  // Right side of condition
  operator?: string;              // Comparison operator (defaults to =)
}

export interface FilterDefinition {
  field: string;                  // Field to filter on
  operator: FilterOperator;       // Filter operator
  value: any;                     // Filter value (can include parameter placeholders)
}

export interface OrderDefinition {
  field: string;                  // Field to order by
  direction: 'asc' | 'desc';      // Order direction
}

export interface ParameterDefinition {
  id: string;                     // Parameter identifier
  name: string;                   // Display name
  type: 'string' | 'number' | 'date' | 'boolean' | 'array';
  required: boolean;              // Is parameter required
  defaultValue?: any;             // Default value
  validation?: any;               // Validation rules
}

export interface ConditionDefinition {
  field: string;                  // Field to check
  operator: FilterOperator;       // Condition operator
  value: any;                     // Condition value
  action: 'include' | 'exclude';  // What to do if condition matches
}

export interface FormattingOptions {
  type: 'number' | 'currency' | 'percentage' | 'duration' | 'date';
  decimals?: number;              // Number of decimal places
  currency?: string;              // Currency code for currency formatting
  divisor?: number;               // Divisor for converting values (e.g., cents to dollars)
  unit?: string;                  // Unit for duration formatting
  dateFormat?: string;            // Date format string
}

export interface ReportResult {
  reportId: string;               // Report identifier
  reportName: string;             // Report name
  executedAt: string;             // Execution timestamp (ISO string)
  parameters: ReportParameters;   // Parameters used
  metrics: Record<string, any>;   // Metric results
  metadata: ReportMetadata;       // Execution metadata
}

export interface ReportMetadata {
  version: string;                // Report version
  category: ReportCategory;       // Report category
  executionTime: number;          // Execution time in milliseconds
  cacheHit?: boolean;             // Whether result came from cache
  rowCount?: number;              // Number of rows processed
}

export interface ReportParameters {
  [key: string]: any;             // Dynamic parameters
  tenant?: string;                // Tenant ID (automatically added)
  start_of_month?: string;        // Auto-calculated date parameters
  end_of_month?: string;
  start_of_year?: string;
  end_of_year?: string;
}

export interface FormattedMetricValue {
  raw: any;                       // Raw value from database
  formatted: string;              // Formatted display value
  type: string;                   // Value type
}

// Cache-related interfaces
export interface CacheConfig {
  ttl: number;                    // Time to live in seconds
  key: string;                    // Cache key template
  invalidateOn?: string[];        // Events that invalidate cache
}

export interface CacheKeyOptions {
  reportId: string;
  parameters: ReportParameters;
  tenant: string;
}

// Error types
export class ReportError extends Error {
  constructor(
    message: string,
    public reportId?: string,
    public metricId?: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'ReportError';
  }
}

export class ReportValidationError extends ReportError {
  constructor(message: string, reportId?: string) {
    super(message, reportId);
    this.name = 'ReportValidationError';
  }
}

export class ReportExecutionError extends ReportError {
  constructor(message: string, reportId?: string, metricId?: string, originalError?: Error) {
    super(message, reportId, metricId, originalError);
    this.name = 'ReportExecutionError';
  }
}

export class ReportPermissionError extends ReportError {
  constructor(message: string, reportId?: string) {
    super(message, reportId);
    this.name = 'ReportPermissionError';
  }
}

// Utility types
export type ReportRegistry = Record<string, ReportDefinition>;

export interface ReportExecutionOptions {
  skipCache?: boolean;            // Skip cache lookup
  forceRefresh?: boolean;         // Force cache refresh
  timeout?: number;               // Query timeout in milliseconds
}