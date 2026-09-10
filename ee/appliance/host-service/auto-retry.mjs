// Auto-retry bookkeeping for the fire-once setup workflow.
//
// The control plane re-runs a retry-safe blocked setup on its own (see
// server.mjs). Pure decision logic lives here so the counter/backoff/history
// rules are unit-testable without spawning the server, and so the status
// snapshot and the reconciler read the same retry state the same way.
//
// Retry state is one small JSON file next to install-state.json:
//   {
//     attempts:       number of automatic re-runs launched so far,
//     lastAttemptAt:  ISO time the latest re-run was launched,
//     nextAttemptAt:  epoch ms before which no further re-run is launched,
//     lastReason:     free text (e.g. "network still unhealthy"),
//     lastFailure:    snapshot of the install-state failure that triggered the
//                     latest re-run,
//     history:        bounded list of those snapshots, oldest first
//   }
//
// Because every workflow phase rewrites install-state.json wholesale, the
// failure that triggered a re-run is gone from install-state within seconds of
// the re-run starting. lastFailure/history are the durable record of what kept
// failing; the status snapshot surfaces them while the retried run is in flight.

export const DEFAULT_MAX_ATTEMPTS = 10;
export const DEFAULT_BASE_MS = 15_000;
export const DEFAULT_MAX_MS = 300_000;
export const HISTORY_LIMIT = 10;
export const NETWORK_CLASS_PHASES = ['network', 'dns', 'registry-release-source'];

export function installStateBlocked(state) {
  const isAppUpdate = state?.update?.scope === 'application-only';
  return !isAppUpdate
    && Boolean(state?.failure)
    && state.failure.retrySafe !== false
    && String(state.status || '').includes('blocked');
}

export function installStateRunning(state) {
  const status = String(state?.status || '');
  return status === 'setup-queued' || status.endsWith('-running');
}

export function failureCategory(state) {
  const phase = String(state?.failure?.phase || state?.phase || '').toLowerCase();
  return NETWORK_CLASS_PHASES.find((candidate) => phase.includes(candidate)) || phase;
}

export function backoffMs(attempts, { baseMs = DEFAULT_BASE_MS, maxMs = DEFAULT_MAX_MS } = {}) {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempts - 1));
}

// Durable snapshot of the blocked install-state that triggered re-run #attempt.
export function failureSnapshot(state, attempt, at) {
  const failure = state?.failure || {};
  return {
    attempt,
    at,
    status: state?.status || null,
    phase: failure.phase || state?.phase || null,
    step: failure.step || null,
    message: failure.message || state?.lastAction || 'Setup step failed.',
    details: failure.details || failure.suggestedNextStep || null,
    retrySafe: failure.retrySafe !== false
  };
}

function appendHistory(history, entry) {
  const list = Array.isArray(history) ? history.slice() : [];
  list.push(entry);
  return list.slice(-HISTORY_LIMIT);
}

// Decide what the reconciler should do for the current install-state.
//
//   clear      – setup is neither blocked nor running (it completed, or the
//                file is gone): forget the retry bookkeeping.
//   hold       – a run is in flight (possibly one we launched), or the blocker
//                is not retry-safe: keep the bookkeeping untouched. Holding
//                while running is what keeps the attempt counter monotonic
//                across our own re-queues; clearing here would reset it every
//                cycle and turn the attempt cap into an infinite loop.
//   exhausted  – cap reached: leave the blocked state for the operator.
//   backoff    – still inside the backoff window.
//   retry      – launch attempt `attempt`; `retryState` is what to persist
//                before launching. `requiresNetworkProbe` says the caller
//                should confirm the live network is healthy first and call
//                deferForNetwork() instead if it is not.
export function decideAutoRetry({
  state,
  retry = {},
  now = Date.now(),
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  baseMs = DEFAULT_BASE_MS,
  maxMs = DEFAULT_MAX_MS
}) {
  if (!state) return { action: 'clear' };
  if (installStateRunning(state)) return { action: 'hold', reason: 'running' };
  if (!installStateBlocked(state)) {
    return state.failure ? { action: 'hold', reason: 'not-retry-safe' } : { action: 'clear' };
  }

  const attempts = Number(retry.attempts || 0);
  if (attempts >= maxAttempts) return { action: 'exhausted', attempts };
  if (retry.nextAttemptAt && now < retry.nextAttemptAt) {
    return { action: 'backoff', attempts, nextAttemptAt: retry.nextAttemptAt };
  }

  const attempt = attempts + 1;
  const at = new Date(now).toISOString();
  const snapshot = failureSnapshot(state, attempt, at);
  return {
    action: 'retry',
    attempt,
    requiresNetworkProbe: NETWORK_CLASS_PHASES.includes(failureCategory(state)),
    failure: snapshot,
    retryState: {
      ...retry,
      attempts: attempt,
      lastAttemptAt: at,
      nextAttemptAt: now + backoffMs(attempt, { baseMs, maxMs }),
      lastReason: null,
      lastFailure: snapshot,
      history: appendHistory(retry.history, snapshot)
    }
  };
}

// The live network probe is unhealthy: do not spend an attempt, just push the
// next check out by one backoff step.
export function deferForNetwork(retry = {}, now = Date.now(), { baseMs = DEFAULT_BASE_MS, maxMs = DEFAULT_MAX_MS } = {}) {
  const attempts = Number(retry.attempts || 0);
  return {
    ...retry,
    attempts,
    nextAttemptAt: now + backoffMs(attempts || 1, { baseMs, maxMs }),
    lastReason: 'network still unhealthy'
  };
}

// Summary for the status snapshot. Returns undefined when there is nothing
// worth showing: retries disabled, or no retry bookkeeping and not blocked.
export function summarizeAutoRetry({
  state,
  retry = {},
  now = Date.now(),
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  disabled = false
}) {
  if (disabled) return undefined;
  const attempts = Number(retry.attempts || 0);
  const common = {
    attempts,
    maxAttempts,
    lastAttemptAt: retry.lastAttemptAt || null,
    lastFailure: retry.lastFailure || null,
    history: Array.isArray(retry.history) ? retry.history : []
  };

  if (installStateRunning(state)) {
    // A retried run is in flight: install-state no longer carries the failure
    // that caused it, so the summary is the only place it is visible.
    if (attempts === 0) return undefined;
    return { ...common, inFlight: true, willRetry: false, exhausted: false, nextAttemptInSeconds: 0 };
  }

  if (!installStateBlocked(state)) return undefined;

  if (attempts >= maxAttempts) {
    return { ...common, inFlight: false, willRetry: false, exhausted: true, nextAttemptInSeconds: 0 };
  }
  const nextAttemptInSeconds = retry.nextAttemptAt
    ? Math.max(0, Math.round((retry.nextAttemptAt - now) / 1000))
    : 0;
  return { ...common, inFlight: false, willRetry: true, exhausted: false, nextAttemptInSeconds };
}
