'use server';

/**
 * Alga Guard - PII Scanner Extension Integration
 *
 * Defines the schemas and handlers for PII scanning via the Extension Runner.
 * The PII Scanner runs as a WASM extension on the Endpoint Agent.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

import type { GuardPiiType, IGuardPiiResult } from '@/interfaces/guard/pii.interfaces';

// Node.js Buffer for base64 encoding/decoding
const NodeBuffer = require('buffer').Buffer;

// ============================================================================
// Extension Runner Schemas (F077-F080)
// ============================================================================

/**
 * Extension execution request envelope
 * Sent to the Extension Runner's /v1/execute endpoint
 */
export interface ExtensionExecuteRequest {
  context: {
    request_id: string;
    tenant_id: string;
    extension_id: string;
    install_id: string;
    content_hash: string;
    config: Record<string, string>;
    trigger: 'schedule' | 'http';
  };
  http: {
    method: 'POST';
    path: string;
    body_b64: string; // Base64-encoded JSON payload
    headers?: Record<string, string>;
  };
  limits: {
    timeout_ms: number;
    memory_mb?: number;
  };
}

/**
 * Extension execution response envelope
 * Returned from the Extension Runner
 */
export interface ExtensionExecuteResponse {
  status: number;
  body_b64: string; // Base64-encoded JSON payload
  headers?: Record<string, string>;
  error?: string;
  execution_time_ms?: number;
}

/**
 * PII Scan Request Payload (encoded in body_b64)
 * Defines what and how to scan
 */
export interface PiiScanRequestPayload {
  job_id: string;
  profile_id: string;
  pii_types: GuardPiiType[];
  file_extensions: string[];
  include_paths: string[];
  exclude_paths: string[];
  max_file_size_bytes: number;
  max_files: number;
  scan_options?: {
    context_window?: number;
    max_matches_per_file?: number;
    skip_binary_files?: boolean;
  };
}

/**
 * PII Match found by scanner
 */
export interface PiiMatchResult {
  pii_type: GuardPiiType;
  file_path: string;
  line_numbers: number[];
  page_numbers?: number[];
  confidence: number;
  match_count: number;
}

/**
 * File scan statistics
 */
export interface FileScanStats {
  total_files_found: number;
  total_files_scanned: number;
  total_files_skipped: number;
  total_bytes_scanned: number;
  skipped_reasons: Record<string, number>;
}

/**
 * PII Scan Response Payload (encoded in body_b64)
 * Results from the scanner
 */
export interface PiiScanResponsePayload {
  job_id: string;
  status: 'completed' | 'partial' | 'failed';
  started_at: string; // ISO timestamp
  completed_at: string; // ISO timestamp
  agent_id: string;
  company_id: string;
  stats: FileScanStats;
  matches: PiiMatchResult[];
  errors?: string[];
}

// ============================================================================
// Extension Configuration
// ============================================================================

export const PII_SCANNER_EXTENSION = {
  id: 'alga-guard-pii-scanner',
  name: 'Alga Guard PII Scanner',
  version: '1.0.0',
  capabilities: ['fs.read', 'fs.walk', 'fs.metadata', 'context.read', 'log.emit'],
  default_timeout_ms: 300000, // 5 minutes
  max_memory_mb: 512,
};

// ============================================================================
// Request/Response Encoding Utilities
// ============================================================================

/**
 * Encode a payload object to base64 for body_b64
 */
export function encodePayload<T>(payload: T): string {
  const jsonStr = JSON.stringify(payload);
  return NodeBuffer.from(jsonStr, 'utf-8').toString('base64');
}

/**
 * Decode a base64 body_b64 to a payload object
 */
export function decodePayload<T>(base64: string): T {
  const jsonStr = NodeBuffer.from(base64, 'base64').toString('utf-8');
  return JSON.parse(jsonStr) as T;
}

// ============================================================================
// Request Builder (F082)
// ============================================================================

/**
 * Build an ExtensionExecuteRequest for a PII scan
 */
