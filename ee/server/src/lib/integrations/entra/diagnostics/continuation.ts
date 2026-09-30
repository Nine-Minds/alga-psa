import { createHmac, timingSafeEqual } from 'crypto';
import type {
  DiagnosticsRecommendation,
  EntraClientDiagnosticsResult,
  EntraClientOutcomeCategory,
  EntraConnectionType,
} from '@alga-psa/types';
import { sanitizeContinuationResults, sanitizeDeep } from './redaction';

/** The mapping identity a continuation is bound to. */
export interface EntraContinuationSelection {
  clientId: string;
  managedTenantId: string;
  entraTenantId: string;
}

export interface EntraPendingYield {
  clientId: string;
  managedTenantId: string;
  entraTenantId: string;
  /** Next Graph page URL, or the initial users URL when starting. */
  nextLink: string | null;
  counts: {
    totalUsers: number;
    includedUsers: number;
    excluded: Record<string, number>;
    unknownFieldCounts?: { userType: number; assignedLicenseCount: number };
  };
}

/**
 * Bounded, stateless continuation payload for client diagnostics. The token
 * carries only a bounded recent window of completed client results plus the
 * accumulated aggregate/recommendations; the UI accumulates the full set.
 * No credential is ever serialized; a fresh token is minted per attempt.
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
  /** Number of clients fully finalized so far. */
  offset: number;
  total: number;
  /** Bounded window of the most recent finalized client results. */
  recentResults: EntraClientDiagnosticsResult[];
  aggregate: Record<EntraClientOutcomeCategory, number>;
  /** Cumulative status counts so the overall fold stays accurate across batches. */
  failedCount: number;
  warnCount: number;
  recommendations: DiagnosticsRecommendation[];
  /** In-progress yield paging for the client at `offset`. */
  pending: EntraPendingYield | null;
  /** Epoch ms when the run started. */
  startedAt: number;
  /** Epoch milliseconds after which the continuation is rejected. */
  exp: number;
}

export const DEFAULT_CONTINUATION_TTL_MS = 10 * 60 * 1000;
export const MAX_SELECTION = 500;
export const MAX_TOKEN_LENGTH = 2_000_000;
export const MAX_EMBEDDED_RESULTS = 10;
export const MAX_EMBEDDED_RECOMMENDATIONS = 50;

export class DiagnosticsSigningSecretUnavailableError extends Error {
  constructor() {
    super(
      'Entra diagnostics is unavailable because no deployment signing secret is configured (ENTRA_DIAGNOSTICS_JOB_SECRET or NEXTAUTH_SECRET).'
    );
    this.name = 'DiagnosticsSigningSecretUnavailableError';
  }
}

export class DiagnosticsContinuationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiagnosticsContinuationError';
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

/** Validate signing capability before doing expensive work. */
export function assertContinuationSigningAvailable(secret?: string): void {
  resolveSecret(secret);
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

export function signContinuation(
  payload: EntraClientContinuationPayload,
  secret?: string
): string {
  if (!Array.isArray(payload.selection)) {
    throw new DiagnosticsContinuationError('Continuation selection is missing.');
  }
  if (payload.selection.length > MAX_SELECTION) {
    throw new DiagnosticsContinuationError(
      `Too many selected clients (${payload.selection.length}); the maximum is ${MAX_SELECTION}.`
    );
  }
  if (payload.total !== payload.selection.length || payload.offset > payload.total) {
    throw new DiagnosticsContinuationError('Continuation state is inconsistent.');
  }

  const sanitized: EntraClientContinuationPayload = {
    ...payload,
    recentResults: sanitizeContinuationResults(payload.recentResults, true).slice(
      -MAX_EMBEDDED_RESULTS
    ),
    recommendations: (payload.recommendations ?? [])
      .slice(-MAX_EMBEDDED_RECOMMENDATIONS)
      .map((rec) => sanitizeDeep(rec, true) as DiagnosticsRecommendation),
  };
  if (!isValidPayload(sanitized)) {
    throw new DiagnosticsContinuationError('Continuation state is inconsistent.');
  }
  const body = Buffer.from(JSON.stringify(sanitized), 'utf8').toString('base64url');
  const token = `${body}.${sign(body, resolveSecret(secret))}`;
  if (token.length > MAX_TOKEN_LENGTH) {
    throw new DiagnosticsContinuationError(
      'The diagnostics continuation exceeded the maximum size. Restart the run with a smaller selection.'
    );
  }
  return token;
}

const OUTCOME_CATEGORIES: EntraClientOutcomeCategory[] = [
  'ok',
  'need_consent',
  'conditional_access',
  'missing_role',
  'other',
];

function isSelection(value: unknown): value is EntraContinuationSelection {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.clientId === 'string' &&
    typeof entry.managedTenantId === 'string' &&
    typeof entry.entraTenantId === 'string'
  );
}

function isPending(value: unknown): value is EntraPendingYield | null {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.clientId === 'string' &&
    typeof p.managedTenantId === 'string' &&
    typeof p.entraTenantId === 'string' &&
    (p.nextLink === null || typeof p.nextLink === 'string') &&
    typeof p.counts === 'object'
  );
}

function isValidAggregate(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const aggregate = value as Record<string, unknown>;
  return OUTCOME_CATEGORIES.every((category) => typeof aggregate[category] === 'number');
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
    Array.isArray(p.recentResults) &&
    p.recentResults.length <= p.offset &&
    isValidAggregate(p.aggregate) &&
    typeof p.failedCount === 'number' &&
    p.failedCount >= 0 &&
    typeof p.warnCount === 'number' &&
    p.warnCount >= 0 &&
    Array.isArray(p.recommendations) &&
    p.recommendations.length <= MAX_EMBEDDED_RECOMMENDATIONS &&
    isPending(p.pending) &&
    typeof p.startedAt === 'number' &&
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
