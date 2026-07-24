// Terminal-pod reaper.
//
// Kubernetes only garbage collects terminated pods once they exceed
// kube-controller-manager's --terminated-pod-gc-threshold, which defaults to
// 12500. A single-node appliance never gets close, so every evicted or failed
// pod stays in the API forever. Two things go wrong as a result: the status
// engine used to read those corpses as degraded workloads, and `kubectl get
// pods` output grows without bound.
//
// This sweep keeps the newest few terminal pods per namespace (recent failures
// are exactly the ones an operator still wants to inspect) and deletes the rest.
// It runs inside the control plane, so existing appliances converge without a
// k3s restart.

const DEFAULT_REAP_PHASES = ['Failed'];
const DEFAULT_RETAIN_PER_NAMESPACE = 5;

export function parseTerminalPodLines(lines) {
  return lines
    .map((line) => {
      const [namespace, name, phase, createdAt] = line.trim().split(/\s+/);
      if (!namespace || !name || name === '<none>') return null;
      return {
        namespace,
        name,
        phase: phase && phase !== '<none>' ? phase : 'Unknown',
        createdAt: createdAt && createdAt !== '<none>' ? createdAt : ''
      };
    })
    .filter(Boolean);
}

// Decide which corpses to delete. Newest-first per namespace so the retained
// ones are the most diagnostically useful; ties fall back to name so the plan is
// deterministic (important for tests and for repeat runs).
export function planTerminalPodReap(pods, options = {}) {
  const retainPerNamespace = Number.isInteger(options.retainPerNamespace)
    ? options.retainPerNamespace
    : DEFAULT_RETAIN_PER_NAMESPACE;
  const reapPhases = options.reapPhases || DEFAULT_REAP_PHASES;

  const byNamespace = new Map();
  for (const pod of pods) {
    if (!reapPhases.includes(pod.phase)) continue;
    if (!byNamespace.has(pod.namespace)) byNamespace.set(pod.namespace, []);
    byNamespace.get(pod.namespace).push(pod);
  }

  const doomed = [];
  for (const [, namespacePods] of byNamespace) {
    namespacePods.sort((a, b) => (
      b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name)
    ));
    doomed.push(...namespacePods.slice(retainPerNamespace));
  }
  return doomed;
}

export async function reapTerminalPods(options = {}) {
  const {
    kube,
    retainPerNamespace = DEFAULT_RETAIN_PER_NAMESPACE,
    reapPhases = DEFAULT_REAP_PHASES,
    log = () => {}
  } = options;

  const found = [];
  for (const phase of reapPhases) {
    const result = await kube.run(
      `get pods -A --field-selector=status.phase==${phase} --no-headers ` +
      '-o custom-columns=NAMESPACE:.metadata.namespace,NAME:.metadata.name,' +
      'PHASE:.status.phase,CREATED:.metadata.creationTimestamp'
    );
    if (!result.ok) {
      // A transient query failure must not be read as "nothing to reap" — bail
      // out so the next sweep re-evaluates from scratch.
      return { ok: false, deleted: 0, error: result.stderr || result.stdout || `Unable to list ${phase} pods.` };
    }
    const lines = (result.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    found.push(...parseTerminalPodLines(lines));
  }

  const doomed = planTerminalPodReap(found, { retainPerNamespace, reapPhases });
  if (doomed.length === 0) return { ok: true, deleted: 0, scanned: found.length };

  const byNamespace = new Map();
  for (const pod of doomed) {
    if (!byNamespace.has(pod.namespace)) byNamespace.set(pod.namespace, []);
    byNamespace.get(pod.namespace).push(pod.name);
  }

  let deleted = 0;
  const errors = [];
  for (const [namespace, names] of byNamespace) {
    const args = names.map((name) => kube.quote(name)).join(' ');
    const result = await kube.run(`-n ${kube.quote(namespace)} delete pod ${args} --ignore-not-found`);
    if (result.ok) {
      deleted += names.length;
      log(`reaped ${names.length} terminal pod(s) in ${namespace}`);
    } else {
      errors.push(`${namespace}: ${result.stderr || result.stdout || 'delete failed'}`);
    }
  }

  return {
    ok: errors.length === 0,
    deleted,
    scanned: found.length,
    error: errors.length > 0 ? errors.join('; ') : undefined
  };
}
