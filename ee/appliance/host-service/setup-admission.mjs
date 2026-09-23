/**
 * Setup DNS admission.
 *
 * Setup must not redeem an install code, pull release metadata, or create
 * workloads until the cluster resolver is verified active for the *currently
 * requested* DNS configuration. A previously successful activation, a stale
 * pending record, or the 45-minute pending timeout must never authorize a new or
 * changed configuration, so admission always requests a fresh host reconcile
 * tied to the current setup inputs and requires the resulting activation both to
 * post-date those inputs and to carry their resolver-configuration fingerprint.
 *
 * Pure decision/orchestration helpers with the reconciler, clock and durable
 * result reader injected, so the lifecycle is unit-testable without k3s.
 */

// Pending records older than this are stale for *gating retries* (so a crashed
// reconciler cannot wedge setup forever) but are never treated as verified
// activation by admission.
export const DNS_PENDING_MAX_AGE_MS = 45 * 60 * 1000;

function parseTime(value) {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Decide whether `result` proves the configuration requested at `requestedAt`
 * is active. Only a fresh active record that post-dates the request *and* whose
 * activation carries the requested resolver fingerprint is trusted; a missing,
 * failed, pending, older or differently-configured record never authorizes
 * setup. The fingerprint check is what stops an activation submitted for one
 * DNS configuration from releasing the gate after the operator changed the
 * inputs, even when the completion arrives later than the new request.
 */
export function evaluateDnsAdmission({ requestedAt, requestedFingerprint, result } = {}) {
  if (!result || typeof result !== 'object') {
    return { ok: false, pending: true, error: 'Cluster DNS has not been reconciled for the current configuration.' };
  }
  if (result.ok === false || result.state === 'failed') {
    return { ok: false, pending: false, error: result.error || 'Cluster DNS reconciliation failed.' };
  }
  if (result.ok === true && result.state === 'active') {
    if (requestedFingerprint) {
      const activationFingerprint = result.activation?.configFingerprint || null;
      if (activationFingerprint !== requestedFingerprint) {
        return {
          ok: false,
          pending: true,
          error: 'The recorded cluster DNS activation is for a different resolver configuration than the current setup inputs; a fresh reconcile is required.'
        };
      }
    }
    const submitted = parseTime(result.submittedAt || result.at);
    const requested = parseTime(requestedAt);
    if (submitted !== null && requested !== null && submitted >= requested) {
      return { ok: true, pending: false, error: null };
    }
    return {
      ok: false,
      pending: true,
      error: 'The recorded cluster DNS activation predates the current DNS configuration; a fresh reconcile is required.'
    };
  }
  return { ok: false, pending: true, error: 'Cluster DNS activation is still pending for the current configuration.' };
}

/**
 * Trigger a reconcile for the current inputs and require its own verified
 * activation. `reconcileOnce` must serialize behind any in-flight run so the
 * result cannot belong to earlier inputs; `readResult` reads the durable record.
 * A skipped or thrown outcome is a hard hold: setup is never authorized against
 * unverified DNS.
 */
export async function ensureRequestedDnsActive({ requestedAt, requestedFingerprint, reconcileOnce, readResult, logger } = {}) {
  let outcome;
  try {
    outcome = await reconcileOnce();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, pending: false, error: `Cluster DNS reconciliation failed before activation: ${message}` };
  }
  if (!outcome || typeof outcome !== 'object' || outcome.skipped) {
    const skipped = outcome?.skipped || 'unknown';
    return {
      ok: false,
      pending: false,
      error: `Cluster DNS reconciliation could not run (${skipped}); setup cannot verify cluster DNS.`
    };
  }
  let result = outcome;
  if (typeof readResult === 'function') {
    try {
      result = readResult() || outcome;
    } catch {
      // A missing/unreadable durable record falls back to this reconcile's own
      // outcome rather than silently treating DNS as verified.
      result = outcome;
    }
  }
  const decision = evaluateDnsAdmission({ requestedAt, requestedFingerprint, result });
  if (!decision.ok && typeof logger?.warn === 'function') {
    logger.warn(`Cluster DNS admission held: ${decision.error}`);
  }
  return decision;
}
