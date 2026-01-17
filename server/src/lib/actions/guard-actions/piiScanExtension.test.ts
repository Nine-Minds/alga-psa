/**
 * Unit tests for Alga Guard PII Scanner Extension Integration
 *
 * Tests the extension integration business logic including:
 * - Request/response encoding/decoding
 * - Request building
 * - Response parsing
 * - Result conversion
 * - Error categorization and retry logic
 */

import { describe, it, expect } from 'vitest';
import {
  encodePayload,
  decodePayload,
  buildPiiScanRequest,
  parsePiiScanResponse,
  convertMatchesToResults,
  categorizeError,
  shouldRetry,
  getRetryDelay,
  PII_SCANNER_EXTENSION,
  type ExtensionExecuteResponse,
  type PiiScanResponsePayload,
} from './piiScanExtension';
import type { GuardPiiType } from '@/interfaces/guard/pii.interfaces';

// ============================================================================
// Payload Encoding/Decoding Tests
// ============================================================================

describe('encodePayload', () => {
  it('should encode simple object to base64', () => {
    const payload = { foo: 'bar', num: 123 };
    const encoded = encodePayload(payload);

    // Verify it's valid by decoding
    const decoded = decodePayload<typeof payload>(encoded);
    expect(decoded).toEqual(payload);
  });

  it('should encode complex nested objects', () => {
    const payload = {
      job_id: 'test-123',
      profile_id: 'profile-456',
      pii_types: ['ssn', 'email'],
      nested: {
        deep: {
          value: 'test',
        },
      },
    };

    const encoded = encodePayload(payload);
    const decoded = decodePayload<typeof payload>(encoded);

    expect(decoded).toEqual(payload);
  });

  it('should handle special characters', () => {
    const payload = { text: 'Hello, 世界! 🚀' };
    const encoded = encodePayload(payload);
    const decoded = decodePayload<typeof payload>(encoded);

    expect(decoded.text).toBe('Hello, 世界! 🚀');
  });
});

describe('decodePayload', () => {
  it('should round-trip encode/decode', () => {
    const original = { test: 'value', array: [1, 2, 3] };
    const encoded = encodePayload(original);
    const decoded = decodePayload<typeof original>(encoded);
    expect(decoded).toEqual(original);
  });
});

// ============================================================================
// Request Building Tests
// ============================================================================

describe('buildPiiScanRequest', () => {
  const baseParams = {
    tenantId: 'tenant-123',
    installId: 'install-456',
    jobId: 'job-789',
    profileId: 'profile-abc',
    piiTypes: ['ssn', 'email'] as GuardPiiType[],
    fileExtensions: ['.txt', '.csv'],
    includePaths: ['/documents', '/data'],
    excludePaths: ['/tmp', '/cache'],
    maxFileSizeBytes: 50 * 1024 * 1024,
    maxFiles: 10000,
    contentHash: 'hash-xyz',
  };

  it('should build a valid request envelope', () => {
    const request = buildPiiScanRequest(baseParams);

    // Verify envelope structure
    expect(request.context).toBeDefined();
    expect(request.http).toBeDefined();
    expect(request.limits).toBeDefined();
  });

  it('should set correct context fields', () => {
    const request = buildPiiScanRequest(baseParams);

    expect(request.context.tenant_id).toBe('tenant-123');
    expect(request.context.install_id).toBe('install-456');
    expect(request.context.extension_id).toBe(PII_SCANNER_EXTENSION.id);
    expect(request.context.content_hash).toBe('hash-xyz');
    expect(request.context.trigger).toBe('http');
    expect(request.context.request_id).toContain('pii-scan-job-789');
  });

  it('should set correct HTTP method and path', () => {
    const request = buildPiiScanRequest(baseParams);

    expect(request.http.method).toBe('POST');
    expect(request.http.path).toBe('/scan');
  });

  it('should encode payload correctly', () => {
    const request = buildPiiScanRequest(baseParams);

    const payload = decodePayload<{
      job_id: string;
      profile_id: string;
      pii_types: string[];
      include_paths: string[];
      exclude_paths: string[];
    }>(request.http.body_b64);

    expect(payload.job_id).toBe('job-789');
    expect(payload.profile_id).toBe('profile-abc');
    expect(payload.pii_types).toEqual(['ssn', 'email']);
    expect(payload.include_paths).toEqual(['/documents', '/data']);
    expect(payload.exclude_paths).toEqual(['/tmp', '/cache']);
  });

  it('should use default timeout', () => {
    const request = buildPiiScanRequest(baseParams);

    expect(request.limits.timeout_ms).toBe(PII_SCANNER_EXTENSION.default_timeout_ms);
    expect(request.limits.memory_mb).toBe(PII_SCANNER_EXTENSION.max_memory_mb);
  });

  it('should respect custom timeout', () => {
    const request = buildPiiScanRequest({
      ...baseParams,
      timeoutMs: 60000,
    });

    expect(request.limits.timeout_ms).toBe(60000);
  });

  it('should include custom config', () => {
    const request = buildPiiScanRequest({
      ...baseParams,
      config: { customKey: 'customValue' },
    });

    expect(request.context.config).toEqual({ customKey: 'customValue' });
  });
});

