/**
 * Periodic cluster-DNS reconciliation for the control plane.
 *
 * Existing installs must receive the search-free resolver without reinstalling.
 * The setup workflow writes the host resolver files, but only a host-owned k3s
 * restart makes already-running pods (Flux controllers, CoreDNS, the app) adopt
 * them. That restart replaces the control-plane pod that requested it, so the
 * reconciler treats the host's durable activation record as the source of truth:
 *
 *  1. it stages a privileged Job that hands the fixed helper to a host systemd
 *     unit (submission),
 *  2. records that submission as pending — never as success,
 *  3. follows the durable activation record until it reaches `active` (with the
 *     rollouts verified by the helper) or `failed`.
 *
 * Invariants:
 *  - Activation never runs while a setup workflow owns the host, so a reconcile
 *    tick cannot restart k3s out from under an in-progress install.
 *  - Single-flight: overlapping ticks cannot launch two reconcile Jobs. Because
 *    the durable activation is resumable, a tick that dies with the control
 *    plane is picked up by the next one without a second k3s restart.
 *  - The result is written atomically and survives a control-plane restart so a
 *    hard failure stays visible instead of being silently dropped. A submitted
 *    Job is `ok: null` (pending) until the host verifies rollout readiness.
 *
 * The module has no network or child-process side effects of its own: spawn, fs,
 * sleep and the clock are injectable so the lifecycle is unit-testable.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DNS_CONFIG_FINGERPRINT_ENV } from './dns-config.mjs';

export const DEFAULT_DNS_RECONCILE_INTERVAL_MS = 5 * 60 * 1000;
export const DEFAULT_DNS_RECONCILE_STARTUP_DELAY_MS = 10 * 1000;
export const DEFAULT_DNS_RECONCILE_MAX_AGE_MS = 30 * 60 * 1000;
export const DEFAULT_DNS_ACTIVATION_POLL_MS = 5 * 1000;

function defaultResultFile(stateFile) {
  const dir = stateFile ? path.dirname(stateFile) : '/var/lib/alga-appliance';
  return path.join(dir, 'dns-reconcile.json');
}

function defaultLogFile(stateFile) {
  const dir = stateFile ? path.dirname(stateFile) : '/var/lib/alga-appliance';
  return path.join(dir, 'dns-reconcile.log');
}

function defaultActivationFile(stateFile) {
  const dir = stateFile ? path.dirname(stateFile) : '/var/lib/alga-appliance';
  return path.join(dir, 'dns-activation.json');
}

function summarizeActivation(activation) {
  if (!activation || typeof activation !== 'object') return null;
  return {
    stage: activation.stage || null,
    fingerprint: activation.fingerprint || null,
    configFingerprint: activation.configFingerprint || null,
    updatedAt: activation.updatedAt || null,
    error: activation.error || null
  };
}

export function createDnsReconciler(options = {}) {
  const fsImpl = options.fs || fs;
  const now = options.now || (() => Date.now());
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const logger = options.logger || console;
  const spawnImpl = options.spawnImpl || spawn;
  const scriptPath = options.scriptPath;
  const kubeconfigPath = options.kubeconfigPath;
  const resultFile = options.resultFile || defaultResultFile(options.stateFile);
  const logFile = options.logFile || defaultLogFile(options.stateFile);
  const activationFile = options.activationFile || defaultActivationFile(options.stateFile);
  // The launcher waits for the staging Job to complete. That Job only writes the
  // helper and starts the host-owned activation unit, so it finishes before the
  // k3s restart and reports staging failure honestly.
  const runArgs = options.runArgs || [];
  const intervalMs = Number(options.intervalMs || DEFAULT_DNS_RECONCILE_INTERVAL_MS);
  const startupDelayMs = Number(options.startupDelayMs ?? DEFAULT_DNS_RECONCILE_STARTUP_DELAY_MS);
  const pollIntervalMs = Number(options.pollIntervalMs || DEFAULT_DNS_ACTIVATION_POLL_MS);
  const maxActivationWaitMs = Number(options.maxActivationWaitMs || DEFAULT_DNS_RECONCILE_MAX_AGE_MS);
  const disabled = Boolean(options.disabled);
  const shouldSkip = options.shouldSkip || (() => false);
  const spawnTimeoutMs = Number(options.spawnTimeoutMs || 10 * 60 * 1000);
  // Fingerprint of the setup inputs the control plane is asking this reconcile
  // to activate. Passed to the host helper, which recomputes it from the
  // persisted inputs and refuses to record a different configuration as active.
  const configFingerprint = options.configFingerprint ?? null;

  function currentConfigFingerprint() {
    if (typeof configFingerprint === 'function') {
      try {
        return String(configFingerprint() || '');
      } catch {
        return '';
      }
    }
    return String(configFingerprint || '');
  }

  let running = false;
  let timers = [];

  function readResult() {
    try {
      if (!fsImpl.existsSync(resultFile)) return null;
      const parsed = JSON.parse(fsImpl.readFileSync(resultFile, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  function readActivation() {
    try {
      if (!fsImpl.existsSync(activationFile)) return null;
      const parsed = JSON.parse(fsImpl.readFileSync(activationFile, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  function writeResult(value) {
    try {
      fsImpl.mkdirSync(path.dirname(resultFile), { recursive: true, mode: 0o750 });
      const temporaryFile = `${resultFile}.${process.pid}.${now()}.tmp`;
      fsImpl.writeFileSync(temporaryFile, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      fsImpl.renameSync(temporaryFile, resultFile);
      return true;
    } catch (error) {
      logger.error(`Could not persist DNS reconcile result: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  function appendLog(line) {
    try {
      fsImpl.appendFileSync(logFile, line.endsWith('\n') ? line : `${line}\n`, { mode: 0o600 });
    } catch {
      /* the durable result is what status reads */
    }
  }

  function runCommand() {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      let child;
      try {
        const fingerprint = currentConfigFingerprint();
        child = spawnImpl('bash', [scriptPath, '--kubeconfig', kubeconfigPath, ...runArgs], {
          env: fingerprint
            ? { ...process.env, [DNS_CONFIG_FINGERPRINT_ENV]: fingerprint }
            : process.env,
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } catch (error) {
        finish({ ok: false, error: error instanceof Error ? error.message : String(error) });
        return;
      }
      let stdout = '';
      let stderr = '';
      if (child.stdout) child.stdout.on('data', (chunk) => { stdout += chunk; });
      if (child.stderr) child.stderr.on('data', (chunk) => { stderr += chunk; });
      const timeout = setTimeout(() => {
        appendLog(`[${new Date().toISOString()}] DNS reconcile submission timed out; killing pid ${child.pid}`);
        try { child.kill('SIGKILL'); } catch { /* best effort */ }
      }, spawnTimeoutMs);
      timeout.unref?.();
      child.on('error', (error) => {
        clearTimeout(timeout);
        finish({ ok: false, error: error instanceof Error ? error.message : String(error) });
      });
      child.on('exit', (code, signal) => {
        clearTimeout(timeout);
        appendLog(`[${new Date().toISOString()}] DNS reconcile submission exited code=${code ?? 'null'} signal=${signal || 'none'}`);
        if (stdout) appendLog(stdout.trimEnd());
        if (stderr) appendLog(stderr.trimEnd());
        finish(code === 0 ? { ok: true } : { ok: false, error: (stderr || stdout || `DNS reconcile submission exited with code ${code ?? 1}`).trim() });
      });
    });
  }

  // Follow the host-owned activation record. A record that predates this
  // submission never counts: the helper republishes the stage (even a no-op
  // activation) after it runs, so a stale `active` cannot be mistaken for the
  // completion of the work just submitted.
  async function waitForActivation(baseline, submittedAt) {
    const baselineUpdatedAt = baseline?.updatedAt || null;
    const baselineStage = baseline?.stage || null;
    const baselineFingerprint = baseline?.fingerprint || null;
    const baselineConfigFingerprint = baseline?.configFingerprint || null;
    const deadline = now() + maxActivationWaitMs;
    for (;;) {
      const activation = readActivation();
      const changed = Boolean(activation) && (
        (activation.updatedAt || null) !== baselineUpdatedAt
        || (activation.stage || null) !== baselineStage
        || (activation.fingerprint || null) !== baselineFingerprint
        || (activation.configFingerprint || null) !== baselineConfigFingerprint
      );
      if (changed && activation.stage === 'active') {
        return {
          state: 'active',
          ok: true,
          error: null,
          activation: summarizeActivation(activation)
        };
      }
      if (changed && activation.stage === 'failed') {
        return {
          state: 'failed',
          ok: false,
          error: activation.error || 'Host cluster DNS activation failed.',
          activation: summarizeActivation(activation)
        };
      }
      if (now() >= deadline) {
        return {
          state: 'failed',
          ok: false,
          error: `Timed out waiting ${Math.round(maxActivationWaitMs / 1000)}s for host cluster DNS activation to complete.`,
          activation: summarizeActivation(activation)
        };
      }
      await sleep(pollIntervalMs);
    }
  }

  let currentRun = null;

  function runOnce(reason = 'manual') {
    if (disabled) return Promise.resolve({ skipped: 'disabled' });
    if (running) return Promise.resolve({ skipped: 'running' });
    if (!scriptPath || !fsImpl.existsSync(scriptPath)) {
      return Promise.resolve({ skipped: 'script-missing' });
    }
    let skip;
    try {
      skip = shouldSkip();
    } catch {
      skip = false;
    }
    if (skip) {
      return Promise.resolve({ skipped: 'setup-in-progress' });
    }

    running = true;
    const promise = (async () => {
      const submittedAt = new Date(now()).toISOString();
      const baseline = readActivation();
      appendLog(`[${submittedAt}] DNS reconcile trigger (${reason})`);
      try {
        // Persist the pending submission before spawning so a control-plane
        // restart during the Job/activation cannot leave a stale success behind.
        writeResult({
          state: 'submitted',
          ok: null,
          reason,
          at: submittedAt,
          submittedAt,
          error: null,
          activation: summarizeActivation(baseline),
          logFile
        });

        const outcome = await runCommand();
        if (!outcome.ok) {
          const record = {
            state: 'failed',
            ok: false,
            reason,
            at: new Date(now()).toISOString(),
            submittedAt,
            error: outcome.error || 'DNS reconcile submission failed.',
            activation: summarizeActivation(readActivation()),
            logFile
          };
          writeResult(record);
          logger.error(`Cluster DNS reconciliation failed: ${record.error}`);
          return record;
        }

        const activation = await waitForActivation(baseline, submittedAt);
        const record = {
          ...activation,
          reason,
          at: new Date(now()).toISOString(),
          submittedAt,
          logFile
        };
        writeResult(record);
        if (!record.ok) {
          logger.error(`Cluster DNS reconciliation failed: ${record.error}`);
        }
        return record;
      } finally {
        running = false;
        currentRun = null;
      }
    })();
    currentRun = promise;
    return promise;
  }

  // Serialized submission for admission: wait behind any in-flight run, then
  // start one that began *after* this call. This guarantees the verified result
  // belongs to the current request and not to a reconcile started for earlier
  // setup inputs.
  async function submit(reason = 'admission') {
    for (;;) {
      while (currentRun) {
        try {
          await currentRun;
        } catch {
          // runOnce surfaces failures through writeResult; keep waiting.
        }
      }
      const outcome = await runOnce(reason);
      if (!outcome || outcome.skipped !== 'running') return outcome;
    }
  }

  function start() {
    if (disabled) return;
    if (startupDelayMs >= 0) {
      const startupTimer = setTimeout(() => { runOnce('startup').catch(() => {}); }, startupDelayMs);
      startupTimer.unref?.();
      timers.push(startupTimer);
    }
    const intervalTimer = setInterval(() => { runOnce('periodic').catch(() => {}); }, intervalMs);
    intervalTimer.unref?.();
    timers.push(intervalTimer);
  }

  function shutdown() {
    for (const timer of timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    timers = [];
  }

  return { runOnce, submit, readResult, readActivation, writeResult, start, shutdown };
}
