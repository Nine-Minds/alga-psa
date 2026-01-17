import logger from '@shared/core/logger';
import { getAdminConnection } from '@shared/db/admin';

import type { BaseJobData } from '../interfaces';
import {
  buildPiiScanRequest,
  parsePiiScanResponse,
  convertMatchesToResults,
  categorizeError,
  shouldRetry,
  getRetryDelay,
  PII_SCANNER_EXTENSION,
} from '../../actions/guard-actions/piiScanExtension';
import type { GuardPiiType } from '../../../interfaces/guard/pii.interfaces';

/**
 * Job data for guard:pii:scan jobs
 */
export interface GuardPiiScanJobData extends BaseJobData {
  jobId: string;
  profileId: string;
  // targetAgents is stored in job metadata but not directly used in this handler
  // The extension runner handles targeting based on install configuration
}

function safeString(val: unknown): string {
  return typeof val === 'string' ? val : String(val ?? '');
}

function normalizeSha256(value: string): string {
  const v = value.trim();
  if (!v) return '';
  if (v.startsWith('sha256:')) return v;
  return `sha256:${v}`;
}

async function readResponseTextWithLimit(
  resp: { text: () => Promise<string> },
  maxBytes: number
): Promise<string> {
  const raw = await resp.text();
  if (Number.isFinite(maxBytes) && maxBytes > 0) {
    const bytes = Buffer.byteLength(raw, 'utf8');
    if (bytes > maxBytes) {
      throw new Error(`Runner response too large (${bytes} bytes; max ${maxBytes})`);
    }
  }
  return raw;
}

/**
 * Update PII job status in the database
 */
async function updateJobStatus(
  db: any,
  tenantId: string,
  jobId: string,
  status: string,
  updates: {
    total_files_scanned?: number;
    total_matches?: number;
    progress_percent?: number;
    error_message?: string;
    metadata?: Record<string, unknown>;
  } = {}
): Promise<void> {
  const updateData: Record<string, unknown> = { status };

  if (status === 'running' && !updates.error_message) {
    updateData.started_at = db.fn.now();
  }

  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    updateData.completed_at = db.fn.now();
  }

  if (updates.total_files_scanned !== undefined) {
    updateData.total_files_scanned = updates.total_files_scanned;
  }
  if (updates.total_matches !== undefined) {
    updateData.total_matches = updates.total_matches;
  }
  if (updates.progress_percent !== undefined) {
    updateData.progress_percent = updates.progress_percent;
  }
  if (updates.error_message !== undefined) {
    updateData.error_message = updates.error_message;
  }
  if (updates.metadata !== undefined) {
    updateData.metadata = JSON.stringify(updates.metadata);
  }

  await db('guard_pii_jobs')
    .where({ tenant: tenantId, id: jobId })
    .update(updateData);
}

/**
 * Store PII scan results in the database
 */
async function storeResults(
  db: any,
  tenantId: string,
  jobId: string,
  results: Array<{
    tenant: string;
    job_id: string;
    profile_id: string;
    company_id: string;
    agent_id?: string;
    pii_type: string;
    file_path: string;
    line_numbers?: number[];
    page_numbers?: number[];
    confidence: number;
  }>
): Promise<number> {
  if (results.length === 0) {
    return 0;
  }

  // Insert results in batches to avoid hitting query size limits
  const batchSize = 100;
  let inserted = 0;

  for (let i = 0; i < results.length; i += batchSize) {
    const batch = results.slice(i, i + batchSize).map((r) => ({
      tenant: tenantId,
      job_id: jobId,
      profile_id: r.profile_id,
      company_id: r.company_id,
      agent_id: r.agent_id,
      pii_type: r.pii_type,
      file_path: r.file_path,
      line_numbers: r.line_numbers ? JSON.stringify(r.line_numbers) : null,
      page_numbers: r.page_numbers ? JSON.stringify(r.page_numbers) : null,
      confidence: r.confidence,
      detected_at: db.fn.now(),
    }));

    await db('guard_pii_results').insert(batch);
    inserted += batch.length;
  }

  return inserted;
}

/**
 * Guard PII Scan job handler
 *
 * This handler is responsible for:
 * 1. Loading the scan profile configuration
 * 2. Looking up the installed extension
 * 3. Dispatching the scan request to the Extension Runner
 * 4. Parsing the response and storing results
 * 5. Updating job status throughout the process
 */
