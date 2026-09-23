/**
 * Bounded automatic retry for a blocked setup workflow.
 *
 * Extracted from server.mjs so the retry lifecycle — running-phase transitions,
 * failure persistence, attempt accounting, backoff, exhaustion and spawn
 * failures — is testable with an injectable clock, network probe and child
 * launcher.
 *
 * Invariants:
 *  - Running/queued work, missing or transient state, and intermediate phase
 *    completions never reset the budget or erase the last failure.
 *  - The attempt increment and failure snapshot are persisted BEFORE launching
 *    an automatic child, so a crash cannot lose or double-count a launch.
 *  - A failed/corrupt accounting read or write halts automatic launch instead
 *    of silently resetting the budget.
 *  - Only a new manual setup submission or verified whole-workflow success
 *    resets the active budget; prior history is marked resolved, not deleted.
 */
import fs from 'node:fs';
import path from 'node:path';

export const NETWORK_CLASS_PHASES = ['network', 'dns', 'registry-release-source'];
export const RETRY_HISTORY_LIMIT = 20;
export const DEFAULT_MAX_ATTEMPTS = 10;
export const DEFAULT_BACKOFF_BASE_MS = 15_000;
export const DEFAULT_BACKOFF_MAX_MS = 300_000;

export function installStateRunning(state) {
  const status = String(state?.status || '');
  return status === 'setup-queued' || status.endsWith('-running');
}

export function installStateBlocked(state) {
  const isAppUpdate = state?.update?.scope === 'application-only';
  return !isAppUpdate
    && Boolean(state?.failure)
    && state.failure.retrySafe !== false
    && String(state.status || '').includes('blocked');
}

export function isTerminalSuccess(state) {
  return Boolean(state?.terminalSuccess)
    && String(state?.status || '').endsWith('-complete')
    && !state?.failure;
}

// A status that looks like running work is only authoritative while its owner is
// alive. A k3s/DNS restart or a control-plane replacement can kill the detached
// setup engine mid-run, leaving a *-running status behind forever; without this
// check the retry budget would wedge and never resume the interrupted workflow.
export function isAbandonedRunning(state, workflowOwnerAlive) {
  if (!installStateRunning(state)) return false;
  if (typeof workflowOwnerAlive !== 'function') return false;
  try {
    return !workflowOwnerAlive(state);
  } catch {
    return false;
  }
}

export function failureCategory(state) {
  const phase = String(state?.failure?.phase || state?.phase || '').toLowerCase();
  return NETWORK_CLASS_PHASES.find((candidate) => phase.includes(candidate)) || phase;
}

export function backoffMs(attempts, baseMs = DEFAULT_BACKOFF_BASE_MS, maxMs = DEFAULT_BACKOFF_MAX_MS) {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempts - 1));
}

function readJson(file) {
  try {
    if (!file || !fs.existsSync(file)) return { value: null, missing: true, corrupt: false };
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { value: null, missing: false, corrupt: true, error: 'retry state is not a JSON object' };
    }
    return { value: parsed, missing: false, corrupt: false };
  } catch (error) {
    return { value: null, missing: false, corrupt: true, error: error instanceof Error ? error.message : String(error) };
  }
}

