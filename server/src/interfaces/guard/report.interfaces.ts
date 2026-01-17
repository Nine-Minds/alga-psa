/**
 * Alga Guard - Report Interfaces
 */

import type { GuardJobStatus } from './pii.interfaces';

// Report type
export type GuardReportType = 'pii' | 'asm' | 'security_score' | 'combined';

// Report format
export type GuardReportFormat = 'docx' | 'xlsx' | 'pdf';

// Guard Report Job
export interface IGuardReportJob {
  id: string;
  tenant: string;
  name: string;
  report_type: GuardReportType;
  format: GuardReportFormat;
  status: GuardJobStatus;
  company_id?: string;  // Optional filter by company
  date_from?: Date;
  date_to?: Date;
  file_path?: string;  // Path to generated report
  file_size?: number;  // Size in bytes
  started_at?: Date;
  completed_at?: Date;
  error_message?: string;
  created_at: Date;
  created_by?: string;
}

// Report job with company details
export interface IGuardReportJobWithCompany extends IGuardReportJob {
  company_name?: string;
}

// Create report request
export interface ICreateReportRequest {
  name: string;
  report_type: GuardReportType;
  format: GuardReportFormat;
  company_id?: string;
  date_from?: string;  // ISO date string
  date_to?: string;    // ISO date string
}

// Report list params
export interface IGuardReportListParams {
  page?: number;
  page_size?: number;
  sort_by?: 'created_at' | 'name' | 'status';
  sort_order?: 'asc' | 'desc';
  report_type?: GuardReportType;
  status?: GuardJobStatus;
}

// Paginated response
export interface IGuardReportPaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// PII Report Data (for document generation)
export interface IPiiReportData {
  generated_at: Date;
  date_range?: {
    from: Date;
    to: Date;
  };
  company?: {
    id: string;
    name: string;
  };
  summary: {
    total_profiles: number;
    total_scans: number;
    total_findings: number;
    findings_by_type: Record<string, number>;
  };
  findings: Array<{
    pii_type: string;
    file_path: string;
    company_name: string;
    found_at: Date;
    line_numbers: number[];
    confidence: number;
  }>;
  scans: Array<{
    profile_name: string;
    started_at: Date;
    completed_at?: Date;
    status: string;
    total_files_scanned: number;
    total_matches: number;
  }>;
}

// ASM Report Data (for document generation)
export interface IAsmReportData {
  generated_at: Date;
  date_range?: {
    from: Date;
    to: Date;
  };
  company?: {
    id: string;
    name: string;
  };
  summary: {
    total_domains: number;
    total_scans: number;
    total_findings: number;
    findings_by_type: Record<string, number>;
    findings_by_severity: Record<string, number>;
  };
  domains: Array<{
    domain_name: string;
    company_name: string;
    last_scanned_at?: Date;
    finding_count: number;
    critical_count: number;
    high_count: number;
  }>;
  cves: Array<{
    cve_id: string;
    severity: string;
    cvss_score?: number;
    domain_name: string;
    description?: string;
    found_at: Date;
  }>;
  open_ports: Array<{
    port: number;
    service?: string;
    ip_address: string;
    domain_name: string;
    found_at: Date;
  }>;
}

// Security Score Report Data (for document generation)
export interface ISecurityScoreReportData {
  generated_at: Date;
  company: {
    id: string;
    name: string;
  };
  current_score: {
    score: number;
    risk_level: string;
    pii_penalty: number;
    asm_penalty: number;
  };
  breakdown: {
    pii: { penalty: number; count: number; details: Record<string, number> };
    vulnerabilities: { penalty: number; count: number; details: Record<string, number> };
    exposure: { penalty: number; count: number; details: Record<string, number> };
    email_security: { penalty: number; count: number; details: Record<string, number> };
  };
  top_issues: Array<{
    type: string;
    severity: string;
    description: string;
    impact: number;
  }>;
  history: Array<{
    score: number;
    risk_level: string;
    delta: number;
    calculated_at: Date;
  }>;
  recommendations: string[];
}

// File types for downloads
export const REPORT_MIME_TYPES: Record<GuardReportFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

// File extensions
export const REPORT_EXTENSIONS: Record<GuardReportFormat, string> = {
  docx: '.docx',
  xlsx: '.xlsx',
  pdf: '.pdf',
};
