// Automatic recovery of HelmReleases that stalled only because their workloads
// were slow to become ready.
//
// The appliance runs install/upgrade remediation with retries 0 (Helm
// remediation could uninstall PVC-backed releases), so one failed attempt
// leaves a release Stalled/RetriesExceeded and helm-controller never tries it
// again. On a slow box the common failure is not a bad chart: Helm applied the
// upgrade, a Deployment missed its progress deadline while pods were still
// pulling or starting ("failed early due to stalled resources: [Deployment/...
// status: 'Failed']"), and minutes later the pods were healthy. Field example
// (2026-10-05): email-service, temporal-worker and workflow-worker sat stalled
// for over a day with every replica updated and available, and the Overview
// reported background issues until someone pressed "Recover releases".
//
// This runner notices that state and does the reset itself, narrowly:
//   - the latest Helm revision failed while waiting for resources (a rollout
//     timeout, not a render/apply/hook error);
//   - every resource the failure named, and every workload the release owns,
//     is a Deployment/StatefulSet/DaemonSet that is now fully rolled out and
//     available; no Job of the release is running or failed;
//   - that failed revision has not been re-run automatically before, and the
//     release is under its attempt budget.
// It then runs the same force + reset as the manual button and records what it
// did, why, and (on later ticks) whether the re-run converged, so the status UI
// can say "recovered automatically" instead of leaving an unexplained blocker.

import fs from 'node:fs';
import path from 'node:path';
import {
  APPLIANCE_HELM_RELEASES,
  APPLIANCE_HELM_RELEASE_NAMESPACE,
  clearBootstrapJob,
  forceHelmReleaseReconcile,
  summarizeHelmRelease
} from './helm-release-recovery.mjs';

export const DEFAULT_RELEASE_AUTO_RECOVERY_INTERVAL_MS = 2 * 60 * 1000;
export const DEFAULT_RELEASE_AUTO_RECOVERY_STARTUP_DELAY_MS = 60 * 1000;
export const DEFAULT_MAX_ATTEMPTS_PER_RELEASE = 3;
export const DEFAULT_ATTEMPT_WINDOW_MS = 24 * 60 * 60 * 1000;
// A re-run that has neither converged nor failed again after this long is
// reported as unresolved rather than "in progress" forever.
export const DEFAULT_PENDING_OUTCOME_MS = 45 * 60 * 1000;
const MAX_RECORDED_ATTEMPTS = 50;

const HELM_RELEASE_NAME_ANNOTATION = 'meta.helm.sh/release-name';
const HELM_RELEASE_NAMESPACE_ANNOTATION = 'meta.helm.sh/release-namespace';
const WORKLOAD_KINDS = new Set(['Deployment', 'StatefulSet', 'DaemonSet']);

// helm-controller's wording when an applied release's resources did not become
// healthy in time: kstatus failing early on a Failed resource, or the wait
// timing out.
const ROLLOUT_FAILURE_RE = /failed early due to stalled resources|timeout waiting for|timed out waiting for the condition|context deadline exceeded/i;

export function defaultReleaseAutoRecoveryRecordFile(stateFile) {
  return path.join(path.dirname(stateFile || '/var/lib/alga-appliance/install-state.json'), 'release-auto-recovery.json');
}

function condition(hr, type) {
  return (hr?.status?.conditions || []).find((c) => c.type === type) || null;
}

// The specific Helm error. Stalled says only "Failed to upgrade after 1
// attempt(s)"; the cause is on Released (or Ready when Released is absent).
export function releaseFailureMessage(hr) {
  const released = condition(hr, 'Released');
  if (released && released.status === 'False' && released.message) return released.message;
  const ready = condition(hr, 'Ready');
  if (ready && ready.status === 'False' && ready.message) return ready.message;
  return condition(hr, 'Stalled')?.message || '';
}

export function isRolloutFailure(message) {
  return ROLLOUT_FAILURE_RE.test(String(message || ''));
}

// "[Deployment/msp/email-service status: 'Failed', StatefulSet/msp/db status: 'InProgress']"
export function failedResourcesFromMessage(message) {
  const out = [];
  const pattern = /([A-Za-z]+)\/([^/\s,\]]+)\/([^\s,\]]+)\s+status:\s*'([^']*)'/g;
  for (const match of String(message || '').matchAll(pattern)) {
    out.push({ kind: match[1], namespace: match[2], name: match[3], status: match[4] });
  }
  return out;
}

function resourceId(kind, item) {
  return `${kind}/${item?.metadata?.namespace || ''}/${item?.metadata?.name || ''}`;
}

