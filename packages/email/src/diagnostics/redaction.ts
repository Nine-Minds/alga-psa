/**
 * Sanitization policy for outbound diagnostics reports and support bundles.
 *
 * Two jobs:
 *  - secret-safe string handling: strip bearer/JWT tokens and key=value secrets
 *    even when identifiers are intentionally kept visible;
 *  - identifier redaction: redact mailbox addresses, encoded mailbox paths,
 *    Graph identity ids and tenant/app ids when `includeIdentifiers` is off.
 *
 * Step envelopes, HTTP metadata and error metadata use explicit safe
 * projections so a raw provider `responseBody` or Axios config can never reach a
 * report or an export. Status codes and provider correlation ids survive.
 */

import type {
  DiagnosticsErrorMeta,
  DiagnosticsHttpMeta,
} from '@alga-psa/types';
import type {
  OutboundDiagnosticsSummary,
  OutboundEmailDiagnosticsReport,
  OutboundStep,
} from './outboundTypes';

export interface RedactionOptions {
  includeIdentifiers: boolean;
}

const SECRET_KEYS = new Set([
  'accesstoken',
  'access_token',
  'refresh_token',
  'refreshtoken',
  'idtoken',
  'id_token',
  'password',
  'apikey',
  'api_key',
  'client_secret',
  'clientsecret',
  'authorization',
  'secret',
  'privatekey',
  'private_key',
]);

const EMAIL_KEYS = new Set([
  'authenticateduseremail',
  'configuredmailbox',
  'effectivesender',
  'ticketingfromemail',
  'defaultfromemail',
  'email',
  'mail',
  'userprincipalname',
  'upn',
  'preferred_username',
  'mailbox',
  'from',
  'fromemail',
  'to',
  'toemail',
  'recipient',
  'sender',
  'senderemail',
]);