export function buildPiiScanRequest(params: {
  tenantId: string;
  installId: string;
  jobId: string;
  profileId: string;
  piiTypes: GuardPiiType[];
  fileExtensions: string[];
  includePaths: string[];
  excludePaths: string[];
  maxFileSizeBytes: number;
  maxFiles: number;
  contentHash: string;
  config?: Record<string, string>;
  timeoutMs?: number;
}): ExtensionExecuteRequest {
  const requestId = `pii-scan-${params.jobId}-${Date.now()}`;

  const scanPayload: PiiScanRequestPayload = {
    job_id: params.jobId,
    profile_id: params.profileId,
    pii_types: params.piiTypes,
    file_extensions: params.fileExtensions,
    include_paths: params.includePaths,
    exclude_paths: params.excludePaths,
    max_file_size_bytes: params.maxFileSizeBytes,
    max_files: params.maxFiles,
    scan_options: {
      context_window: 50,
      max_matches_per_file: 1000,
      skip_binary_files: true,
    },
  };

  return {
    context: {
      request_id: requestId,
      tenant_id: params.tenantId,
      extension_id: PII_SCANNER_EXTENSION.id,
      install_id: params.installId,
      content_hash: params.contentHash,
      config: params.config ?? {},
      trigger: 'http',
    },
    http: {
      method: 'POST',
      path: '/scan',
      body_b64: encodePayload(scanPayload),
    },
    limits: {
      timeout_ms: params.timeoutMs ?? PII_SCANNER_EXTENSION.default_timeout_ms,
      memory_mb: PII_SCANNER_EXTENSION.max_memory_mb,
    },
  };
}

// ============================================================================
// Response Parser (F083)
// ============================================================================

/**
 * Parse an ExtensionExecuteResponse to PII scan results
 */
export function parsePiiScanResponse(response: ExtensionExecuteResponse): {
  success: boolean;
  payload?: PiiScanResponsePayload;
  error?: string;
} {
  if (response.error) {
    return {
      success: false,
      error: response.error,
    };
  }

  if (response.status >= 400) {
    try {
      const errorPayload = decodePayload<{ error: string }>(response.body_b64);
      return {
        success: false,
        error: errorPayload.error || `HTTP ${response.status}`,
      };
    } catch {
      return {
        success: false,
        error: `HTTP ${response.status}`,
      };
    }
  }

  try {
    const payload = decodePayload<PiiScanResponsePayload>(response.body_b64);
    return {
      success: true,
      payload,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to decode response: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

// ============================================================================
// Result Conversion (F083)
// ============================================================================

/**
 * Convert PII scan matches to database result records
 */
export function convertMatchesToResults(
  payload: PiiScanResponsePayload,
  tenantId: string,
  profileId: string,
): Omit<IGuardPiiResult, 'id' | 'found_at'>[] {
  return payload.matches.map(match => ({
    tenant: tenantId,
    job_id: payload.job_id,
    profile_id: profileId,
    company_id: payload.company_id,
    agent_id: payload.agent_id,
    pii_type: match.pii_type,
    file_path: match.file_path,
    line_numbers: match.line_numbers,
    page_numbers: match.page_numbers,
    confidence: match.confidence,
  }));
}

// ============================================================================
// Error Types (F085, F086)
// ============================================================================

export type PiiScanErrorType =
  | 'AGENT_OFFLINE'
  | 'TIMEOUT'
  | 'EXTENSION_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'INVALID_REQUEST'
  | 'EXECUTION_ERROR'
  | 'UNKNOWN';

/**
 * Categorize an error response
 */
export function categorizeError(response: ExtensionExecuteResponse): PiiScanErrorType {
  if (response.error?.includes('offline') || response.error?.includes('unreachable')) {
    return 'AGENT_OFFLINE';
  }
  if (response.error?.includes('timeout') || response.status === 504) {
    return 'TIMEOUT';
  }
  if (response.status === 404) {
    return 'EXTENSION_NOT_FOUND';
  }
  if (response.status === 403) {
    return 'PERMISSION_DENIED';
  }
  if (response.status === 400) {
    return 'INVALID_REQUEST';
  }
  if (response.status >= 500) {
    return 'EXECUTION_ERROR';
  }
  return 'UNKNOWN';
}

/**
 * Determine if an error should trigger a retry
 */
export function shouldRetry(errorType: PiiScanErrorType): boolean {
  return errorType === 'AGENT_OFFLINE' || errorType === 'TIMEOUT';
}

/**
 * Get suggested retry delay based on error type
 */
export function getRetryDelay(errorType: PiiScanErrorType, attemptNumber: number): number {
  const baseDelay = errorType === 'AGENT_OFFLINE' ? 60000 : 30000; // 1 min or 30 sec
  const maxDelay = 300000; // 5 minutes max

  // Exponential backoff with jitter
  const exponentialDelay = baseDelay * Math.pow(2, attemptNumber - 1);
  const jitter = Math.random() * 0.3 * exponentialDelay;

  return Math.min(exponentialDelay + jitter, maxDelay);
}
