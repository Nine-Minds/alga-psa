import { createHmac, timingSafeEqual } from 'crypto';
import type {
  EntraClientDiagnosticsResult,
  EntraConnectionType,
} from '@alga-psa/types';

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
  clientIds: string[];
  includeUserYield: boolean;
  /** Number of clients fully executed so far. */
  offset: number;
  total: number;
  results: EntraClientDiagnosticsResult[];
  /** Epoch milliseconds after which the continuation is rejected. */
  exp: number;
}

export const DEFAULT_CONTINUATION_TTL_MS = 10 * 60 * 1000;

function resolveSecret(secret?: string): string {
  return (
    secret ||
    process.env.ENTRA_DIAGNOSTICS_JOB_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    'entra-diagnostics-dev-secret'
  );
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

export function signContinuation(
  payload: EntraClientContinuationPayload,
  secret?: string
): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body, resolveSecret(secret))}`;
}

export function verifyContinuation(
  token: string,
  secret?: string
): EntraClientContinuationPayload | null {
  if (!token || typeof token !== 'string') return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = sign(body, resolveSecret(secret));
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8')
    ) as EntraClientContinuationPayload;
    if (payload?.v !== 1) return null;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