// ============================================================================
// Response Parsing Tests
// ============================================================================

describe('parsePiiScanResponse', () => {
  const successPayload: PiiScanResponsePayload = {
    job_id: 'job-123',
    status: 'completed',
    started_at: '2024-01-15T10:00:00Z',
    completed_at: '2024-01-15T10:05:00Z',
    agent_id: 'agent-456',
    company_id: 'company-789',
    stats: {
      total_files_found: 100,
      total_files_scanned: 95,
      total_files_skipped: 5,
      total_bytes_scanned: 1024000,
      skipped_reasons: { 'too_large': 3, 'binary': 2 },
    },
    matches: [
      {
        pii_type: 'ssn',
        file_path: '/docs/employee.txt',
        line_numbers: [10, 25],
        confidence: 0.95,
        match_count: 2,
      },
    ],
  };

  it('should parse successful response', () => {
    const response: ExtensionExecuteResponse = {
      status: 200,
      body_b64: encodePayload(successPayload),
    };

    const result = parsePiiScanResponse(response);

    expect(result.success).toBe(true);
    expect(result.payload).toBeDefined();
    expect(result.payload?.job_id).toBe('job-123');
    expect(result.payload?.status).toBe('completed');
    expect(result.payload?.matches.length).toBe(1);
  });

  it('should handle response with error field', () => {
    const response: ExtensionExecuteResponse = {
      status: 500,
      body_b64: '',
      error: 'Internal server error',
    };

    const result = parsePiiScanResponse(response);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Internal server error');
  });

  it('should handle 4xx errors', () => {
    const response: ExtensionExecuteResponse = {
      status: 404,
      body_b64: encodePayload({ error: 'Extension not found' }),
    };

    const result = parsePiiScanResponse(response);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Extension not found');
  });

  it('should extract execution time if provided', () => {
    const response: ExtensionExecuteResponse = {
      status: 200,
      body_b64: encodePayload(successPayload),
      execution_time_ms: 5000,
    };

    const result = parsePiiScanResponse(response);

    expect(result.success).toBe(true);
  });
});

// ============================================================================
// Result Conversion Tests
// ============================================================================

describe('convertMatchesToResults', () => {
  const samplePayload: PiiScanResponsePayload = {
    job_id: 'job-123',
    status: 'completed',
    started_at: '2024-01-15T10:00:00Z',
    completed_at: '2024-01-15T10:05:00Z',
    agent_id: 'agent-456',
    company_id: 'company-789',
    stats: {
      total_files_found: 50,
      total_files_scanned: 50,
      total_files_skipped: 0,
      total_bytes_scanned: 512000,
      skipped_reasons: {},
    },
    matches: [
      {
        pii_type: 'ssn',
        file_path: '/docs/employees.csv',
        line_numbers: [5, 12, 18],
        confidence: 0.95,
        match_count: 3,
      },
      {
        pii_type: 'credit_card',
        file_path: '/docs/payments.xlsx',
        line_numbers: [2],
        page_numbers: [1],
        confidence: 0.98,
        match_count: 1,
      },
    ],
  };

  it('should convert matches to result records', () => {
    const results = convertMatchesToResults(samplePayload, 'tenant-abc', 'profile-xyz');

    expect(results.length).toBe(2);

    // First match
    expect(results[0].tenant).toBe('tenant-abc');
    expect(results[0].job_id).toBe('job-123');
    expect(results[0].profile_id).toBe('profile-xyz');
    expect(results[0].company_id).toBe('company-789');
    expect(results[0].agent_id).toBe('agent-456');
    expect(results[0].pii_type).toBe('ssn');
    expect(results[0].file_path).toBe('/docs/employees.csv');
    expect(results[0].line_numbers).toEqual([5, 12, 18]);
    expect(results[0].confidence).toBe(0.95);

    // Second match
    expect(results[1].pii_type).toBe('credit_card');
    expect(results[1].page_numbers).toEqual([1]);
  });

  it('should handle empty matches', () => {
    const emptyPayload: PiiScanResponsePayload = {
      ...samplePayload,
      matches: [],
    };

    const results = convertMatchesToResults(emptyPayload, 'tenant-abc', 'profile-xyz');

    expect(results).toEqual([]);
  });

  it('should handle matches without page numbers', () => {
    const results = convertMatchesToResults(samplePayload, 'tenant-abc', 'profile-xyz');

    expect(results[0].page_numbers).toBeUndefined();
  });
});

// ============================================================================
// Error Categorization Tests
// ============================================================================