function conditionOf(item, type) {
  return (item?.status?.conditions || []).find((c) => c.type === type) || null;
}

// Fully rolled out and available at the current spec. Returns null when
// healthy, otherwise a short reason.
export function workloadNotHealthyReason(kind, item) {
  const generation = Number(item?.metadata?.generation || 0);
  const observed = Number(item?.status?.observedGeneration || 0);
  if (observed < generation) return 'has not observed its latest spec';
  const status = item?.status || {};
  if (kind === 'Deployment') {
    const want = item?.spec?.replicas ?? 1;
    const progressing = conditionOf(item, 'Progressing');
    if (progressing?.status === 'False') return `is not progressing (${progressing.reason || 'unknown'})`;
    if ((status.updatedReplicas || 0) < want) return `has ${status.updatedReplicas || 0}/${want} updated replicas`;
    if ((status.availableReplicas || 0) < want) return `has ${status.availableReplicas || 0}/${want} available replicas`;
    if ((status.replicas || 0) > want) return 'still has old replicas terminating';
    return null;
  }
  if (kind === 'StatefulSet') {
    const want = item?.spec?.replicas ?? 1;
    if ((status.readyReplicas || 0) < want) return `has ${status.readyReplicas || 0}/${want} ready replicas`;
    if (status.updateRevision && status.currentRevision && status.updateRevision !== status.currentRevision) return 'is still rolling to its update revision';
    return null;
  }
  if (kind === 'DaemonSet') {
    const want = status.desiredNumberScheduled || 0;
    if ((status.updatedNumberScheduled || 0) < want) return `has ${status.updatedNumberScheduled || 0}/${want} updated pods`;
    if ((status.numberAvailable || 0) < want) return `has ${status.numberAvailable || 0}/${want} available pods`;
    return null;
  }
  return `is a ${kind}, not a workload`;
}

function ownedBy(item, releaseName, releaseNamespace) {
  const annotations = item?.metadata?.annotations || {};
  if (annotations[HELM_RELEASE_NAME_ANNOTATION] !== releaseName) return false;
  const ns = annotations[HELM_RELEASE_NAMESPACE_ANNOTATION];
  return !ns || ns === releaseNamespace;
}

function jobState(job) {
  if ((job?.status?.active || 0) > 0) return 'active';
  const conditions = job?.status?.conditions || [];
  if (conditions.some((c) => c.type === 'Failed' && c.status === 'True')) return 'failed';
  if (conditions.some((c) => c.type === 'Complete' && c.status === 'True')) return 'complete';
  return (job?.status?.succeeded || 0) > 0 ? 'complete' : 'active';
}

