import { ShellRunner } from './runner.mjs';

function nowStamp() {
  return new Date().toISOString().replace('T', ' ').replace('Z', 'Z');
}

const LIFECYCLE_PHASE_PATTERNS = [
  { phase: 'Talos', re: /(Talos|talosctl|maintenance API|secure Talos API)/i },
  { phase: 'Kubernetes', re: /(Kubernetes API|kubeconfig|node .*Ready|kubectl)/i },
  { phase: 'Storage', re: /(local-path|storage smoke|install-storage|provisioner|pvc)/i },
  { phase: 'Flux', re: /(flux|GitRepository|Kustomization|source-controller|kustomize-controller)/i },
  { phase: 'Core App', re: /(alga-core|bootstrap job|db-0|pgbouncer|redis|login[- ]ready|dashboard)/i },
  { phase: 'Background Services', re: /(temporal|temporal-ui|workflow-worker|temporal-worker|email-service|background)/i },
  { phase: 'Helm', re: /(helmrelease|helm-controller|Helm)/i },
  { phase: 'Workloads', re: /(deployment|rollout|pods|statefulset)/i },
];

const FAILURE_CLASSIFIERS = [
  { layer: 'kubernetes', re: /(Kubernetes API|kubeconfig|Unable to connect to the server|dial tcp .*:6443)/i },
  { layer: 'host', re: /(Talos|maintenance API|secure Talos API|talosctl|no route to host|connection refused)/i },
  { layer: 'flux', re: /(flux|GitRepository|Kustomization|source-controller|kustomize-controller)/i },
  { layer: 'helm', re: /(helmrelease|Helm|chart|install|upgrade failed)/i },
  { layer: 'workload', re: /(deployment|statefulset|pod|CrashLoopBackOff|ImagePullBackOff|rollout|job)/i },
];

export function classifyFailure(output) {
  for (const entry of FAILURE_CLASSIFIERS) {
    if (entry.re.test(output)) {
      return entry.layer;
    }
  }
  return 'unknown';
}

function detectLifecyclePhase(line) {
  for (const pattern of LIFECYCLE_PHASE_PATTERNS) {
    if (pattern.re.test(line)) {
      return pattern.phase;
    }
  }
  return null;
}

function buildScriptArgs(flagMap) {
  const args = [];
  for (const [key, value] of Object.entries(flagMap)) {
    if (value === undefined || value === null || value === false || value === '') {
      continue;
    }
    const flag = `--${key}`;
    if (value === true) {
      args.push(flag);
    } else {
      args.push(flag, String(value));
    }
  }
  return args;
}

async function runLifecycleScript({ script, args, runner, cwd, onProgress, phaseDetector }) {
  let currentPhase = null;
  const shell = runner || new ShellRunner({ cwd });
  const startedAt = nowStamp();

  onProgress?.({ type: 'start', line: `Started ${script} at ${startedAt}` });

  const result = await shell.runStreaming(script, args, {
    cwd,
    onLine(line) {
      const phase = phaseDetector ? phaseDetector(line) : null;
      if (phase && phase !== currentPhase) {
        currentPhase = phase;
        onProgress?.({ type: 'phase', phase, line: `${nowStamp()} ${phase}` });
      }
      onProgress?.({ type: 'line', phase: currentPhase, line });
    },
  });

  if (result.code === 0) {
    onProgress?.({ type: 'done', line: `Completed at ${nowStamp()}` });
    return {
      ok: true,
      code: 0,
      output: result.output,
      failureLayer: null,
    };
  }

  const failureLayer = classifyFailure(result.output);
  onProgress?.({
    type: 'error',
    line: `Failed at ${nowStamp()} (${failureLayer})`,
    failureLayer,
  });

  return {
    ok: false,
    code: result.code,
    output: result.output,
    failureLayer,
  };
}

export async function runRepairRelease(env, options = {}) {
  const args = buildScriptArgs({
    kubeconfig: options.kubeconfig || env.paths.kubeconfig,
    'release-name': options.releaseName || 'alga-core',
    'release-namespace': options.releaseNamespace || 'alga-system',
    'workload-namespace': options.workloadNamespace || 'msp',
    'skip-cleanup-workloads': options.cleanupWorkloads === false,
    'dry-run': options.dryRun,
  });

  return runLifecycleScript({
    script: env.runtime.repairScript,
    args,
    runner: options.runner,
    cwd: env.runtime.assetRoot,
    onProgress: options.onProgress,
    phaseDetector: detectLifecyclePhase,
  });
}

export async function runReset(env, options = {}) {
  const args = buildScriptArgs({
    kubeconfig: options.kubeconfig || env.paths.kubeconfig,
    force: true,
    'dry-run': options.dryRun,
  });

  return runLifecycleScript({
    script: env.runtime.resetScript,
    args,
    runner: options.runner,
    cwd: env.runtime.assetRoot,
    onProgress: options.onProgress,
  });
}

export async function runSupportBundle(env, options = {}) {
  const args = buildScriptArgs({
    kubeconfig: options.kubeconfig || env.paths.kubeconfig,
    talosconfig: options.talosconfig || env.paths.talosconfig,
    'node-ip': options.nodeIp || env.nodeIp,
    'site-id': options.siteId || env.site.siteId,
    'output-dir': options.outputDir || process.cwd(),
  });

  return runLifecycleScript({
    script: env.runtime.supportBundleScript,
    args,
    runner: options.runner,
    cwd: env.runtime.assetRoot,
    onProgress: options.onProgress,
  });
}
