/**
 * Does an accounting connection need a human to re-authorise it?
 *
 * Xero invalidates a refresh token for good once it rejects it, and the only
 * record of that is the message the last sync cycle stored — hence the
 * heuristic: no live access token plus a cycle error that names re-auth.
 *
 * Lives here, dependency-free, because two surfaces answer the same question:
 * the integration settings health panel (packages/billing) and the shell
 * integration-health banner (this package). Keeping one predicate means the
 * banner can never claim a reconnect the panel denies.
 */
export interface AccountingReconnectHeuristicInput {
  /** Sync adapter type, e.g. 'xero' or 'quickbooks_online'. */
  adapterType: string | null | undefined;
  /** Access-token expiry (ISO 8601) from the stored connection. */
  accessTokenExpiresAt?: string | null;
  /** `error` of the most recent sync cycle for this adapter + realm. */
  lastCycleError?: string | null;
  /** Injectable clock, in epoch ms; defaults to now. */
  nowMs?: number;
}

const RECONNECT_ERROR_MARKERS = [
  'refresh token was rejected',
  're-authentication is required',
  'reconnect required',
  'token expired',
];

export function isAccountingReconnectRequired(input: AccountingReconnectHeuristicInput): boolean {
  if (input.adapterType !== 'xero') {
    return false;
  }

  const expiresAt = input.accessTokenExpiresAt ? Date.parse(input.accessTokenExpiresAt) : Number.NaN;
  const hasFreshAccessToken = Number.isFinite(expiresAt) && expiresAt > (input.nowMs ?? Date.now());
  if (hasFreshAccessToken) {
    return false;
  }

  const lastCycleError = input.lastCycleError?.toLowerCase() ?? '';
  return RECONNECT_ERROR_MARKERS.some((marker) => lastCycleError.includes(marker));
}