const IDENTIFIER_KEYS = new Set([
  'id',
  'userid',
  'objectid',
  'mailboxid',
  'tenantid',
  'tenant',
  'tid',
  'appid',
  'providerid',
  'clientid',
  'sub',
]);

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ENCODED_EMAIL_PATTERN = /[A-Za-z0-9._%+-]+%40[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
const SECRET_ASSIGNMENT_PATTERN =
  /\b((?:access_token|refresh_token|id_token|client_secret|api_key|apikey|password|secret)[=:]\s*)([^\s&"',;}]+)/gi;
const GRAPH_MAILBOX_PATH_PATTERN = /(users\/)([^/?#\s"']+)/gi;

function scrubSecrets(value: string): string {
  return value
    .replace(BEARER_PATTERN, 'Bearer [redacted]')
    .replace(JWT_PATTERN, '[redacted-token]')
    .replace(SECRET_ASSIGNMENT_PATTERN, '$1[redacted]');
}

function scrubIdentifiers(value: string): string {
  return value
    .replace(EMAIL_PATTERN, '[redacted-email]')
    .replace(ENCODED_EMAIL_PATTERN, '[redacted-email]')
    .replace(GRAPH_MAILBOX_PATH_PATTERN, '$1[redacted-mailbox]');
}

export function sanitizeDiagnosticsText(value: string, options: RedactionOptions): string {
  const scrubbed = scrubSecrets(value);
  return options.includeIdentifiers ? scrubbed : scrubIdentifiers(scrubbed);
}

function redactByKey(key: string, entry: unknown, options: RedactionOptions): unknown {
  const lower = key.toLowerCase();
  if (SECRET_KEYS.has(lower)) return '[redacted]';
  if (!options.includeIdentifiers) {
    if (EMAIL_KEYS.has(lower)) return '[redacted-email]';
    if (IDENTIFIER_KEYS.has(lower)) return '[redacted-identifier]';
  }
  return sanitizeDiagnosticsValue(entry, options);
}

export function sanitizeDiagnosticsValue(value: unknown, options: RedactionOptions): unknown {
  if (typeof value === 'string') return sanitizeDiagnosticsText(value, options);
  if (Array.isArray(value)) return value.map((entry) => sanitizeDiagnosticsValue(entry, options));
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = redactByKey(key, entry, options);
    }
    return output;
  }
  return value;
}

/** @deprecated use sanitizeDiagnosticsValue; retained for existing call sites. */
export function redactDiagnosticsValue(value: unknown, options: RedactionOptions): unknown {
  return sanitizeDiagnosticsValue(value, options);
}

export function sanitizeHttpMeta(
  http: DiagnosticsHttpMeta,
  options: RedactionOptions,
): Record<string, unknown> {
  const output: Record<string, unknown> = { method: http.method };
  if (http.path !== undefined) output.path = sanitizeDiagnosticsText(http.path, options);
  if (http.url !== undefined) output.url = sanitizeDiagnosticsText(http.url, options);
  if (http.resource !== undefined) output.resource = sanitizeDiagnosticsText(http.resource, options);
  if (http.status !== undefined) output.status = http.status;
  if (http.requestId !== undefined) output.requestId = http.requestId;
  if (http.clientRequestId !== undefined) output.clientRequestId = http.clientRequestId;
  return output;
}

export function sanitizeErrorMeta(
  error: DiagnosticsErrorMeta,
  options: RedactionOptions,
): Record<string, unknown> {
  const output: Record<string, unknown> = {
    message: sanitizeDiagnosticsText(error.message, options),
  };
  // responseBody and any provider payload are intentionally dropped: only
  // status/code/correlation ids are safe to expose.
  if (error.status !== undefined) output.status = error.status;
  if (error.code !== undefined) output.code = error.code;
  if (error.requestId !== undefined) output.requestId = error.requestId;
  if (error.clientRequestId !== undefined) output.clientRequestId = error.clientRequestId;
  return output;
}

export function sanitizeDiagnosticsStep(step: OutboundStep, options: RedactionOptions): OutboundStep {
  const output: Record<string, unknown> = {
    id: step.id,
    title: step.title,
    status: step.status,
    durationMs: step.durationMs,
  };
  if (step.startedAt !== undefined) output.startedAt = step.startedAt;
  if (step.detail !== undefined) output.detail = sanitizeDiagnosticsText(step.detail, options);
  if (step.http) output.http = sanitizeHttpMeta(step.http, options);
  if (step.data) output.data = sanitizeDiagnosticsValue(step.data, options);
  if (step.error) output.error = sanitizeErrorMeta(step.error, options);
  return output as unknown as OutboundStep;
}

export function sanitizeDiagnosticsSummary(
  summary: OutboundDiagnosticsSummary,
  options: RedactionOptions,
): OutboundDiagnosticsSummary {
  return sanitizeDiagnosticsValue(summary, options) as OutboundDiagnosticsSummary;
}

export function sanitizeDiagnosticsReport(
  report: OutboundEmailDiagnosticsReport,
  options: RedactionOptions,
): OutboundEmailDiagnosticsReport {
  return {
    createdAt: report.createdAt,
    summary: sanitizeDiagnosticsSummary(report.summary, options),
    steps: report.steps.map((step) => sanitizeDiagnosticsStep(step, options)),
    recommendations: report.recommendations.map((entry) => sanitizeDiagnosticsText(entry, options)),
    supportBundle: sanitizeDiagnosticsValue(report.supportBundle, options) as Record<string, unknown>,
  };
}

/**
 * Build the exportable support bundle from a raw report. `includeIdentifiers`
 * defaults off; secrets and response bodies are always removed.
 */
export function buildSanitizedSupportBundle(
  report: OutboundEmailDiagnosticsReport,
  options: RedactionOptions,
): Record<string, unknown> {
  return {
    createdAt: report.createdAt,
    summary: sanitizeDiagnosticsSummary(report.summary, options),
    steps: report.steps.map((step) => sanitizeDiagnosticsStep(step, options)),
    recommendations: report.recommendations.map((entry) => sanitizeDiagnosticsText(entry, options)),
  };
}