// Pure decision: which stalled releases to re-run now, and why the others are
// left alone. `workloads` holds raw objects ({deployments, statefulSets,
// daemonSets, jobs}) for the namespaces the releases install into.
export function planReleaseAutoRecovery({
  helmReleases = [],
  workloads = {},
  record = null,
  releases = APPLIANCE_HELM_RELEASES,
  nowMs = Date.now(),
  maxAttemptsPerRelease = DEFAULT_MAX_ATTEMPTS_PER_RELEASE,
  attemptWindowMs = DEFAULT_ATTEMPT_WINDOW_MS
} = {}) {
  const byName = new Map(helmReleases.map((hr) => [hr?.metadata?.name, hr]));
  const attempts = Array.isArray(record?.attempts) ? record.attempts : [];
  const lists = [
    ['Deployment', workloads.deployments || []],
    ['StatefulSet', workloads.statefulSets || []],
    ['DaemonSet', workloads.daemonSets || []]
  ];
  const workloadIndex = new Map();
  for (const [kind, items] of lists) {
    for (const item of items) workloadIndex.set(resourceId(kind, item), { kind, item });
  }

  const candidates = [];
  const deferred = [];
  for (const { name } of releases) {
    const hr = byName.get(name);
    const summary = summarizeHelmRelease(hr);
    if (!summary.readable || !summary.hardFailed) continue;
    const defer = (reason, failure = null) => deferred.push({ release: name, reason, failure });
    // A new spec (generation) gets a fresh attempt from Flux by itself.
    if (!summary.observedCurrent) continue;
    if (summary.suspended) { defer('the release is suspended'); continue; }

    const latest = hr?.status?.history?.[0] || null;
    const failure = releaseFailureMessage(hr);
    if (!latest || latest.status !== 'failed') {
      defer('its latest Helm revision is not a failed upgrade or install', failure);
      continue;
    }
    if (!isRolloutFailure(failure)) {
      defer('the failure was not a rollout timeout, so re-running it unchanged would fail the same way', failure);
      continue;
    }

    const releaseName = latest.name || hr?.spec?.releaseName || name;
    const releaseNamespace = latest.namespace || hr?.spec?.targetNamespace || hr?.metadata?.namespace;
    const owned = [...workloadIndex.entries()]
      .filter(([, { item }]) => item?.metadata?.namespace === releaseNamespace && ownedBy(item, releaseName, releaseNamespace));
    const named = failedResourcesFromMessage(failure);
    const nonWorkload = named.find((resource) => !WORKLOAD_KINDS.has(resource.kind));
    if (nonWorkload) {
      defer(`the failure was on ${nonWorkload.kind}/${nonWorkload.namespace}/${nonWorkload.name}, not a workload rollout`, failure);
      continue;
    }
    if (owned.length === 0) {
      defer('no Deployment, StatefulSet or DaemonSet of the release was found to verify', failure);
      continue;
    }
    const toCheck = new Map(owned);
    let missing = null;
    for (const resource of named) {
      const id = `${resource.kind}/${resource.namespace}/${resource.name}`;
      const found = workloadIndex.get(id);
      if (!found) { missing = id; break; }
      toCheck.set(id, found);
    }
    if (missing) { defer(`${missing} named in the failure no longer exists`, failure); continue; }
    const unhealthy = [...toCheck.entries()]
      .map(([id, { kind, item }]) => [id, workloadNotHealthyReason(kind, item)])
      .find(([, reason]) => reason);
    if (unhealthy) { defer(`waiting for ${unhealthy[0]}, which ${unhealthy[1]}`, failure); continue; }

    const jobs = (workloads.jobs || []).filter((job) => job?.metadata?.namespace === releaseNamespace && ownedBy(job, releaseName, releaseNamespace));
    const busyJob = jobs.find((job) => jobState(job) === 'active');
    if (busyJob) { defer(`Job ${releaseNamespace}/${busyJob.metadata.name} is still running`, failure); continue; }
    const failedJob = jobs.find((job) => jobState(job) === 'failed');
    if (failedJob) { defer(`Job ${releaseNamespace}/${failedJob.metadata.name} failed`, failure); continue; }

    const failedRevision = Number(latest.version || 0);
    const previous = attempts.find((attempt) => attempt.release === name && attempt.failedRevision === failedRevision);
    if (previous) {
      defer(`revision ${failedRevision} was already re-run automatically at ${previous.at}`, failure);
      continue;
    }
    const recent = attempts.filter((attempt) => attempt.release === name && nowMs - Date.parse(attempt.at || '') < attemptWindowMs);
    if (recent.length >= maxAttemptsPerRelease) {
      defer(`it was re-run automatically ${recent.length} times in the last ${Math.round(attemptWindowMs / 3_600_000)}h`, failure);
      continue;
    }

    candidates.push({
      release: name,
      failedRevision,
      chartVersion: latest.chartVersion || summary.lastAttemptedRevision || null,
      failure,
      verified: [...toCheck.keys()].sort(),
      // Chart Jobs are plain resources here (see helm-release-recovery.mjs):
      // a finished one left in place makes the re-run's apply collide with
      // its immutable template.
      clearJobs: jobs.map((job) => ({ namespace: releaseNamespace, name: job.metadata.name }))
    });
  }
  return { candidates, deferred };
}

// Settle earlier attempts against the releases' current state.
export function settleAttempts(attempts, helmReleases, { nowMs = Date.now(), pendingOutcomeMs = DEFAULT_PENDING_OUTCOME_MS } = {}) {
  const byName = new Map(helmReleases.map((hr) => [hr?.metadata?.name, hr]));
  let changed = false;
  const settled = attempts.map((attempt) => {
    if (attempt.outcome !== 'pending') return attempt;
    const hr = byName.get(attempt.release);
    const summary = summarizeHelmRelease(hr);
    const latestVersion = Number(hr?.status?.history?.[0]?.version || 0);
    const at = new Date(nowMs).toISOString();
    if (summary.readable && summary.ready && summary.observedCurrent && latestVersion > attempt.failedRevision) {
      changed = true;
      return { ...attempt, outcome: 'recovered', outcomeAt: at, recoveredRevision: latestVersion };
    }
    if (summary.readable && summary.hardFailed && latestVersion > attempt.failedRevision) {
      changed = true;
      return { ...attempt, outcome: 'failed-again', outcomeAt: at, outcomeMessage: releaseFailureMessage(hr) };
    }
    if (nowMs - Date.parse(attempt.at || '') > pendingOutcomeMs) {
      changed = true;
      return { ...attempt, outcome: 'unresolved', outcomeAt: at };
    }
    return attempt;
  });
  return { attempts: settled, changed };
}

