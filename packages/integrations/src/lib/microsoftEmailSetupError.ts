export type MicrosoftSetupErrorCode =
  | 'policy_blocked'
  | 'admin_required'
  | 'wrong_tenant'
  | 'app_not_found'
  | 'consent_denied'
  | 'microsoft_error';

export interface MicrosoftSetupErrorDescription {
  errorCode: MicrosoftSetupErrorCode;
  aadsts: string | null;
  correlationId: string | null;
  detail: string | null;
}

export interface MicrosoftSetupErrorParams {
  error?: string | null;
  error_description?: string | null;
  error_codes?: string | null;
  correlation_id?: string | null;
  /** Secrets (state token, authorization code) that must never appear in `detail`. */
  redact?: Array<string | null | undefined>;
}

const MAX_DETAIL_LENGTH = 300;
const CORRELATION_ID_PATTERN = /^[0-9a-fA-F-]{8,64}$/;

const POLICY_AADSTS = new Set(['50097', '53000', '53003']);
const ADMIN_AADSTS = new Set(['90094', '90099', '65001']);

export function sanitizeMicrosoftErrorDescription(
  value: string | null | undefined,
  redact: Array<string | null | undefined> = [],
): string | null {
  if (!value) return null;
  let text = value;
  for (const secret of redact) {
    if (secret) text = text.split(secret).join('');
  }
  text = text
    // Microsoft appends "Trace ID / Correlation ID / Timestamp" boilerplate;
    // the correlation ID is surfaced separately.
    .replace(/\s*Trace ID:[\s\S]*$/i, '')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '')
    // Markup and non-whitespace control characters never belong in a message
    // that is echoed back into the UI.
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH - 1).trimEnd()}…` : text;
}

function pickAadsts(params: MicrosoftSetupErrorParams): string | null {
  const fromDescription = params.error_description?.match(/AADSTS(\d{4,7})/i)?.[1];
  if (fromDescription) return fromDescription;
  const fromCodes = params.error_codes?.match(/\d{4,7}/)?.[0];
  return fromCodes ?? null;
}

function pickCorrelationId(params: MicrosoftSetupErrorParams): string | null {
  const direct = params.correlation_id?.trim();
  if (direct && CORRELATION_ID_PATTERN.test(direct)) return direct;
  const fromDescription = params.error_description?.match(/Correlation ID:\s*([0-9a-fA-F-]{8,64})/i)?.[1];
  return fromDescription ?? null;
}

/**
 * Pure mapping from Microsoft's redirect query parameters to a stable error
 * code plus the diagnostics a user needs when checking Entra sign-in logs.
 * Nothing but the four documented Microsoft parameters is read.
 */
export function describeMicrosoftSetupError(params: MicrosoftSetupErrorParams): MicrosoftSetupErrorDescription {
  const aadsts = pickAadsts(params);
  const correlationId = pickCorrelationId(params);
  const detail = sanitizeMicrosoftErrorDescription(params.error_description, params.redact);
  const error = params.error?.trim().toLowerCase();

  let errorCode: MicrosoftSetupErrorCode = 'microsoft_error';
  if (aadsts && POLICY_AADSTS.has(aadsts)) errorCode = 'policy_blocked';
  else if (aadsts && ADMIN_AADSTS.has(aadsts)) errorCode = 'admin_required';
  else if (aadsts === '50020') errorCode = 'wrong_tenant';
  else if (aadsts === '700016') errorCode = 'app_not_found';
  else if (error === 'interaction_required') errorCode = 'policy_blocked';
  else if (error === 'access_denied') errorCode = 'consent_denied';

  return { errorCode, aadsts, correlationId, detail };
}
