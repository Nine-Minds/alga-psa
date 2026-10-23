/**
 * Cluster-DNS setup launch gate.
 *
 * Setup must not redeem a code or let Flux pull through a resolver that still
 * leaks the customer search suffix, so a new setup workflow is refused while the
 * host's durable DNS reconcile result is `failed` or an in-flight `submitted`
 * activation is still pending. A pending record older than the activation wait
 * budget is treated as stale so a crashed reconciler cannot wedge setup forever.
 *
 * Pure decision helper so the gate is testable without server side effects.
 */

export const DNS_PENDING_MAX_AGE_MS = 45 * 60 * 1000;

export function dnsReconcileLaunchBlocker(result, nowMs = Date.now()) {
  if (!result || typeof result !== 'object') return null;
  if (result.ok === false && result.state === 'failed') {
    return { pending: false, error: result.error || 'Cluster DNS reconciliation failed.' };
  }
  if (result.state === 'submitted' && result.ok === null) {
    const submittedAt = Date.parse(result.submittedAt || result.at || '');
    if (Number.isFinite(submittedAt) && nowMs - submittedAt > DNS_PENDING_MAX_AGE_MS) {
      return null;
    }
    return { pending: true, error: result.error || 'Cluster DNS activation is still running.' };
  }
  return null;
}

export function dnsBlockerMessage(blocker) {
  return `Cluster DNS is not ready: ${blocker.error} ${blocker.pending
    ? 'Wait for host activation to finish'
    : 'Resolve the DNS blocker'}; setup is gated until cluster DNS is active.`;
}