export function createReleaseAutoRecovery(options = {}) {
  const fsImpl = options.fs || fs;
  const now = options.now || (() => Date.now());
  const logger = options.logger || console;
  const clusterReader = options.clusterReader;
  const runKubectl = options.runKubectl;
  const recordFile = options.recordFile || defaultReleaseAutoRecoveryRecordFile(options.stateFile);
  const namespace = options.namespace || APPLIANCE_HELM_RELEASE_NAMESPACE;
  const releases = options.releases || APPLIANCE_HELM_RELEASES;
  const intervalMs = Number(options.intervalMs || DEFAULT_RELEASE_AUTO_RECOVERY_INTERVAL_MS);
  const startupDelayMs = Number(options.startupDelayMs ?? DEFAULT_RELEASE_AUTO_RECOVERY_STARTUP_DELAY_MS);
  const maxAttemptsPerRelease = Number(options.maxAttemptsPerRelease || DEFAULT_MAX_ATTEMPTS_PER_RELEASE);
  const attemptWindowMs = Number(options.attemptWindowMs || DEFAULT_ATTEMPT_WINDOW_MS);
  const pendingOutcomeMs = Number(options.pendingOutcomeMs || DEFAULT_PENDING_OUTCOME_MS);
  const disabled = Boolean(options.disabled);
  const shouldSkip = options.shouldSkip || (() => null);
  const onChange = options.onChange || (() => {});
  const readTimeoutMs = Number(options.readTimeoutMs || 15_000);

  let running = null;
  let timers = [];

  function readRecord() {
    try {
      if (!fsImpl.existsSync(recordFile)) return null;
      const parsed = JSON.parse(fsImpl.readFileSync(recordFile, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  function writeRecord(value) {
    try {
      fsImpl.mkdirSync(path.dirname(recordFile), { recursive: true, mode: 0o750 });
      const temporaryFile = `${recordFile}.${process.pid}.${now()}.tmp`;
      fsImpl.writeFileSync(temporaryFile, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      fsImpl.renameSync(temporaryFile, recordFile);
    } catch (error) {
      logger.error(`Could not persist release auto-recovery record: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function readWorkloads(namespaces) {
    const out = { deployments: [], statefulSets: [], daemonSets: [], jobs: [] };
    for (const ns of namespaces) {
      const [deployments, statefulSets, daemonSets, jobs] = await Promise.all([
        clusterReader.listDeployments({ namespace: ns, timeoutMs: readTimeoutMs }),
        clusterReader.listStatefulSets({ namespace: ns, timeoutMs: readTimeoutMs }),
        clusterReader.listDaemonSets({ namespace: ns, timeoutMs: readTimeoutMs }),
        clusterReader.listJobs({ namespace: ns, timeoutMs: readTimeoutMs })
      ]);
      const failed = [deployments, statefulSets, daemonSets, jobs].find((result) => !result.ok);
      if (failed) return { ok: false, error: failed.error || failed.reason };
      out.deployments.push(...deployments.items);
      out.statefulSets.push(...statefulSets.items);
      out.daemonSets.push(...daemonSets.items);
      out.jobs.push(...jobs.items);
    }
    return { ok: true, workloads: out };
  }

  async function tick(reason) {
    const nowMs = now();
    const at = new Date(nowMs).toISOString();
    const record = readRecord() || {};
    const attempts = Array.isArray(record.attempts) ? record.attempts : [];
    const finish = (lastCheck, extra = {}) => {
      writeRecord({ ...record, ...extra, attempts: extra.attempts || attempts, lastCheck: { at, reason, ...lastCheck } });
    };

    let skip = null;
    try { skip = shouldSkip(); } catch { skip = null; }
    if (skip) {
      finish({ outcome: 'skipped', detail: String(skip) });
      return { skipped: String(skip) };
    }

    const listed = await clusterReader.listHelmReleases({ namespace, timeoutMs: readTimeoutMs });
    if (!listed.ok) {
      finish({ outcome: 'error', detail: listed.error || listed.reason });
      return { error: listed.error || listed.reason };
    }
    const helmReleases = listed.items;
    const settled = settleAttempts(attempts, helmReleases, { nowMs, pendingOutcomeMs });
    settled.attempts.forEach((attempt, index) => {
      if (attempt !== attempts[index]) {
        logger.info?.(`[release-auto-recovery] ${attempt.release}: re-run of revision ${attempt.failedRevision} ${attempt.outcome}.`);
      }
    });

    const stalled = helmReleases.filter((hr) => {
      const summary = summarizeHelmRelease(hr);
      return summary.readable && summary.hardFailed;
    });
    if (stalled.length === 0) {
      finish({ outcome: 'ok', detail: 'no stalled releases' }, { attempts: settled.attempts, deferred: [] });
      if (settled.changed) onChange();
      return { recovered: [], deferred: [] };
    }

    const namespaces = [...new Set(stalled.map((hr) => hr?.status?.history?.[0]?.namespace || hr?.spec?.targetNamespace).filter(Boolean))];
    const read = await readWorkloads(namespaces);
    if (!read.ok) {
      finish({ outcome: 'error', detail: read.error }, { attempts: settled.attempts });
      if (settled.changed) onChange();
      return { error: read.error };
    }

    const plan = planReleaseAutoRecovery({
      helmReleases,
      workloads: read.workloads,
      record: { attempts: settled.attempts },
      releases,
      nowMs,
      maxAttemptsPerRelease,
      attemptWindowMs
    });

    const newAttempts = [];
    for (const candidate of plan.candidates) {
      let error = null;
      for (const job of candidate.clearJobs) {
        const cleared = await clearBootstrapJob({ runKubectl, job, waitForActiveMs: 0 });
        if (!cleared.ok) { error = `could not remove finished Job ${job.namespace}/${job.name}: ${cleared.error}`; break; }
      }
      if (!error) {
        const forced = await forceHelmReleaseReconcile({ runKubectl, name: candidate.release, namespace, at });
        if (!forced.ok) error = forced.error;
      }
      const attempt = {
        release: candidate.release,
        failedRevision: candidate.failedRevision,
        chartVersion: candidate.chartVersion,
        at,
        trigger: reason,
        failure: candidate.failure,
        verified: candidate.verified,
        outcome: error ? 'error' : 'pending',
        ...(error ? { outcomeMessage: error } : {})
      };
      newAttempts.push(attempt);
      if (error) {
        logger.error(`[release-auto-recovery] ${candidate.release}: could not re-run revision ${candidate.failedRevision}: ${error}`);
      } else {
        logger.info?.(`[release-auto-recovery] ${candidate.release}: revision ${candidate.failedRevision} failed on a rollout timeout but ${candidate.verified.join(', ')} ${candidate.verified.length === 1 ? 'is' : 'are'} healthy now; forced a reset + upgrade.`);
      }
    }

    const allAttempts = [...settled.attempts, ...newAttempts].slice(-MAX_RECORDED_ATTEMPTS);
    finish({ outcome: 'ok', detail: `${newAttempts.length} re-run, ${plan.deferred.length} left alone` }, { attempts: allAttempts, deferred: plan.deferred });
    if (newAttempts.length || settled.changed) onChange();
    return { recovered: newAttempts.filter((a) => a.outcome === 'pending').map((a) => a.release), deferred: plan.deferred };
  }

  function runOnce(reason = 'manual') {
    if (disabled) return Promise.resolve({ skipped: 'disabled' });
    if (running) return running;
    running = tick(reason)
      .catch((error) => {
        logger.error(`[release-auto-recovery] tick failed: ${error instanceof Error ? error.message : String(error)}`);
        return { error: error instanceof Error ? error.message : String(error) };
      })
      .finally(() => { running = null; });
    return running;
  }

  function start() {
    if (disabled) return;
    const startupTimer = setTimeout(() => { runOnce('startup'); }, startupDelayMs);
    startupTimer.unref?.();
    const intervalTimer = setInterval(() => { runOnce('periodic'); }, intervalMs);
    intervalTimer.unref?.();
    timers = [startupTimer, intervalTimer];
  }

  function shutdown() {
    for (const timer of timers) { clearTimeout(timer); clearInterval(timer); }
    timers = [];
  }

  return { runOnce, readRecord, start, shutdown, recordFile };
}

// What the status page shows: recent automatic re-runs (with their outcome)
// and why stalled releases were left alone.
export function summarizeAutoRecoveryRecord(record, { nowMs = Date.now(), windowMs = DEFAULT_ATTEMPT_WINDOW_MS } = {}) {
  if (!record || typeof record !== 'object') return null;
  const attempts = Array.isArray(record.attempts) ? record.attempts : [];
  return {
    lastCheck: record.lastCheck || null,
    recent: attempts.filter((attempt) => nowMs - Date.parse(attempt.at || '') < windowMs).reverse(),
    deferred: Array.isArray(record.deferred) ? record.deferred : []
  };
}
