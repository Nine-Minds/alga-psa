/**
 * Alga Guard - Attack Surface Mapper (ASM) Interfaces
 */

import type { GuardJobStatus } from './pii.interfaces';

// ASM Result Types
export type GuardAsmResultType =
  | 'subdomain'
  | 'ip_address'
  | 'open_port'
  | 'service'
  | 'cve'
  | 'dns_record'
  | 'http_header'
  | 'cloud_storage'
  | 'email_security';

// ASM Domain
export interface IGuardAsmDomain {
  id: string;
  tenant: string;
  company_id: string;
  domain_name: string;
  ownership_verified: boolean;
  last_scanned_at?: Date;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
  created_by?: string;
}

// ASM Domain with company details
export interface IGuardAsmDomainWithCompany extends IGuardAsmDomain {
  company_name: string;
}

// ASM Domain creation request
export interface ICreateAsmDomainRequest {
  company_id: string;
  domain_name: string;
  ownership_verified?: boolean;
  enabled?: boolean;
}

// ASM Domain update request
export interface IUpdateAsmDomainRequest {
  domain_name?: string;
  ownership_verified?: boolean;
  enabled?: boolean;
}

// ASM Job
export interface IGuardAsmJob {
  id: string;
  tenant: string;
  domain_id: string;
  status: GuardJobStatus;
  scanner_pod_id?: string;
  started_at?: Date;
  completed_at?: Date;
  error_message?: string;
  summary: Record<string, unknown>;
}

// ASM Job with domain details
export interface IGuardAsmJobWithDomain extends IGuardAsmJob {
  domain_name: string;
  company_id: string;
  company_name: string;
}

// ASM Result
export interface IGuardAsmResult {
  id: string;
  tenant: string;
  job_id: string;
  domain_id: string;
  result_type: GuardAsmResultType;
  data: Record<string, unknown>;
  severity?: string;
  found_at: Date;
}

// Specific result data shapes
export interface ISubdomainData {
  subdomain: string;
  resolved_ips?: string[];
  first_seen: string;
  source: string; // e.g., 'dns_enumeration', 'certificate_transparency'
}

export interface IIpAddressData {
  ip: string;
  hostname?: string;
  geolocation?: {
    country: string;
    city?: string;
    latitude?: number;
    longitude?: number;
  };
  asn?: {
    number: number;
    name: string;
  };
}

export interface IOpenPortData {
  ip: string;
  port: number;
  protocol: 'tcp' | 'udp';
  service?: string;
  version?: string;
  banner?: string;
}

export interface ICveData {
  cve_id: string;
  description: string;
  cvss_score?: number;
  cvss_version?: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  epss_score?: number;
  affected_service?: string;
  affected_port?: number;
  references?: string[];
}

export interface IDnsRecordData {
  record_type: 'A' | 'AAAA' | 'MX' | 'TXT' | 'NS' | 'CNAME' | 'SOA' | 'PTR';
  name: string;
  value: string;
  ttl?: number;
}

export interface IHttpHeaderData {
  url: string;
  headers: Record<string, string>;
  missing_security_headers?: string[];
  status_code?: number;
}

export interface ICloudStorageData {
  provider: 'aws_s3' | 'azure_blob' | 'gcp_storage';
  bucket_name: string;
  is_public: boolean;
  url: string;
}

export interface IEmailSecurityData {
  domain: string;
  spf_record?: string;
  spf_valid: boolean;
  dkim_selector?: string;
  dkim_valid: boolean;
  dmarc_record?: string;
  dmarc_policy?: 'none' | 'quarantine' | 'reject';
}

// ASM Dashboard statistics
export interface IGuardAsmDashboardStats {
  total_domains: number;
  active_domains: number;
  total_scans: number;
  scans_last_30_days: number;
  total_findings: number;
  findings_by_type: Record<GuardAsmResultType, number>;
  findings_by_severity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  findings_by_company: Array<{
    company_id: string;
    company_name: string;
    count: number;
  }>;
  recent_scans: IGuardAsmJobWithDomain[];
  critical_cves: ICveData[];
}

// Scanner pod info
export interface IScannerPodInfo {
  pod_id: string;
  ip_address: string;
  region: string;
  status: 'active' | 'inactive';
  last_heartbeat: Date;
}

// Pagination params (shared with PII)
export interface IGuardAsmPaginationParams {
  page?: number;
  page_size?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

// Domain list params
export interface IGuardAsmDomainListParams extends IGuardAsmPaginationParams {
  company_id?: string;
  enabled?: boolean;
  search?: string;
}

// Job list params
export interface IGuardAsmJobListParams extends IGuardAsmPaginationParams {
  domain_id?: string;
  status?: GuardJobStatus;
  date_from?: Date;
  date_to?: Date;
}

// Result list params
export interface IGuardAsmResultListParams extends IGuardAsmPaginationParams {
  job_id?: string;
  domain_id?: string;
  result_type?: GuardAsmResultType;
  severity?: string;
}

// Paginated response (same structure as PII)
export interface IGuardAsmPaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}
