import { createHmac, timingSafeEqual } from 'crypto';
import type {
  EntraClientDiagnosticsResult,
  EntraConnectionType,
} from '@alga-psa/types';
import { sanitizeContinuationResults } from './redaction';

/** The mapping identity a continuation is bound to. */
export interface EntraContinuationSelection {
  clientId: string;
  managedTenantId: string;
  entraTenantId: string;
}

/**
 * Bounded, stateless continuation payload for client diagnostics. Completed
 * client results are carried inside the signed payload so no DB/secret-store
 * job record or process-local promise is required for correctness.
 */
export interface EntraClientContinuationPayload {
  v: 1;
  tenant: string;
  userId: string;
  scope: 'clients';
  connectionType: EntraConnectionType;
  connectionId: string | null;
  selection: EntraContinuationSelection[];
  includeUserYield: boolean;
  /** Number of clients fully executed so far. */
  offset: number;
  total: number;
  results: EntraClientDiagnosticsResult[];
  /** Epoch milliseconds after which the continuation is rejected. */
  exp: number;
}

export const DEFAULT_CONTINUATION_TTL_MS = 10 * 60 * 1000;
const MAX_TOKEN_LENGTH = 400_000;
const MAX_SELECTION = 500;

export class DiagnosticsSigningSecretUnavailableError extends Error {
  constructor() {
    super(
      'Entra diagnostics is unavailable because no deployment signing secret is configured (ENTRA_DIAGNOSTICS_JOB_SECRET or NEXTAUTH_SECRET).'
    );
    this.name = 'DiagnosticsSigningSecretUnavailableError';
  }
}

/**
 * Resolve the deployment signing secret. A publicly known fallback is never
 * used: if no real secret is configured the continuation is refused.
 */
function resolveSecret(secret?: string): string {
  const candidate =
    secret || process.env.ENTRA_DIAGNOSTICS_JOB_SECRET || process.env.NEXTAUTH_SECRET;
  if (!candidate || candidate.trim().length < 16) {
    throw new DiagnosticsSigningSecretUnavailableError();
  }
  return candidate;
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

export function signContinuation(
  payload: EntraClientContinuationPayload,
  secret?: string
): string {
  const sanitized: EntraClientContinuationPayload = {
    ...payload,
    results: sanitizeContinuationResults(payload.results, true),
  };
  const body = Buffer.from(JSON.stringify(sanitized), 'utf8').toString('base64url');
  return `${body}.${sign(body, resolveSecret(secret))}`;
}

function isSelection(value: unknown): value is EntraContinuationSelection {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.clientId === 'string' &&
    typeof entry.managedTenantId === 'string' &&
    typeof entry.entraTenantId === 'string'
  );
}

function isValidPayload(value: unknown): value is EntraClientContinuationPayload {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (
    p.v === 1 &&
    typeof p.tenant === 'string' &&
    typeof p.userId === 'string' &&
    p.scope === 'clients' &&
    typeof p.connectionType === 'string' &&
    (p.connectionId === null || typeof p.connectionId === 'string') &&
    Array.isArray(p.selection) &&
    p.selection.length <= MAX_SELECTION &&
    p.selection.every(isSelection) &&
    typeof p.includeUserYield === 'boolean' &&
    typeof p.offset === 'number' &&
    p.offset >= 0 &&
    typeof p.total === 'number' &&
    p.total >= 0 &&
    p.total === p.selection.length &&
    p.offset <= p.total &&
    Array.isArray(p.results) &&
    p.results.length === p.offset &&
    typeof p.exp === 'number'
  );
}

export function verifyContinuation(
  token: string,
  secret?: string
): EntraClientContinuationPayload | null {
  if (!token || typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  let expected: string;
  try {
    expected = sign(body, resolveSecret(secret));
  } catch {
    return null;
  }
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8')
    ) as unknown;
    if (!isValidPayload(payload)) return null;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
