import type {
  DiagnosticsRecommendation,
  EntraClientDiagnosticsResult,
  EntraDiagnosticsReport,
  EntraDiagnosticsStep,
  EntraDiagnosticsSupportBundle,
} from '@alga-psa/types';
import { buildTokenFingerprint } from '@alga-psa/shared/services/diagnostics';

const GUID_PATTERN =
  /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{2,}/g;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
// key=value / "key": "value" credential forms that appear in error text.
const SECRET_PAIR_PATTERN =
  /((?:access|refresh|id|api|client)?[_-]?(?:token|secret|password|key))\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;&"']+)/gi;

const CORRELATION_KEYS = new Set([
  'requestId',
  'clientRequestId',
  'request_id',
  'client_request_id',
]);

const SENSITIVE_KEY_PATTERN =
  /(secret|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?token|api[_-]?key|apikey|password|authorization|bearer|credential|passphrase|private[_-]?key)/i;

const IDENTIFIER_KEY_PATTERN =
  /(tenantid|tenant_id|clientid|client_id|userid|user_id|objectid|object_id|appid|app_id|managedtenantid|managed_tenant_id|entratenantid|entra_tenant_id|principalid|profileid|profile_id|connectionid|connection_id|jobid|job_id|runid|run_id|queueitemid|queue_item_id|groupid|group_id|mappingid|mapping_id|assignedby|assigned_by)/i;

function isFingerprint(value: string): boolean {
  return /^[^\s]{0,8}\.\.\.\(\d+\)$/.test(value);
}

/** Secret-bearing text is always redacted, regardless of identifier mode. */
function redactSecrets(text: string): string {
  return text
    .replace(BEARER_PATTERN, 'Bearer <redacted>')
    .replace(JWT_PATTERN, '<redacted-token>')
    .replace(SECRET_PAIR_PATTERN, (_match, key: string) => `${key}=<redacted>`);
}

function redactIdentifiers(text: string): string {
  return text.replace(GUID_PATTERN, '<id>').replace(EMAIL_PATTERN, '<redacted-email>');
}

/**
 * Redact identifier-bearing and secret-bearing text. Secret redaction is
 * unconditional; identifier redaction is controlled by `includeIdentifiers`.
 */
export function redactText(text: string, includeIdentifiers: boolean): string {
  const secretsRemoved = redactSecrets(text);
  return includeIdentifiers ? secretsRemoved : redactIdentifiers(secretsRemoved);
}

function sanitizeSensitiveValue(value: unknown, includeIdentifiers: boolean): unknown {
  if (typeof value === 'string') {
    if (isFingerprint(value)) return value;
    if (value.trim() === '') return value;
    return buildTokenFingerprint(value) ?? '<redacted>';
  }
  if (value === null || value === undefined) return value;
  return '<redacted>';
}

/**
 * Deep, unconditional secret sanitizer. Secrets are stripped from every field
 * and nested structure; identifiers are redacted only when requested.
 */
export function sanitizeDeep(value: unknown, includeIdentifiers: boolean): unknown {
  if (typeof value === 'string') {
    return redactText(value, includeIdentifiers);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeDeep(entry, includeIdentifiers));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (CORRELATION_KEYS.has(key)) {
        // Correlation ids are safe and useful; never redact them.
        out[key] = entry;
        continue;
      }
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = sanitizeSensitiveValue(entry, includeIdentifiers);
        continue;
      }
      if (!includeIdentifiers && IDENTIFIER_KEY_PATTERN.test(key)) {
        out[key] = null;
        continue;
      }
      out[key] = sanitizeDeep(entry, includeIdentifiers);
    }
    return out;
  }
  return value;
}

export function sanitizeStep(
  step: EntraDiagnosticsStep,
  includeIdentifiers: boolean
): EntraDiagnosticsStep {
  return sanitizeDeep(step, includeIdentifiers) as EntraDiagnosticsStep;
}

export function sanitizeClient(
  client: EntraClientDiagnosticsResult,
  includeIdentifiers: boolean
): EntraClientDiagnosticsResult {
  return sanitizeDeep(client, includeIdentifiers) as EntraClientDiagnosticsResult;
}

export function sanitizeRecommendation(
  recommendation: DiagnosticsRecommendation,
  includeIdentifiers: boolean
): DiagnosticsRecommendation {
  return sanitizeDeep(recommendation, includeIdentifiers) as DiagnosticsRecommendation;
}

export function sanitizeRecommendations(
  recommendations: DiagnosticsRecommendation[] | undefined,
  includeIdentifiers: boolean
): DiagnosticsRecommendation[] {
  return (recommendations ?? []).map((rec) => sanitizeRecommendation(rec, includeIdentifiers));
}

/**
 * Build a JSON-safe, non-recursive support bundle. Identifiers are redacted
 * unless explicitly included; secrets are always removed.
 */
export function createSupportBundle(
  report: EntraDiagnosticsReport,
  includeIdentifiers: boolean
): EntraDiagnosticsSupportBundle {
  return {
    createdAt: report.createdAt,
    scope: report.scope,
    connectionType: report.summary.connectionType,
    summary: sanitizeDeep(report.summary, includeIdentifiers) as EntraDiagnosticsSupportBundle['summary'],
    steps: report.steps.map((step) => sanitizeStep(step, includeIdentifiers)),
    clients: report.clients.map((client) => sanitizeClient(client, includeIdentifiers)),
    recommendations: sanitizeRecommendations(report.recommendations, includeIdentifiers),
  };
}

/**
 * Return a copy of the report with secrets always removed and identifiers
 * redacted unless explicitly included. This runs for every serialization,
 * including the `includeIdentifiers` path.
 */
export function applyReportRedaction(
  report: EntraDiagnosticsReport,
  includeIdentifiers: boolean
): EntraDiagnosticsReport {
  const sanitized = sanitizeDeep(
    { ...report, supportBundle: undefined },
    includeIdentifiers
  ) as EntraDiagnosticsReport;
  return sanitized;
}

/** Sanitize a continuation payload's completed results before signing. */
export function sanitizeContinuationResults<T>(results: T[], includeIdentifiers = true): T[] {
  return results.map((result) => sanitizeDeep(result, includeIdentifiers) as T);
}
