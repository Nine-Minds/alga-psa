/**
 * Safe serialization for accounting-provider (QBO, Xero, …) errors.
 *
 * Provider error responses and Axios errors can carry OAuth tokens,
 * Authorization headers, client secrets, request bodies, and customer or
 * invoice data. Nothing from a provider error may be logged or persisted
 * except the explicit allowlist below. Every accounting call site funnels
 * provider failures through `toSafeProviderError` instead of touching the
 * raw error, so redaction does not depend on individual call sites
 * remembering to sanitize.
 */

export interface SafeProviderError {
  /** e.g. 'qbo' | 'xero' */
  provider: string;
  /** Logical operation being performed, e.g. 'tokenRefresh', 'createInvoices'. */
  operation?: string;
  /** HTTP status of the provider response, when present. */
  status?: number;
  /** Stable provider error code (QBO Fault code, Xero ErrorNumber, OAuth error). */
  providerErrorCode?: string;
  /** Concise, sanitized human-readable message. */
  message: string;
  /** Realm ID / Xero tenant ID — safe identifiers, never credentials. */
  providerTenantId?: string;
  /** Provider correlation / request ID (intuit_tid, xero-correlation-id, …). */
  correlationId?: string;
}

const CORRELATION_HEADER_NAMES = [
  'intuit_tid',
  'xero-correlation-id',
  'x-request-id',
  'request-id'
];

const MAX_MESSAGE_LENGTH = 300;

// Token-shaped substrings that must never survive into a message we keep:
// bearer/basic credentials, JWTs, and long opaque base64/hex blobs.
const MESSAGE_SECRET_PATTERNS: RegExp[] = [
  /\b(?:bearer|basic)\s+[a-z0-9._~+/=-]+/gi,
  /\beyJ[a-zA-Z0-9_-]{8,}(?:\.[a-zA-Z0-9_-]{4,}){1,2}/g,
  /\b[a-zA-Z0-9_-]{40,}\b/g
];

/**
 * Reduce a free-form provider/exception message to something safe to keep:
 * strip token-shaped substrings and cap the length so embedded payload dumps
 * cannot ride along.
 */
export function sanitizeProviderMessage(message: unknown): string {
  if (typeof message !== 'string' || message.length === 0) {
    return 'Unknown provider error';
  }
  let sanitized = message;
  for (const pattern of MESSAGE_SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  if (sanitized.length > MAX_MESSAGE_LENGTH) {
    sanitized = `${sanitized.slice(0, MAX_MESSAGE_LENGTH)}…`;
  }
  return sanitized;
}

function readHeader(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== 'object') {
    return undefined;
  }
  const record = headers as Record<string, unknown>;
  const value = record[name] ?? record[name.toLowerCase()];
  return typeof value === 'string' && value ? value : undefined;
}