export function createSetupRetry(options = {}) {
  const stateFile = options.stateFile;
  const retryStateFile = options.retryStateFile
    || (stateFile ? path.join(path.dirname(stateFile), 'auto-retry-state.json') : 'auto-retry-state.json');
  const maxAttempts = Number(options.maxAttempts || DEFAULT_MAX_ATTEMPTS);
  const baseMs = Number(options.baseMs || DEFAULT_BACKOFF_BASE_MS);
  const maxMs = Number(options.maxMs || DEFAULT_BACKOFF_MAX_MS);
  const now = options.now || (() => Date.now());
  const probe = options.probe || (async () => ({ ok: true }));
  const launch = options.launch || (async () => ({ ok: true }));
  const disable = Boolean(options.disable);
  const logger = options.logger || console;
  const readInstallState = options.readInstallState
    || (() => readJson(stateFile).value);
  const workflowOwnerAlive = options.workflowOwnerAlive || (() => true);
  // Optional async predicate consulted before an automatic launch. When it
  // reports not-ready (e.g. cluster DNS activation is still pending) the retry is
  // deferred without consuming an attempt or dropping the failure snapshot.
  const readyBeforeLaunch = options.readyBeforeLaunch || null;

  let reconcileRunning = false;

  function readRetryState() {
    return readJson(retryStateFile);
  }

  function writeRetryState(value) {
    const dir = path.dirname(retryStateFile);
    fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
    const temporaryFile = path.join(dir, `.${path.basename(retryStateFile)}.${process.pid}.${now()}.tmp`);
    fs.writeFileSync(temporaryFile, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporaryFile, retryStateFile);
    // A failed write throws so the caller halts automatic launches instead of
    // resetting the budget.
  }

  function safeWrite(value) {
    try {
      writeRetryState(value);
      return true;
    } catch (error) {
      logger.error(`Could not persist retry accounting: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  function clearRetryState() {
    try {
      if (fs.existsSync(retryStateFile)) fs.unlinkSync(retryStateFile);
    } catch {
      /* best effort */
    }
  }

  function stateOf(retry) {
    return retry.corrupt ? {} : (retry.value || {});
  }

  function failureRecord(state, fallback, attempt, timestamp) {
    const failure = state?.failure || fallback || {};
    const categoryState = state?.failure
      ? state
      : { failure: fallback || {}, phase: fallback?.phase || state?.phase };
    return {
      attempt,
      at: new Date(timestamp).toISOString(),
      step: failure.step || null,
      phase: failure.phase || state?.phase || null,
      category: failureCategory(categoryState),
      message: failure.message || state?.lastAction || 'Setup failed.',
      details: failure.details || failure.suggestedNextStep || null,
      retrySafe: failure.retrySafe !== false
    };
  }

  function markResolved(reason) {
    const retry = readRetryState();
    if (retry.missing || retry.corrupt) return;
    const value = stateOf(retry);
    safeWrite({
      ...value,
      resolved: true,
      resolvedAt: new Date(now()).toISOString(),
      resolvedReason: reason,
      nextAttemptAt: null
    });
  }

  // Explicit new manual setup submission: reset the active budget but keep the
  // prior failure history as evidence, marked resolved.
  function reset(reason = 'manual-setup') {
    const retry = readRetryState();
    const value = stateOf(retry);
    const history = Array.isArray(value.history) ? value.history : [];
    writeRetryState({
      attempts: 0,
      maxAttempts,
      resolved: true,
      resetAt: new Date(now()).toISOString(),
      resetReason: reason,
      history,
      lastFailure: value.lastFailure || null
    });
  }

  function computeAutoRetrySummary(state) {
    if (disable) return undefined;
    const retry = readRetryState();
    if (retry.corrupt) {
      return {
        willRetry: false,
        exhausted: false,
        attempts: 0,
        maxAttempts,
        error: `Retry accounting is unreadable: ${retry.error}`,
        lastFailure: null
      };
    }
    const value = stateOf(retry);
    const attempts = Number(value.attempts || 0);
    const unresolved = Boolean(state?.failure) || Boolean(value.lastFailure && !value.resolved);
    if (!unresolved) return undefined;
    const lastFailure = value.lastFailure || null;
    if (attempts >= maxAttempts) {
      return { willRetry: false, exhausted: true, attempts, maxAttempts, lastFailure };
    }
    const nextAttemptInSeconds = value.nextAttemptAt
      ? Math.max(0, Math.round((value.nextAttemptAt - now()) / 1000))
      : 0;
    return { willRetry: true, exhausted: false, attempts, maxAttempts, nextAttemptInSeconds, lastFailure };
  }

  async function reconcile() {
    if (disable || reconcileRunning) return { skipped: 'disabled-or-running' };
    reconcileRunning = true;
    try {
      const state = readInstallState();
      const retry = readRetryState();

      if (isTerminalSuccess(state)) {
        markResolved('workflow-success');
        return { skipped: 'terminal-success' };
      }

      // A *-running status whose owner is dead was interrupted (for example by
      // the k3s restart that activates DNS isolation). Treat it as abandoned so
      // the retained failure can be retried instead of wedging the budget.
      const abandoned = isAbandonedRunning(state, workflowOwnerAlive);
      if (installStateRunning(state) && !abandoned) return { skipped: 'running' };
      if (!state) return { skipped: 'not-blocked' };

      if (retry.corrupt) {
        logger.error(`Automatic retries halted: retry accounting is unreadable (${retry.error}).`);
        return { skipped: 'accounting-corrupt', error: retry.error };
      }
      const value = stateOf(retry);
      const lastFailure = value.lastFailure || null;
      const blocked = installStateBlocked(state)
        || (abandoned && lastFailure && lastFailure.retrySafe !== false);
      if (!blocked) return { skipped: 'not-blocked' };

      const attempts = Number(value.attempts || 0);
      if (attempts >= maxAttempts) return { skipped: 'exhausted', attempts };

      const timestamp = now();
      if (value.nextAttemptAt && timestamp < value.nextAttemptAt) {
        return { skipped: 'backoff', attempts };
      }

      const categoryState = state?.failure ? state : { failure: lastFailure || {}, phase: lastFailure?.phase || state?.phase };
      if (NETWORK_CLASS_PHASES.includes(failureCategory(categoryState))) {
        let healthy = true;
        try {
          healthy = Boolean((await probe())?.ok);
        } catch {
          healthy = false;
        }
        if (!healthy) {
          safeWrite({
            ...value,
            attempts,
            maxAttempts,
            nextAttemptAt: timestamp + backoffMs(Math.max(attempts, 1), baseMs, maxMs),
            lastReason: 'network still unhealthy'
          });
          return { skipped: 'network-unhealthy', attempts };
        }
      }

      if (typeof readyBeforeLaunch === 'function') {
        let readiness;
        try {
          readiness = await readyBeforeLaunch();
        } catch {
          readiness = { ok: false, reason: 'Readiness check failed.' };
        }
        if (readiness && readiness.ok === false) {
          safeWrite({
            ...value,
            attempts,
            maxAttempts,
            nextAttemptAt: timestamp + backoffMs(Math.max(attempts, 1), baseMs, maxMs),
            lastReason: readiness.reason || 'not ready to launch'
          });
          return { skipped: readiness.pending ? 'dns-pending' : 'not-ready', attempts };
        }
      }

      const nextAttempts = attempts + 1;
      const record = failureRecord(state, lastFailure, nextAttempts, timestamp);
      const history = [...(Array.isArray(value.history) ? value.history : []), record].slice(-RETRY_HISTORY_LIMIT);
      try {
        writeRetryState({
          setupRunId: state.setupRunId || value.setupRunId || null,
          attempts: nextAttempts,
          maxAttempts,
          lastAttemptAt: new Date(timestamp).toISOString(),
          nextAttemptAt: timestamp + backoffMs(nextAttempts, baseMs, maxMs),
          lastFailure: record,
          history,
          resolved: false
        });
      } catch (error) {
        logger.error(`Refusing automatic launch: could not persist retry accounting (${error instanceof Error ? error.message : String(error)}).`);
        return { skipped: 'accounting-write-failed', attempts, error: error instanceof Error ? error.message : String(error) };
      }

      let launchResult;
      try {
        launchResult = await launch({ attempt: nextAttempts, failure: record });
      } catch (error) {
        launchResult = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      if (!launchResult || launchResult.ok === false) {
        const message = launchResult?.error || 'unknown error';
        const failedRecord = {
          ...record,
          message: `Automatic setup launch failed: ${message}`,
          details: message,
          launchFailed: true
        };
        safeWrite({
          ...stateOf(readRetryState()),
          lastFailure: failedRecord,
          history: [...history, failedRecord].slice(-RETRY_HISTORY_LIMIT),
          resolved: false
        });
        return { launched: false, attempts: nextAttempts, launchError: message };
      }
      return { launched: true, attempts: nextAttempts };
    } finally {
      reconcileRunning = false;
    }
  }

  return {
    reconcile,
    computeAutoRetrySummary,
    reset,
    markResolved,
    clearRetryState,
    readRetryState,
    writeRetryState
  };
}
