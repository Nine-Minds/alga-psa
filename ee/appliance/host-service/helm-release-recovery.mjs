// Appliance HelmRelease coordination shared by the update engine and the
// control plane's /api/recover.
//
// Background (2026-09-18, rc6 -> 1.6.1 upgrade): an app-channel update used
// to change the alga-core HelmRelease twice in quick succession — first the
// appliance-values-* ConfigMaps (valuesFrom), then, once the new config bundle
// landed, spec.chart.spec.version via the Flux Kustomization. helm-controller
// ran two back-to-back upgrades. On the appliance the bootstrap Job
// (alga-core-sebastian-bootstrap, ttlSecondsAfterFinished 300) is a regular
// chart resource, not a Helm hook, so Helm server-side-applies it on every
// upgrade; the second upgrade's template differed while the first upgrade's
// Job still existed, the apply failed on the Job's immutable spec.template,
// and with upgrade.remediation retries 0 the release stalled (RetriesExceeded). Every dependent release
// (email-service, pgbouncer, temporal, temporal-worker, workflow-worker) then
// waited on "dependency not ready" forever while the engine reported success.
//
// The pieces below make that a single reconcile (suspend -> change everything
// -> resume) and make the stalled state recoverable from the UI.

export const APPLIANCE_HELM_RELEASE_NAMESPACE = 'alga-system';

// name -> chart, in dependency order (alga-core first). Matches
// ee/appliance/flux/base/releases/*.yaml and the release manifest's `charts`.
export const APPLIANCE_HELM_RELEASES = Object.freeze([
  { name: 'alga-core', chart: 'sebastian' },
  { name: 'pgbouncer', chart: 'pgbouncer' },
  { name: 'temporal', chart: 'temporal' },
  { name: 'temporal-worker', chart: 'temporal-worker' },
  { name: 'workflow-worker', chart: 'workflow-worker' },
  { name: 'email-service', chart: 'email-service' }
]);

export const BOOTSTRAP_JOB = Object.freeze({ namespace: 'msp', name: 'alga-core-sebastian-bootstrap' });

// helm-controller terminal Ready reasons; anything else is still converging.
const TERMINAL_REASON_RE = /Failed|RetriesExceeded|Stalled|Exhausted/i;

// The signature of a Helm upgrade colliding with the previous upgrade's
// bootstrap Job (see header). Narrow on purpose: this is the one failure we know is
// self-inflicted by ordering and safe to retry after clearing the Job.
export function isBootstrapJobCollision(message) {
  const text = String(message || '');
  return /field is immutable/i.test(text) && new RegExp(BOOTSTRAP_JOB.name).test(text);
}