function extractCorrelationId(headers: unknown): string | undefined {
  for (const name of CORRELATION_HEADER_NAMES) {
    const value = readHeader(headers, name);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, any> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : undefined;
}

/**
 * Pull a stable error code and short provider message from known response
 * body shapes (QBO Fault, Xero problem document, OAuth error object) without
 * ever copying the body itself.
 */
function extractProviderCodeAndMessage(data: unknown): { code?: string; message?: string } {
  const body = asRecord(data);
  if (!body) {
    return {};
  }

  // QBO: { Fault: { Error: [{ code, Message, Detail }] } } (case-insensitive variants)
  const fault = asRecord(body.Fault) ?? asRecord(body.fault);
  const faultErrors = fault?.Error ?? fault?.error;
  const faultError = Array.isArray(faultErrors) ? asRecord(faultErrors[0]) : undefined;
  if (faultError) {
    const code = faultError.code ?? faultError.Code;
    const message = faultError.Message ?? faultError.message;
    return {
      code: typeof code === 'string' || typeof code === 'number' ? String(code) : undefined,
      message: typeof message === 'string' ? message : undefined
    };
  }

  // Xero: { ErrorNumber, Type, Message } problem documents.
  if (body.ErrorNumber !== undefined || typeof body.Type === 'string') {
    const code = body.ErrorNumber ?? body.Type;
    return {
      code: typeof code === 'string' || typeof code === 'number' ? String(code) : undefined,
      message: typeof body.Message === 'string' ? body.Message : undefined
    };
  }

  // OAuth token endpoints: { error, error_description }.
  if (typeof body.error === 'string') {
    return {
      code: body.error,
      message: typeof body.error_description === 'string' ? body.error_description : undefined
    };
  }

  // Generic problem documents: { Title } / { Detail } / { message }.
  const message = body.Title ?? body.title ?? body.Detail ?? body.detail ?? body.message;
  return { message: typeof message === 'string' ? message : undefined };
}

function looksLikeAxiosError(error: unknown): error is {
  message?: string;
  response?: { status?: number; data?: unknown; headers?: unknown };
} {
  return Boolean(
    error &&
      typeof error === 'object' &&
      (error as Record<string, unknown>).isAxiosError === true
  );
}

export interface ToSafeProviderErrorOptions {
  operation?: string;
  providerTenantId?: string;
  /** Overrides the extracted provider error code when the caller knows better. */
  providerErrorCode?: string;
  /** Overrides the extracted correlation ID when the caller already has it. */
  correlationId?: string;
}

/**
 * The single allowed path from an arbitrary provider/transport error to a
 * value that may be logged, attached to AppError details, or persisted.
 * Deterministic for malformed payloads: never throws, always returns the
 * allowlisted shape.
 */
export function toSafeProviderError(
  provider: string,
  error: unknown,
  options: ToSafeProviderErrorOptions = {}
): SafeProviderError {
  const safe: SafeProviderError = {
    provider,
    operation: options.operation,
    providerTenantId: options.providerTenantId,
    message: 'Unknown provider error'
  };

  try {
    if (looksLikeAxiosError(error)) {
      const response = error.response;
      safe.status = typeof response?.status === 'number' ? response.status : undefined;
      safe.correlationId = options.correlationId ?? extractCorrelationId(response?.headers);
      const extracted = extractProviderCodeAndMessage(response?.data);
      safe.providerErrorCode = options.providerErrorCode ?? extracted.code;
      safe.message = sanitizeProviderMessage(extracted.message ?? error.message);
      return safe;
    }

    if (error instanceof Error) {
      safe.providerErrorCode =
        options.providerErrorCode ??
        (typeof (error as { code?: unknown }).code === 'string'
          ? ((error as { code?: string }).code as string)
          : undefined);
      safe.correlationId = options.correlationId;
      safe.message = sanitizeProviderMessage(error.message);
      return safe;
    }

    safe.providerErrorCode = options.providerErrorCode;
    safe.correlationId = options.correlationId;
    safe.message = sanitizeProviderMessage(typeof error === 'string' ? error : undefined);
    return safe;
  } catch {
    // Malformed provider payloads must never turn redaction into a crash.
    return safe;
  }
}

// ---------------------------------------------------------------------------
// Structured log meta redaction (defense in depth)
// ---------------------------------------------------------------------------

// Keys whose values are always redacted, wherever they appear in log meta.
const SENSITIVE_KEY_EXACT = new Set([
  'authorization',
  'proxy-authorization',
  'www-authenticate',
  'cookie',
  'set-cookie',
  'password',
  'passwd',
  'authorization_code',
  'code_verifier',
  'assertion',
  'client_assertion',
  'credentials',
  'credential'
]);

// Suffix / substring patterns: access_token, refreshToken, client_secret,
// apiKey, x-api-key, sessionToken, privateKey, …
const SENSITIVE_KEY_PATTERN = /(token|secret|apikey|api[_-]key|private[_-]?key)$/i;

// Axios error internals that embed request configs and bodies.
const DROPPED_KEYS = new Set(['config', 'request', 'httpagent', 'httpsagent']);

const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 50;

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    SENSITIVE_KEY_EXACT.has(normalized) ||
    SENSITIVE_KEY_PATTERN.test(normalized.replace(/[_-]/g, ''))
    || SENSITIVE_KEY_PATTERN.test(normalized)
  );
}

/**
 * Deep-copy structured log metadata, redacting credential-shaped keys and
 * dropping Axios request/config internals. Cycle-safe and depth-bounded.
 */
export function sanitizeLogMeta<T>(value: T): T {
  const seen = new WeakSet<object>();

  const visit = (input: unknown, depth: number): unknown => {
    if (input === null || input === undefined) {
      return input;
    }
    if (typeof input !== 'object') {
      return input;
    }
    if (seen.has(input as object)) {
      return '[Circular]';
    }
    if (depth >= MAX_DEPTH) {
      return '[Truncated]';
    }
    seen.add(input as object);

    if (Array.isArray(input)) {
      return input.slice(0, MAX_ARRAY_ITEMS).map((item) => visit(item, depth + 1));
    }

    if (looksLikeAxiosError(input)) {
      return toSafeProviderError('unknown', input);
    }

    if (input instanceof Error) {
      return {
        name: input.name,
        message: sanitizeProviderMessage(input.message),
        code: typeof (input as { code?: unknown }).code === 'string'
          ? (input as { code?: string }).code
          : undefined
      };
    }

    if (input instanceof Date) {
      return input.toISOString();
    }

    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(input as Record<string, unknown>)) {
      const normalizedKey = key.toLowerCase();
      if (DROPPED_KEYS.has(normalizedKey)) {
        continue;
      }
      if (isSensitiveKey(key)) {
        output[key] = '[REDACTED]';
        continue;
      }
      output[key] = visit(entry, depth + 1);
    }
    return output;
  };

  return visit(value, 0) as T;
}