export async function guardPiiScanHandler(
  _pgBossJobId: string,
  data: GuardPiiScanJobData
): Promise<void> {
  const tenantId = safeString(data.tenantId).trim();
  const jobId = safeString(data.jobId).trim();
  const profileId = safeString(data.profileId).trim();

  if (!tenantId || !jobId || !profileId) {
    throw new Error('Missing required job data (tenantId, jobId, profileId)');
  }

  const db = await getAdminConnection();

  // Update job to running status
  await updateJobStatus(db, tenantId, jobId, 'running');

  try {
    // Load the scan profile
    const profile = await db('guard_pii_profiles')
      .where({ tenant: tenantId, id: profileId })
      .first();

    if (!profile) {
      throw new Error(`PII profile ${profileId} not found`);
    }

    if (!profile.enabled) {
      throw new Error('Cannot run scan on disabled profile');
    }

    // Load the extension installation
    const install = await db('tenant_extension_install')
      .where({
        tenant_id: tenantId,
        registry_id: PII_SCANNER_EXTENSION.id,
        is_enabled: true,
      })
      .first();

    if (!install) {
      throw new Error(
        `PII Scanner extension (${PII_SCANNER_EXTENSION.id}) not installed or not enabled for this tenant`
      );
    }

    // Parse profile configuration
    const piiTypes: GuardPiiType[] = Array.isArray(profile.pii_types)
      ? profile.pii_types
      : JSON.parse(profile.pii_types || '[]');

    const fileExtensions: string[] = Array.isArray(profile.file_extensions)
      ? profile.file_extensions
      : JSON.parse(profile.file_extensions || '[]');

    const includePaths: string[] = Array.isArray(profile.include_paths)
      ? profile.include_paths
      : JSON.parse(profile.include_paths || '[]');

    const excludePaths: string[] = Array.isArray(profile.exclude_paths)
      ? profile.exclude_paths
      : JSON.parse(profile.exclude_paths || '[]');

    // Build the extension runner request
    const request = buildPiiScanRequest({
      tenantId,
      installId: install.id,
      jobId,
      profileId,
      piiTypes,
      fileExtensions,
      includePaths,
      excludePaths,
      maxFileSizeBytes: profile.max_file_size_bytes || 50 * 1024 * 1024,
      maxFiles: profile.max_files || 100000,
      contentHash: normalizeSha256(safeString(install.content_hash)),
      timeoutMs: PII_SCANNER_EXTENSION.default_timeout_ms,
    });

    // Call the Extension Runner
    const runnerUrl = process.env.RUNNER_BASE_URL || 'http://localhost:8080';
    const maxResponseBytes = Number(process.env.EXT_RUNNER_MAX_RESPONSE_BYTES || '10485760'); // 10MB for scan results

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      request.limits.timeout_ms + 5000 // Add grace period
    );

    let response: { status: number; body_b64: string; error?: string };
    try {
      const fetchResponse = await fetch(`${runnerUrl}/v1/execute`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': request.context.request_id,
          'x-idempotency-key': request.context.request_id,
          'x-alga-tenant': tenantId,
          'x-alga-extension': PII_SCANNER_EXTENSION.id,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      const raw = await readResponseTextWithLimit(fetchResponse as any, maxResponseBytes);
      response = JSON.parse(raw) as { status: number; body_b64: string; error?: string };
    } finally {
      clearTimeout(timeout);
    }

    // Parse the response
    const parseResult = parsePiiScanResponse(response);

    if (!parseResult.success) {
      const errorCategory = categorizeError(response);

      if (shouldRetry(errorCategory)) {
        // Let PG Boss handle retry with exponential backoff
        const delay = getRetryDelay(errorCategory, 1);
        throw new Error(
          `PII scan failed (${errorCategory}): ${parseResult.error}. Will retry in ${delay}ms`
        );
      }

      // Non-retryable error - mark job as failed
      await updateJobStatus(db, tenantId, jobId, 'failed', {
        error_message: parseResult.error || 'Unknown error',
      });
      return;
    }

    // Convert and store results
    const payload = parseResult.payload!;
    const results = convertMatchesToResults(payload, tenantId, profileId);

    const insertedCount = await storeResults(db, tenantId, jobId, results);

    // Update job to completed status with final stats
    await updateJobStatus(db, tenantId, jobId, 'completed', {
      total_files_scanned: payload.stats.total_files_scanned,
      total_matches: insertedCount,
      progress_percent: 100,
      metadata: {
        stats: payload.stats,
        agent_id: payload.agent_id,
        started_at: payload.started_at,
        completed_at: payload.completed_at,
      },
    });

    logger.info('[guard:pii:scan] Scan completed successfully', {
      tenantId,
      jobId,
      profileId,
      filesScanned: payload.stats.total_files_scanned,
      matchesFound: insertedCount,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error('[guard:pii:scan] Scan failed', {
      tenantId,
      jobId,
      profileId,
      error: errorMessage,
    });

    // Update job status to failed
    await updateJobStatus(db, tenantId, jobId, 'failed', {
      error_message: errorMessage.slice(0, 4000),
    });

    // Re-throw to let PG Boss handle retries
    throw error;
  }
}
