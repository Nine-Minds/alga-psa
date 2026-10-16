/**
 * Shared handling of the alga-license `/check-in` response.
 *
 * Both callers — the License page's "Refresh license now" action and the daily
 * Temporal check-in activity — interpret the response and persist its result
 * through this module so they cannot drift. The transport (fetch, retries,
 * error surfacing) stays with each caller.
 *
 * Contract (alga-license `CheckInResponse`):
 *   200 {status:'ok', jwt, exp, subscription?}   fresh/unchanged token
 *   200 {status:'no_change', subscription?}
 *   200 {status:'revoked', subscription?}        soft lapse — NEVER hard-cut the
 *                                                stored token; it grace-expires
 *   401 {code:'revoked_appliance'}               this appliance's credential was
 *                                                revoked (rebind/compromise)
 * `subscription` is optional and parsed defensively: unknown/malformed values
 * are ignored, never thrown, so legacy servers and future fields are safe.
 */
import { getLicenseStateRow, upsertLicenseState } from './license-state';
import type { LicenseStateRow, SubscriptionStateValue } from './license-state';

export interface CheckInSubscription {
  state: SubscriptionStateValue | null;
  cancelsAt: Date | null;
  /** Unix seconds `exp` of the token the server believes we hold. Informational. */
  licenseValidUntil: number | null;
  resubscribeUrl: string | null;
}

export type CheckInResult =
  | { kind: 'ok'; jwt: string | null; exp: number | null; subscription: CheckInSubscription | null }
  | { kind: 'no_change'; subscription: CheckInSubscription | null }
  /** Soft lapse: the subscription is no longer active. */
  | { kind: 'lapsed'; subscription: CheckInSubscription | null }
  /** 401 revoked_appliance (or any 401/403): credential hard-revoked. */
  | { kind: 'credential_revoked' }
  /** 5xx — transient. */
  | { kind: 'server_error'; httpStatus: number }
  /** Other non-OK status, or an unreadable/unknown 200 body. */
  | { kind: 'rejected'; httpStatus: number };

const SUBSCRIPTION_STATES: readonly SubscriptionStateValue[] = ['active', 'cancel_scheduled', 'cancelled'];
const MAX_URL_LENGTH = 2048;

/** Only http(s) URLs are accepted — this value becomes a clickable link. */
function parseHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Parse the optional `subscription` object. Returns null when absent or not an
 * object; individual unknown/malformed fields become null.
 */
export function parseCheckInSubscription(raw: unknown): CheckInSubscription | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const state = SUBSCRIPTION_STATES.includes(r.state as SubscriptionStateValue)
    ? (r.state as SubscriptionStateValue)
    : null;

  let cancelsAt: Date | null = null;
  if (typeof r.cancels_at === 'string') {
    const d = new Date(r.cancels_at);
    if (!Number.isNaN(d.getTime())) cancelsAt = d;
  }

  const licenseValidUntil =
    typeof r.license_valid_until === 'number' && Number.isFinite(r.license_valid_until) && r.license_valid_until > 0
      ? r.license_valid_until
      : null;

  return { state, cancelsAt, licenseValidUntil, resubscribeUrl: parseHttpUrl(r.resubscribe_url) };
}

/**
 * Interpret a check-in HTTP response. `body` is the parsed JSON (or undefined
 * when the body was absent/unreadable); it is never trusted to be well-formed.
 */
export function interpretCheckInResponse(httpStatus: number, body: unknown): CheckInResult {
  if (httpStatus === 401 || httpStatus === 403) return { kind: 'credential_revoked' };
  if (httpStatus >= 500) return { kind: 'server_error', httpStatus };
  if (httpStatus < 200 || httpStatus >= 300) return { kind: 'rejected', httpStatus };

  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  const subscription = parseCheckInSubscription(b?.subscription);

  switch (b?.status) {
    case 'revoked':
      return { kind: 'lapsed', subscription };
    case 'no_change':
      return { kind: 'no_change', subscription };
    case 'ok':
      return {
        kind: 'ok',
        jwt: typeof b.jwt === 'string' && b.jwt ? b.jwt : null,
        exp: typeof b.exp === 'number' && Number.isFinite(b.exp) ? b.exp : null,
        subscription,
      };
    default:
      return { kind: 'rejected', httpStatus };
  }
}

type SubscriptionColumns = Pick<
  LicenseStateRow,
  | 'subscription_state'
  | 'subscription_cancels_at'
  | 'subscription_resubscribe_url'
  | 'subscription_context_updated_at'
>;

const CLEARED: SubscriptionColumns = {
  subscription_state: null,
  subscription_cancels_at: null,
  subscription_resubscribe_url: null,
  subscription_context_updated_at: null,
};

/**
 * Map a check-in result to the `license_state` column updates it implies, or
 * null when nothing should be written (failure results).
 *
 *  - ok / no_change with state 'active' or no subscription data → clear the
 *    context (reactivation removes the warning in the same write that stores the
 *    new token).
 *  - ok / no_change with cancel_scheduled|cancelled → store it.
 *  - lapsed → store 'cancelled' (a legacy bare `{status:'revoked'}` still marks
 *    the lapse; date and URL are then simply unknown).
 * `license_token` is never touched here for lapsed — soft revocation keeps it.
 */
export function checkInStateUpdate(
  result: CheckInResult,
  currentToken: string | null,
  now: Date = new Date(),
): Partial<Omit<LicenseStateRow, 'id' | 'updated_at'>> | null {
  switch (result.kind) {
    case 'ok':
    case 'no_change': {
      const sub = result.subscription;
      const tokenFields =
        result.kind === 'ok' && result.jwt && result.jwt !== currentToken ? { license_token: result.jwt } : {};
      const subFields: SubscriptionColumns =
        sub && (sub.state === 'cancel_scheduled' || sub.state === 'cancelled')
          ? {
              subscription_state: sub.state,
              subscription_cancels_at: sub.cancelsAt,
              subscription_resubscribe_url: sub.resubscribeUrl,
              subscription_context_updated_at: now,
            }
          : // A bare no_change carries no verdict; leave stored context alone.
            result.kind === 'no_change' && !sub
            ? ({} as SubscriptionColumns)
            : CLEARED;
      return { ...tokenFields, ...subFields, last_checkin_at: now };
    }
    case 'lapsed': {
      const sub = result.subscription;
      return {
        subscription_state: 'cancelled',
        subscription_cancels_at: sub?.cancelsAt ?? null,
        subscription_resubscribe_url: sub?.resubscribeUrl ?? null,
        subscription_context_updated_at: now,
        last_checkin_at: now,
      };
    }
    default:
      return null;
  }
}

/**
 * Persist a check-in result on the license_state singleton. Returns the fields
 * written (null when the result is a failure and nothing was written).
 */
export async function applyCheckInResult(
  result: CheckInResult,
  row?: LicenseStateRow | null,
): Promise<ReturnType<typeof checkInStateUpdate>> {
  const current = row ?? (await getLicenseStateRow());
  const fields = checkInStateUpdate(result, current?.license_token ?? null);
  if (fields) await upsertLicenseState(fields);
  return fields;
}
