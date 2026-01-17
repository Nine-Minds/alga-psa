/**
 * Alga Guard - PII Scanner Interfaces
 */

// PII Types enum
export type GuardPiiType =
  | 'ssn'
  | 'credit_card'
  | 'bank_account'
  | 'dob'
  | 'drivers_license'
  | 'passport'
  | 'email'
  | 'phone'
  | 'ip_address'
  | 'mac_address'
  | 'person_name'      // Detected via LLM NER
  | 'address';         // Detected via LLM NER

// Job status enum
export type GuardJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

// PII Profile
export interface IGuardPiiProfile {
  id: string;
  tenant: string;
  name: string;
  description?: string;
  pii_types: GuardPiiType[];
  file_extensions: string[];
  target_companies?: string[] | null;
  target_agents?: string[] | null;
  include_paths: string[];
  exclude_paths: string[];
  max_file_size_mb: number;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
  created_by?: string;
}

// PII Profile creation request
export interface ICreatePiiProfileRequest {
  name: string;
  description?: string;
  pii_types: GuardPiiType[];
  file_extensions?: string[];
  target_companies?: string[] | null;
  target_agents?: string[] | null;
  include_paths?: string[];
  exclude_paths?: string[];
  max_file_size_mb?: number;
  enabled?: boolean;
}

// PII Profile update request
export interface IUpdatePiiProfileRequest {
  name?: string;
  description?: string;
  pii_types?: GuardPiiType[];
  file_extensions?: string[];
  target_companies?: string[] | null;
  target_agents?: string[] | null;
  include_paths?: string[];
  exclude_paths?: string[];
  max_file_size_mb?: number;
  enabled?: boolean;
}

// PII Job
export interface IGuardPiiJob {
  id: string;
  tenant: string;
  profile_id: string;
  status: GuardJobStatus;
  started_at?: Date;
  completed_at?: Date;
  total_files_scanned: number;
  total_matches: number;
  error_message?: string;
  progress_percent: number;
  metadata: Record<string, unknown>;
}

// PII Job with profile details
export interface IGuardPiiJobWithProfile extends IGuardPiiJob {
  profile_name: string;
}

// PII Result
export interface IGuardPiiResult {
  id: string;
  tenant: string;
  job_id: string;
  profile_id: string;
  company_id: string;
  asset_id?: string;
  agent_id?: string;
  pii_type: GuardPiiType;
  file_path: string;
  line_numbers: number[];
  page_numbers?: number[];
  confidence: number;
  found_at: Date;
}

// PII Result with company details
export interface IGuardPiiResultWithDetails extends IGuardPiiResult {
  company_name: string;
  profile_name: string;
}

// PII Dashboard statistics
export interface IGuardPiiDashboardStats {
  total_profiles: number;
  active_profiles: number;
  total_scans: number;
  scans_last_30_days: number;
  total_findings: number;
  findings_last_30_days: number;
  findings_by_type: Record<GuardPiiType, number>;
  findings_by_company: Array<{
    company_id: string;
    company_name: string;
    count: number;
  }>;
  recent_scans: IGuardPiiJobWithProfile[];
}

// PII Scan request (to trigger a scan)
export interface IGuardPiiScanRequest {
  profile_id: string;
  target_agents?: string[];
}

// PII Scan response from extension
export interface IGuardPiiScanResponse {
  job_id: string;
  status: GuardJobStatus;
  total_files_scanned: number;
  total_matches: number;
  results: Array<{
    pii_type: GuardPiiType;
    file_path: string;
    line_numbers: number[];
    page_numbers?: number[];
    confidence: number;
  }>;
  errors?: string[];
}

// Pagination params
export interface IGuardPaginationParams {
  page?: number;
  page_size?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

// Profile list params
export interface IGuardPiiProfileListParams extends IGuardPaginationParams {
  enabled?: boolean;
  search?: string;
}

// Job list params
export interface IGuardPiiJobListParams extends IGuardPaginationParams {
  profile_id?: string;
  status?: GuardJobStatus;
  date_from?: Date;
  date_to?: Date;
}

// Result list params
export interface IGuardPiiResultListParams extends IGuardPaginationParams {
  job_id?: string;
  profile_id?: string;
  company_id?: string;
  pii_type?: GuardPiiType;
  date_from?: Date;
  date_to?: Date;
}

// Paginated response
export interface IGuardPaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}
