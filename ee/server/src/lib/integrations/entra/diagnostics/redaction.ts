import type {
  DiagnosticsErrorMeta,
  DiagnosticsHttpMeta,
  EntraClientDiagnosticsResult,
  EntraDiagnosticsReport,
  EntraDiagnosticsStep,
  EntraDiagnosticsSupportBundle,
} from '@alga-psa/types';

const GUID_PATTERN =
  /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{2,}/g;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;

/**
 * Redact identifier-bearing and secret-bearing text. Server-side serialization
 * always runs this before data crosses the API boundary; client copy/download
 * is not the only sanitizer.
 */
export function redactText(text: string, includeIdentifiers: boolean): string {
  let out = text.replace(BEARER_PATTERN, 'Bearer <redacted>').replace(JWT_PATTERN, '<redacted-token>');
  if (!includeIdentifiers) {
    out = out.replace(GUID_PATTERN, '<id>');
  }
  return out;
}

function redactHttp(
  http: DiagnosticsHttpMeta | undefined,
  includeIdentifiers: boolean
): DiagnosticsHttpMeta | undefined {
  if (!http) return undefined;
  return {
    ...http,
    url: http.url ? redactText(http.url, includeIdentifiers) : undefined,
    path: http.path ? redactText(http.path, includeIdentifiers) : undefined,
    // Correlation identifiers are always retained.
    requestId: http.requestId,
    clientRequestId: http.clientRequestId,
  };
}

function redactError(
  error: DiagnosticsErrorMeta | undefined,
  includeIdentifiers: boolean
): DiagnosticsErrorMeta | undefined {
  if (!error) return undefined;
  return {
    ...error,
    message: redactText(error.message, includeIdentifiers),
    requestId: error.requestId,
    clientRequestId: error.clientRequestId,
  };
}

export function sanitizeStep(
  step: EntraDiagnosticsStep,
  includeIdentifiers: boolean
): EntraDiagnosticsStep {
  return {
    ...step,
    http: redactHttp(step.http, includeIdentifiers),
    error: redactError(step.error, includeIdentifiers),
    recommendations: step.recommendations?.map((rec) => ({
      ...rec,
      text: redactText(rec.text, includeIdentifiers),
    })),
  };
}

function sanitizeClient(
  client: EntraClientDiagnosticsResult,
  includeIdentifiers: boolean
): EntraClientDiagnosticsResult {
  return {
    ...client,
    steps: client.steps.map((step) => sanitizeStep(step, includeIdentifiers)),
  };
}

/**
 * Build a JSON-safe, non-recursive support bundle. It contains a flat snapshot
 * of the report's arrays and summary, never a nested `supportBundle` copy.
 */
export function createSupportBundle(
  report: EntraDiagnosticsReport,
  includeIdentifiers: boolean
): EntraDiagnosticsSupportBundle {
  const steps = report.steps.map((step) => sanitizeStep(step, includeIdentifiers));
  const clients = report.clients.map((client) => sanitizeClient(client, includeIdentifiers));
  return {
    createdAt: report.createdAt,
    scope: report.scope,
    connectionType: report.summary.connectionType,
    summary: report.summary,
    steps,
    clients,
    recommendations: report.recommendations.map((rec) => ({
      ...rec,
      text: redactText(rec.text, includeIdentifiers),
    })),
  };
}

/**
 * Return a copy of the report with identifiers redacted unless explicitly
 * included. Tokens/secrets are never present in the report to begin with; this
 * only controls tenant/client/user/endpoint identifiers.
 */
export function applyReportRedaction(
  report: EntraDiagnosticsReport,
  includeIdentifiers: boolean
): EntraDiagnosticsReport {
  if (includeIdentifiers) return report;
  return {
    ...report,
    summary: {
      ...report.summary,
      partnerTenantId: null,
    },
    steps: report.steps.map((step) => sanitizeStep(step, includeIdentifiers)),
    clients: report.clients.map((client) => sanitizeClient(client, includeIdentifiers)),
    recommendations: report.recommendations.map((rec) => ({
      ...rec,
      text: redactText(rec.text, includeIdentifiers),
    })),
  };
}
