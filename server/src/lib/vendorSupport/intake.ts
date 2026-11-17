import logger from '@alga-psa/core/logger';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { signRequest } from '@/lib/webhooks/sign';

export const INTAKE_SIGNATURE_HEADER = 'X-Alga-Support-Signature';

// www, not the apex: nineminds.com 301s wholesale to www, and fetch re-issues a
// redirected POST as a bodyless GET, which would silently strand every request.
const DEFAULT_INTAKE_URL = 'https://www.nineminds.com/api/support/intake';
const INTAKE_SECRET_NAME = 'VENDOR_SUPPORT_INTAKE_SECRET';
const INTAKE_TIMEOUT_MS = 8_000;
const MAX_REASON_DETAIL = 200;

export interface VendorSupportIntakePayload {
  tenantId: string;
  tenantName: string;
  userName: string;
  userEmail: string;
  category: 'bug' | 'question' | 'billing' | 'feature';
  subject: string;
  description: string;
  edition: 'CE' | 'EE';
  onPrem: boolean;
  appVersion?: string;
  pageUrl: string;
}

export type VendorSupportIntakeResult =
  | { ok: true; ticketNumber?: string }
  | { ok: false; reason: string };

/**
 * `t=<unix>,v1=<hex hmac-sha256(secret, t + "." + rawBody)>` over the exact
 * bytes sent as the request body. nm-store verifies the same construction and
 * rejects a timestamp more than 300 s from its own clock.
 */
export function signVendorSupportIntake(
  secret: string,
  rawBody: string,
  unixSeconds: number,
): string {
  return signRequest(secret, rawBody, unixSeconds);
}

/**
 * Hosted installs carry the shared signing secret; on-prem installs do not, and
 * send unsigned (nm-store treats their tenant ids as unverified).
 */
async function readIntakeSecret(): Promise<string | undefined> {
  try {
    const secretProvider = await getSecretProviderInstance();
    const secret = await secretProvider.getAppSecret(INTAKE_SECRET_NAME);
    return secret && secret.trim() !== '' ? secret : undefined;
  } catch (error) {
    logger.warn('[vendorSupportIntake] Could not read the intake signing secret; sending unsigned', error);
    return undefined;
  }
}

function truncate(detail: string): string {
  return detail.length > MAX_REASON_DETAIL ? `${detail.slice(0, MAX_REASON_DETAIL)}…` : detail;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Hand the request to the Nine Minds support intake API, which resolves the
 * submitting client and contact before creating the ticket. Never throws: the
 * caller falls back to email on any `ok: false`.
 */
export async function submitVendorSupportIntake(
  payload: VendorSupportIntakePayload,
): Promise<VendorSupportIntakeResult> {
  const url = process.env.VENDOR_SUPPORT_INTAKE_URL || DEFAULT_INTAKE_URL;
  const body = JSON.stringify({
    source: 'in_app',
    tenantId: payload.tenantId,
    tenantName: payload.tenantName,
    userName: payload.userName,
    userEmail: payload.userEmail,
    category: payload.category,
    subject: payload.subject,
    description: payload.description,
    edition: payload.edition,
    onPrem: payload.onPrem,
    appVersion: payload.appVersion,
    pageUrl: payload.pageUrl,
  });

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const secret = await readIntakeSecret();
  if (secret) {
    headers[INTAKE_SIGNATURE_HEADER] = signVendorSupportIntake(
      secret,
      body,
      Math.floor(Date.now() / 1000),
    );
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      // A redirect would be re-issued as a bodyless GET carrying a signature
      // over a body that is no longer sent; fail loudly instead.
      redirect: 'error',
      signal: AbortSignal.timeout(INTAKE_TIMEOUT_MS),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ok: false, reason: 'timeout' };
    }
    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : '';
    return { ok: false, reason: `network:${truncate(`${message}${cause}`)}` };
  }

  if (!response.ok) {
    return { ok: false, reason: `http_${response.status}` };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return { ok: false, reason: 'invalid_response' };
  }

  if (!isRecord(parsed) || parsed.ok !== true) {
    const detail = isRecord(parsed) && typeof parsed.error === 'string' ? parsed.error : 'unknown';
    return { ok: false, reason: `rejected:${truncate(detail)}` };
  }

  const ticketNumber = typeof parsed.ticketNumber === 'string' && parsed.ticketNumber.trim() !== ''
    ? parsed.ticketNumber
    : undefined;

  return ticketNumber ? { ok: true, ticketNumber } : { ok: true };
}