function q(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function output(result) {
  return ((result && (result.stderr || result.stdout)) || '').trim();
}

function isNotFound(result) {
  return /not found|NotFound/i.test(output(result));
}

// Interpret a HelmRelease object (as returned by `kubectl get -o json`).
// Returns readable=false when the object cannot be judged at all.
export function summarizeHelmRelease(hr) {
  if (!hr || typeof hr !== 'object') return { readable: false };
  const conditions = hr.status?.conditions || [];
  const ready = conditions.find((c) => c.type === 'Ready') || null;
  const stalled = conditions.find((c) => c.type === 'Stalled') || null;
  if (!ready) return { readable: false };
  const generation = Number(hr.metadata?.generation || 0);
  const observedGeneration = Number(hr.status?.observedGeneration || 0);
  const reason = ready.reason || 'Unknown';
  const isStalled = Boolean(stalled && stalled.status === 'True');
  return {
    readable: true,
    suspended: hr.spec?.suspend === true,
    ready: ready.status === 'True',
    hardFailed: isStalled || (ready.status === 'False' && TERMINAL_REASON_RE.test(reason)),
    reason: isStalled ? (stalled.reason || reason) : reason,
    message: (isStalled ? stalled.message : ready.message) || ready.message || '',
    generation,
    observedGeneration,
    // Whether the Ready condition describes the *current* spec (a stale
    // Ready=True from the previous generation must not count as converged).
    observedCurrent: observedGeneration >= generation,
    specChartVersion: hr.spec?.chart?.spec?.version || null,
    lastAttemptedRevision: hr.status?.lastAttemptedRevision || hr.status?.history?.[0]?.chartVersion || null
  };
}

export async function readHelmRelease({ runKubectl, name, namespace = APPLIANCE_HELM_RELEASE_NAMESPACE }) {
  const result = await runKubectl(`-n ${q(namespace)} get helmrelease ${q(name)} -o json`);
  if (!result.ok) return { readable: false, notFound: isNotFound(result), error: output(result) };
  try {
    return summarizeHelmRelease(JSON.parse(result.stdout || '{}'));
  } catch {
    return { readable: false };
  }
}

// Suspend (or resume) the appliance HelmReleases. The Flux Kustomization that
// owns them applies with server-side apply and, on every reconcile, strips
// fields owned by kubectl's default field managers (that is how Flux undoes
// `kubectl patch` drift) — a suspend patched the ordinary way disappeared
// within seconds on a real appliance. Fields owned by the Flux CLI's own
// manager are left alone (it is what `flux suspend` uses), so patch as that
// manager. Resume patches the field to null so nothing lingers on the object.
export const FLUX_CLI_FIELD_MANAGER = 'flux-client-side-apply';

export async function setHelmReleasesSuspended({ runKubectl, names, namespace = APPLIANCE_HELM_RELEASE_NAMESPACE, suspended }) {
  const patch = JSON.stringify({ spec: { suspend: suspended ? true : null } });
  const failures = [];
  for (const name of names) {
    const result = await runKubectl(`-n ${q(namespace)} patch helmrelease ${q(name)} --field-manager=${FLUX_CLI_FIELD_MANAGER} --type merge -p ${q(patch)}`);
    if (!result.ok && !isNotFound(result)) failures.push({ name, error: output(result) || 'kubectl patch failed' });
  }
  return { ok: failures.length === 0, failures };
}

// The appliance config bundle is layered: the top-level Flux Kustomization
// (alga-appliance) applies nested Kustomizations (alga-platform, alga-core,
// alga-background) and those apply the HelmReleases. Reconciling the top-level
// object therefore does not put the new chart pins on the HelmReleases by
// itself; the nested ones do that on their own interval (or when nudged).
// This asks every Kustomization the top-level one created to reconcile now.
export async function nudgeChildKustomizations({ runKubectl, parentName, parentNamespace = 'flux-system', at = new Date().toISOString() }) {
  const selector = `kustomize.toolkit.fluxcd.io/name=${parentName},kustomize.toolkit.fluxcd.io/namespace=${parentNamespace}`;
  const listed = await runKubectl(`get kustomizations.kustomize.toolkit.fluxcd.io -A -l ${q(selector)} -o jsonpath='{range .items[*]}{.metadata.namespace}/{.metadata.name}{"\\n"}{end}'`);
  if (!listed.ok) return { ok: false, nudged: [], error: output(listed) };
  const nudged = [];
  for (const line of (listed.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean)) {
    const [namespace, name] = line.split('/');
    if (!namespace || !name) continue;
    const res = await runKubectl(`-n ${q(namespace)} annotate kustomizations.kustomize.toolkit.fluxcd.io ${q(name)} reconcile.fluxcd.io/requestedAt=${q(at)} --overwrite`);
    if (res.ok) nudged.push(`${namespace}/${name}`);
  }
  return { ok: true, nudged };
}

// Remove the alga-core bootstrap Job if one is still around. A Job that
// is still running is given `waitForActiveMs` to finish first (an update
// should not kill an in-flight migration); the delete then waits until the
// object is actually gone so the next hook creation cannot collide with it.
export async function clearBootstrapJob({ runKubectl, sleep, waitForActiveMs = 0, pollMs = 5000, job = BOOTSTRAP_JOB }) {
  const deadline = Date.now() + waitForActiveMs;
  let waitedForActive = false;
  for (;;) {
    const read = await runKubectl(`-n ${q(job.namespace)} get job ${q(job.name)} -o json`);
    if (!read.ok) {
      if (isNotFound(read)) return { ok: true, existed: false, deleted: false, waitedForActive };
      return { ok: false, existed: null, deleted: false, waitedForActive, error: output(read) || 'kubectl get job failed' };
    }
    let active = 0;
    try { active = Number(JSON.parse(read.stdout || '{}').status?.active || 0); } catch { active = 0; }
    if (active > 0 && Date.now() < deadline && sleep) {
      waitedForActive = true;
      await sleep(pollMs);
      continue;
    }
    break;
  }
  const del = await runKubectl(`-n ${q(job.namespace)} delete job ${q(job.name)} --ignore-not-found=true --wait=true`);
  if (!del.ok) return { ok: false, existed: true, deleted: false, waitedForActive, error: output(del) || 'kubectl delete job failed' };
  return { ok: true, existed: true, deleted: true, waitedForActive };
}

// Equivalent of `flux reconcile helmrelease <name> --force --reset`: requestedAt
// triggers a reconcile, forceAt makes it an upgrade even when nothing changed,
// and resetAt clears the failure counter so a Stalled/RetriesExceeded release
// is allowed to try again at all.
export function helmReleaseResetAnnotationArgs(at) {
  return [
    `reconcile.fluxcd.io/requestedAt=${q(at)}`,
    `reconcile.fluxcd.io/forceAt=${q(at)}`,
    `reconcile.fluxcd.io/resetAt=${q(at)}`
  ].join(' ');
}

export async function forceHelmReleaseReconcile({ runKubectl, name, namespace = APPLIANCE_HELM_RELEASE_NAMESPACE, at = new Date().toISOString() }) {
  const result = await runKubectl(`-n ${q(namespace)} annotate helmrelease ${q(name)} ${helmReleaseResetAnnotationArgs(at)} --overwrite`);
  return { ok: result.ok, at, error: result.ok ? null : (output(result) || 'kubectl annotate failed') };
}

// Expected chart version per HelmRelease from a release manifest's `charts`
// map; null when the manifest does not pin that chart.
export function expectedChartVersions(manifest, releases = APPLIANCE_HELM_RELEASES) {
  const charts = manifest?.charts && typeof manifest.charts === 'object' ? manifest.charts : {};
  const out = {};
  for (const release of releases) {
    const version = charts[release.chart];
    out[release.name] = typeof version === 'string' && version.trim() ? version.trim() : null;
  }
  return out;
}

// Full recovery of a stalled app release, as exposed by /api/recover:
// resume anything an interrupted update left suspended, clear a leftover
// bootstrap Job, then force + reset the alga-core reconcile.
export async function recoverAppRelease({ runKubectl, sleep, releases = APPLIANCE_HELM_RELEASES, namespace = APPLIANCE_HELM_RELEASE_NAMESPACE, waitForActiveMs = 0, at = new Date().toISOString() }) {
  const resumed = await setHelmReleasesSuspended({ runKubectl, names: releases.map((r) => r.name), namespace, suspended: false });
  if (!resumed.ok) {
    return { ok: false, step: 'resume-helmreleases', error: resumed.failures.map((f) => `${f.name}: ${f.error}`).join('; ') };
  }
  const job = await clearBootstrapJob({ runKubectl, sleep, waitForActiveMs });
  if (!job.ok) return { ok: false, step: 'clear-bootstrap-job', error: job.error };
  const forced = await forceHelmReleaseReconcile({ runKubectl, name: releases[0].name, namespace, at });
  if (!forced.ok) return { ok: false, step: 'force-reconcile', error: forced.error };
  return { ok: true, at, clearedBootstrapJob: job.deleted };
}
