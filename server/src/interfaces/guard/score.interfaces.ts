/**
 * Alga Guard - Security Score Interfaces
 */

import type { GuardPiiType } from './pii.interfaces';
import type { GuardAsmResultType } from './asm.interfaces';

// Risk level thresholds
export type GuardRiskLevel = 'critical' | 'high' | 'moderate' | 'low';

// Score breakdown categories
export type GuardScoreCategory = 'pii' | 'vulnerabilities' | 'exposure' | 'email_security';

// Security Score
export interface IGuardSecurityScore {
  id: string;
  tenant: string;
  company_id: string;
  score: number;  // 0-100
  risk_level: GuardRiskLevel;
  pii_penalty: number;
  asm_penalty: number;
  breakdown: IGuardScoreBreakdown;
  top_issues: IGuardScoreIssue[];
  last_calculated_at: Date;
  created_at: Date;
  updated_at: Date;
}

// Security Score with company details
export interface IGuardSecurityScoreWithCompany extends IGuardSecurityScore {
  company_name: string;
}

// Score breakdown by category
export interface IGuardScoreBreakdown {
  pii: ICategoryBreakdown;
  vulnerabilities: ICategoryBreakdown;
  exposure: ICategoryBreakdown;
  email_security: ICategoryBreakdown;
}

// Category breakdown details
export interface ICategoryBreakdown {
  penalty: number;
  count: number;
  details: Record<string, number>;  // Type -> count
}

// Individual issue impacting score
export interface IGuardScoreIssue {
  type: 'pii' | 'cve' | 'port' | 'cloud_storage' | 'email_security';
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  impact: number;  // Points deducted
  resource_id?: string;  // Reference to PII result or ASM result
  details?: Record<string, unknown>;
}

// Score history entry
export interface IGuardScoreHistory {
  id: string;
  tenant: string;
  company_id: string;
  score: number;
  risk_level: GuardRiskLevel;
  pii_penalty: number;
  asm_penalty: number;
  delta: number;  // Change from previous score
  triggered_by: 'pii_scan' | 'asm_scan' | 'manual' | 'scheduled';
  triggered_job_id?: string;
  calculated_at: Date;
}

// What-if simulation request
export interface IWhatIfSimulationRequest {
  remove_pii_results?: string[];  // IDs of PII results to simulate removing
  remove_asm_results?: string[];  // IDs of ASM results to simulate removing
  hypothetical_fixes?: IHypotheticalFix[];
}

// Hypothetical fix for what-if simulation
export interface IHypotheticalFix {
  type: 'pii' | 'cve' | 'port' | 'cloud_storage' | 'email_security';
  count?: number;  // Number of issues to remove
  specific_id?: string;  // Or specific result ID
  severity?: string;  // Filter by severity
}

// What-if simulation response
export interface IWhatIfSimulationResponse {
  current_score: number;
  projected_score: number;
  score_improvement: number;
  current_risk_level: GuardRiskLevel;
  projected_risk_level: GuardRiskLevel;
  fixes_applied: Array<{
    type: string;
    count: number;
    impact: number;
  }>;
}

// PII Severity Weights (from PRD)
export const PII_SEVERITY_WEIGHTS: Record<GuardPiiType, number> = {
  ssn: 10,
  credit_card: 10,
  bank_account: 8,
  dob: 5,
  drivers_license: 5,
  passport: 5,
  phone: 2,
  email: 1,
  ip_address: 1,
  mac_address: 1,
  person_name: 3,   // LLM NER detected
  address: 4,       // LLM NER detected
};

// CVE Severity Weights (from PRD)
export const CVE_SEVERITY_WEIGHTS: Record<string, number> = {
  critical: 15,
  high: 10,
  medium: 5,
  low: 2,
};

// Port Risk Weights (from PRD)
export const PORT_RISK_WEIGHTS: Record<number, number> = {
  3389: 12,  // RDP
  23: 12,    // Telnet
  21: 8,     // FTP
  445: 8,    // SMB
  22: 5,     // SSH
  80: 0,     // HTTP
  443: 0,    // HTTPS
};

// High-risk ports (for detection)
export const HIGH_RISK_PORTS = [3389, 23, 21, 445, 139, 5900, 1433, 3306, 5432, 27017];

// Cloud Storage Exposure Weights (from PRD)
export const CLOUD_STORAGE_WEIGHTS: Record<string, number> = {
  aws_s3: 10,
  azure_blob: 10,
  gcp_storage: 10,
};

// Email Security Weights (from PRD)
export const EMAIL_SECURITY_WEIGHTS = {
  missing_spf: 3,
  missing_dmarc: 3,
  missing_dkim: 2,
};

// Risk Level Thresholds (from PRD)
export const RISK_LEVEL_THRESHOLDS: Record<GuardRiskLevel, { min: number; max: number }> = {
  critical: { min: 0, max: 39 },
  high: { min: 40, max: 59 },
  moderate: { min: 60, max: 79 },
  low: { min: 80, max: 100 },
};

// Decay factor for multiple instances of same PII type
export const PII_DECAY_FACTOR = 0.8;

// Maximum penalty cap per category
export const MAX_PII_PENALTY = 50;
export const MAX_ASM_PENALTY = 50;

// Score calculation input (internal use)
export interface IScoreCalculationInput {
  tenant: string;
  company_id: string;
  pii_results: Array<{
    pii_type: GuardPiiType;
    count: number;
  }>;
  asm_results: {
    cves: Array<{
      severity: string;
      count: number;
    }>;
    open_ports: Array<{
      port: number;
      count: number;
    }>;
    cloud_storage: Array<{
      provider: string;
      is_public: boolean;
    }>;
    email_security: Array<{
      spf_valid: boolean;
      dkim_valid: boolean;
      dmarc_policy: string | null;
    }>;
  };
}

// Score calculation result (internal use)
export interface IScoreCalculationResult {
  score: number;
  risk_level: GuardRiskLevel;
  pii_penalty: number;
  asm_penalty: number;
  breakdown: IGuardScoreBreakdown;
  top_issues: IGuardScoreIssue[];
}

// Score list params
export interface IGuardScoreListParams {
  page?: number;
  page_size?: number;
  sort_by?: 'score' | 'company_name' | 'last_calculated_at';
  sort_order?: 'asc' | 'desc';
  risk_level?: GuardRiskLevel;
  min_score?: number;
  max_score?: number;
}

// Score history list params
export interface IGuardScoreHistoryListParams {
  page?: number;
  page_size?: number;
  date_from?: Date;
  date_to?: Date;
}

// Paginated response (consistent with other modules)
export interface IGuardScorePaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// Portfolio summary (for MSP dashboard)
export interface IGuardPortfolioSummary {
  total_companies: number;
  average_score: number;
  risk_distribution: Record<GuardRiskLevel, number>;
  score_trend: Array<{
    date: string;
    average_score: number;
  }>;
  worst_performers: Array<{
    company_id: string;
    company_name: string;
    score: number;
    risk_level: GuardRiskLevel;
  }>;
  most_improved: Array<{
    company_id: string;
    company_name: string;
    score_change: number;
    current_score: number;
  }>;
}
