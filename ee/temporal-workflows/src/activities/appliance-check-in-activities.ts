/**
 * Appliance license check-in activity.
 *
 * The daily caller for a CONNECTED on-prem appliance. The install-code redeem
 * (alga-license POST /register) hands the appliance a long-lived
 * `appliance_credential` + a `check_in_url`, stored in the `license_state`
 * singleton. The connected license JWT (`license_state.license_token`) carries
 * only ~`connectedLicenseDays` (31) of life, so it must be renewed.
 *
 * This activity POSTs the credential to the check-in URL. The alga-license
 * service (checkIn.ts) re-signs the token to roll its `exp` forward (it only
 * re-signs when the held token has < days-1 of life left, so with a daily
 * cadence the box stays ~31 days fresh and keeps ≥30 days of grace if it goes
 * offline). On a cancelled/soft-revoked entitlement the service returns
 * `{status:'revoked'}`: we HONOR GRACE — leave the current token in place so it
 * expires naturally at its `exp` (resolveSelfHostTier then drops to essentials)
 * rather than hard-cutting, which a transient/erroneous 'revoked' must not do.
 *
 * Self-host only. On SaaS/cloud there is no `license_state` row, and on an
 * essentials / airgap / CE / trial install there is no connected credential —
 * both cases no-op.
 */

import { Context } from '@temporalio/activity';
import { getAdminConnection } from '@alga-psa/db/admin.js';
import { applyCheckInResult, interpretCheckInResponse } from '@alga-psa/licensing';

const logger = () => Context.current().log;

export type ApplianceCheckInOutcome =
  | 'not_self_host' // no license_state row (SaaS/cloud) — no-op
  | 'not_connected' // self-host but no connected credential/url — no-op
  | 'refreshed' // server returned a new token; stored
  | 'unchanged' // server ok, token did not change (no resign needed)
  | 'revoked' // entitlement soft-revoked (subscription lapsed); grace-expire, token left intact
  | 'credential_revoked' // 401: THIS appliance's credential was hard-revoked — re-connect with a new claim code
  | 'error'; // other deterministic HTTP error (4xx) — recorded, not retried

export interface ApplianceCheckInResult {
  outcome: ApplianceCheckInOutcome;
  /** `exp` (unix seconds) of the current token after the check-in, when known. */
  exp?: number;
  detail?: string;
}

/**
 * Run a single license check-in for this install. Throws on transient failures
 * (network error / 5xx) so Temporal retries per the workflow's retry policy;
 * returns (no throw) on deterministic outcomes so the daily schedule — not a
 * tight retry loop — is what re-attempts them.
 */
export async function applianceLicenseCheckInActivity(): Promise<ApplianceCheckInResult> {
  const log = logger();
  const knex = await getAdminConnection();

  // license_state is install-wide admin metadata; keep it on the admin
  // connection rather than tenantDb.
  const row = await knex('license_state').orderBy('id').first();
  if (!row) {
    // SaaS/cloud: no self-host license state — nothing to check in.
    return { outcome: 'not_self_host' };
  }

  const credential: string | null = row.appliance_credential ?? null;
  const checkInUrl: string | null = row.check_in_url ?? null;
  if (!credential || !checkInUrl) {
    // Essentials / airgap / CE / trial: not a connected install.
    return { outcome: 'not_connected' };
  }

  log.info('Appliance license check-in starting', { checkInUrl });

  let res: Response;
  try {
    res = await fetch(checkInUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appliance_credential: credential }),
    });
  } catch (err: any) {
    // Network failure — keep the current token (grace) and let Temporal retry.
    log.warn('Appliance check-in network error; will retry', { error: err?.message });
    throw err;
  }

  // Response parsing and the license_state mapping are shared with the License
  // page's "Refresh license now" action (see @alga-psa/licensing license-check-in).
  const body: unknown = await res.json().catch(() => undefined);
  const result = interpretCheckInResponse(res.status, body);

  switch (result.kind) {
    case 'server_error': {
      // Server-side error — transient; let Temporal retry.
      log.warn('Appliance check-in 5xx; will retry', { status: result.httpStatus });
      throw new Error(`check-in failed: HTTP ${result.httpStatus}`);
    }
    case 'credential_revoked':
      // 401 revoked_appliance: a hard revocation of this appliance's credential
      // (rebind/compromise) — distinct from a lapsed subscription. Honor grace:
      // do not touch the token, and leave last_checkin_at as the last time the
      // service accepted us. The daily schedule re-attempts; don't spin.
      log.warn('Appliance check-in rejected: credential revoked; re-connect with a new claim code', { status: res.status });
      return { outcome: 'credential_revoked', detail: `HTTP ${res.status}` };
    case 'rejected':
      log.warn('Appliance check-in rejected', { status: res.status });
      return { outcome: 'error', detail: `HTTP ${res.status}` };
    case 'lapsed':
      // Soft revocation: the subscription lapsed and the service stops issuing
      // fresh tokens. Honor grace — leave license_token intact so the box stays
      // licensed until the current token's exp, then resolveSelfHostTier falls
      // to essentials on its own. Record the subscription context for the UI.
      await applyCheckInResult(result, row);
      log.warn('Appliance license subscription lapsed; honoring grace (token left intact)', {
        cancelsAt: result.subscription?.cancelsAt?.toISOString(),
      });
      return { outcome: 'revoked' };
    case 'ok':
    case 'no_change': {
      // 200 = the service processed our check-in: records last_checkin_at, stores
      // a fresh token if one came back, and sets/clears the subscription context
      // (reactivation clears the warning in the same write as the new token).
      // getLicenseStateRow always reads the DB and the verify cache is keyed by
      // token string, so the server process picks up the new token as a cache
      // miss on its next read — no cross-process cache coordination needed.
      const fields = await applyCheckInResult(result, row);
      const exp = result.kind === 'ok' ? result.exp ?? undefined : undefined;
      if (fields && 'license_token' in fields) {
        log.info('Appliance license token refreshed', { exp });
        return { outcome: 'refreshed', exp };
      }
      log.info('Appliance check-in ok; token unchanged', { exp });
      return { outcome: 'unchanged', exp };
    }
  }
}
