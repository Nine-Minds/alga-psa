/**
 * Periodic cluster-DNS reconciliation for the control plane.
 *
 * Existing installs must receive the search-free resolver without reinstalling.
 * The setup workflow writes the host resolver files, but only a k3s restart makes
 * already-running pods (Flux controllers, CoreDNS, the app) adopt them. That
 * restart kills the control-plane pod that starts it, so a separate reconciler
 * owns activation: it runs on control-plane startup and on an interval, invokes
 * the fixed host launcher, and records a durable result for status.
 *
 * Invariants:
 *  - Activation never runs while a setup workflow owns the host, so a reconcile
 *    tick cannot restart k3s out from under an in-progress install.
 *  - Single-flight: overlapping ticks cannot launch two reconcile Jobs.
 *  - The result is written atomically and survives a control-plane restart so a
 *    hard failure stays visible instead of being silently dropped.
 *
 * The module has no network or child-process side effects of its own: spawn, fs
 * and the clock are injectable so the lifecycle is unit-testable.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const DEFAULT_DNS_RECONCILE_INTERVAL_MS = 5 * 60 * 1000;
export const DEFAULT_DNS_RECONCILE_STARTUP_DELAY_MS = 10 * 1000;
export const DEFAULT_DNS_RECONCILE_MAX_AGE_MS = 30 * 60 * 1000;

function defaultResultFile(stateFile) {
  const dir = stateFile ? path.dirname(stateFile) : '/var/lib/alga-appliance';
  return path.join(dir, 'dns-reconcile.json');
}

function defaultLogFile(stateFile) {
  const dir = stateFile ? path.dirname(stateFile) : '/var/lib/alga-appliance';
  return path.join(dir, 'dns-reconcile.log');
}

export function createDnsReconciler(options = {}) {
  const fsImpl = options.fs || fs;
  const now = options.now || (() => Date.now());
  const logger = options.logger || console;
  const spawnImpl = options.spawnImpl || spawn;
  const scriptPath = options.scriptPath;
  const kubeconfigPath = options.kubeconfigPath;
  const resultFile = options.resultFile || defaultResultFile(options.stateFile);
  const logFile = options.logFile || defaultLogFile(options.stateFile);
  const runArgs = options.runArgs || ['--no-wait'];
  const intervalMs = Number(options.intervalMs || DEFAULT_DNS_RECONCILE_INTERVAL_MS);
  const startupDelayMs = Number(options.startupDelayMs ?? DEFAULT_DNS_RECONCILE_STARTUP_DELAY_MS);
  const disabled = Boolean(options.disabled);
  const shouldSkip = options.shouldSkip || (() => false);
  const spawnTimeoutMs = Number(options.spawnTimeoutMs || 10 * 60 * 1000);

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
        child = spawnImpl('bash', [scriptPath, '--kubeconfig', kubeconfigPath, ...runArgs], {
          env: process.env,
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
        appendLog(`[${new Date().toISOString()}] DNS reconcile timed out; killing pid ${child.pid}`);
        try { child.kill('SIGKILL'); } catch { /* best effort */ }
      }, spawnTimeoutMs);
      timeout.unref?.();
      child.on('error', (error) => {
        clearTimeout(timeout);
        finish({ ok: false, error: error instanceof Error ? error.message : String(error) });
      });
      child.on('exit', (code, signal) => {
        clearTimeout(timeout);
        appendLog(`[${new Date().toISOString()}] DNS reconcile exited code=${code ?? 'null'} signal=${signal || 'none'}`);
        if (stdout) appendLog(stdout.trimEnd());
        if (stderr) appendLog(stderr.trimEnd());
        finish(code === 0 ? { ok: true } : { ok: false, error: (stderr || stdout || `DNS reconcile exited with code ${code ?? 1}`).trim() });
      });
    });
  }

  async function runOnce(reason = 'manual') {
    if (disabled) return { skipped: 'disabled' };
    if (running) return { skipped: 'running' };
    if (!scriptPath || !fsImpl.existsSync(scriptPath)) {
      return { skipped: 'script-missing' };
    }
    let skip;
    try {
      skip = shouldSkip();
    } catch {
      skip = false;
    }
    if (skip) {
      return { skipped: 'setup-in-progress' };
    }

    running = true;
    const startedAt = now();
    appendLog(`[${new Date(startedAt).toISOString()}] DNS reconcile trigger (${reason})`);
    try {
      const outcome = await runCommand();
      const record = {
        ok: Boolean(outcome.ok),
        skipped: false,
        reason,
        at: new Date(now()).toISOString(),
        error: outcome.ok ? null : (outcome.error || 'DNS reconciliation failed.'),
        logFile
      };
      writeResult(record);
      if (!record.ok) {
        logger.error(`Cluster DNS reconciliation failed: ${record.error}`);
      }
      return record;
    } finally {
      running = false;
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

  return { runOnce, readResult, writeResult, start, shutdown };
}