describe('categorizeError', () => {
  it('should identify agent offline errors', () => {
    expect(categorizeError({
      status: 503,
      body_b64: '',
      error: 'Agent is offline',
    })).toBe('AGENT_OFFLINE');

    expect(categorizeError({
      status: 503,
      body_b64: '',
      error: 'Agent unreachable',
    })).toBe('AGENT_OFFLINE');
  });

  it('should identify timeout errors', () => {
    expect(categorizeError({
      status: 504,
      body_b64: '',
    })).toBe('TIMEOUT');

    expect(categorizeError({
      status: 408,
      body_b64: '',
      error: 'Request timeout',
    })).toBe('TIMEOUT');
  });

  it('should identify extension not found errors', () => {
    expect(categorizeError({
      status: 404,
      body_b64: '',
    })).toBe('EXTENSION_NOT_FOUND');
  });

  it('should identify permission denied errors', () => {
    expect(categorizeError({
      status: 403,
      body_b64: '',
    })).toBe('PERMISSION_DENIED');
  });

  it('should identify invalid request errors', () => {
    expect(categorizeError({
      status: 400,
      body_b64: '',
    })).toBe('INVALID_REQUEST');
  });

  it('should identify execution errors', () => {
    expect(categorizeError({
      status: 500,
      body_b64: '',
    })).toBe('EXECUTION_ERROR');

    expect(categorizeError({
      status: 502,
      body_b64: '',
    })).toBe('EXECUTION_ERROR');
  });

  it('should return unknown for other errors', () => {
    expect(categorizeError({
      status: 418, // I'm a teapot
      body_b64: '',
    })).toBe('UNKNOWN');
  });
});

// ============================================================================
// Retry Logic Tests
// ============================================================================

describe('shouldRetry', () => {
  it('should retry on agent offline', () => {
    expect(shouldRetry('AGENT_OFFLINE')).toBe(true);
  });

  it('should retry on timeout', () => {
    expect(shouldRetry('TIMEOUT')).toBe(true);
  });

  it('should not retry on other errors', () => {
    expect(shouldRetry('EXTENSION_NOT_FOUND')).toBe(false);
    expect(shouldRetry('PERMISSION_DENIED')).toBe(false);
    expect(shouldRetry('INVALID_REQUEST')).toBe(false);
    expect(shouldRetry('EXECUTION_ERROR')).toBe(false);
    expect(shouldRetry('UNKNOWN')).toBe(false);
  });
});

describe('getRetryDelay', () => {
  it('should use longer base delay for agent offline', () => {
    const offlineDelay = getRetryDelay('AGENT_OFFLINE', 1);
    const timeoutDelay = getRetryDelay('TIMEOUT', 1);

    // Agent offline should have longer delay
    expect(offlineDelay).toBeGreaterThan(timeoutDelay);
  });

  it('should increase delay exponentially', () => {
    const delay1 = getRetryDelay('TIMEOUT', 1);
    const delay2 = getRetryDelay('TIMEOUT', 2);
    const delay3 = getRetryDelay('TIMEOUT', 3);

    // Each attempt should have roughly double delay (with jitter)
    expect(delay2).toBeGreaterThan(delay1 * 1.5);
    expect(delay3).toBeGreaterThan(delay2 * 1.5);
  });

  it('should cap delay at max', () => {
    const maxDelay = 300000; // 5 minutes
    const delay = getRetryDelay('AGENT_OFFLINE', 10);

    expect(delay).toBeLessThanOrEqual(maxDelay);
  });

  it('should add jitter', () => {
    // Run multiple times to verify jitter (delays should vary slightly)
    const delays = Array.from({ length: 10 }, () => getRetryDelay('TIMEOUT', 1));
    const uniqueDelays = new Set(delays);

    // With jitter, we should have mostly unique values
    expect(uniqueDelays.size).toBeGreaterThan(1);
  });
});

// ============================================================================
// Extension Configuration Tests
// ============================================================================

describe('PII_SCANNER_EXTENSION', () => {
  it('should have correct extension ID', () => {
    expect(PII_SCANNER_EXTENSION.id).toBe('alga-guard-pii-scanner');
  });

  it('should have reasonable timeout', () => {
    expect(PII_SCANNER_EXTENSION.default_timeout_ms).toBe(300000); // 5 minutes
  });

  it('should have reasonable memory limit', () => {
    expect(PII_SCANNER_EXTENSION.max_memory_mb).toBe(512);
  });

  it('should require file system capabilities', () => {
    expect(PII_SCANNER_EXTENSION.capabilities).toContain('fs.read');
    expect(PII_SCANNER_EXTENSION.capabilities).toContain('fs.walk');
    expect(PII_SCANNER_EXTENSION.capabilities).toContain('fs.metadata');
  });

  it('should require context and logging capabilities', () => {
    expect(PII_SCANNER_EXTENSION.capabilities).toContain('context.read');
    expect(PII_SCANNER_EXTENSION.capabilities).toContain('log.emit');
  });
});
