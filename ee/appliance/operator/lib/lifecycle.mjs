import { ShellRunner } from './runner.mjs';
import { resolveSitePaths } from './runtime-paths.mjs';

function nowStamp() {
  return new Date().toISOString().replace('T', ' ').replace('Z', 'Z');
}

const BOOTSTRAP_PHASE_PATTERNS = [
  { phase: 'Talos', re: /(Talos|talosctl|maintenance API|secure Talos API)/i },
  { phase: 'Kubernetes', re: /(Kubernetes API|kubeconfig|node .*Ready|kubectl)/i },
  { phase: 'Flux', re: /(flux|GitRepository|Kustomization|source-controller|kustomize-controller)/i },
  { phase: 'Helm', re: /(helmrelease|helm-controller|Helm)/i },
  { phase: 'Workloads', re: /(alga-core|deployment|rollout|bootstrap job|pods|statefulset)/i },
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

function detectBootstrapPhase(line) {
  for (const pattern of BOOTSTRAP_PHASE_PATTERNS) {
    if (pattern.re.test(line)) {
      return pattern.phase;
    }
  }
  return null;
}

function normalizeReleaseVersion(env, releaseVersion) {
  if (releaseVersion) {
    return releaseVersion;
  }
  if (env.defaultReleaseVersion) {
    return env.defaultReleaseVersion;
  }
  throw new Error('No release version available. Publish a release or pass --release-version.');
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

export async function runBootstrap(env, options = {}) {
  const releaseVersion = normalizeReleaseVersion(env, options.releaseVersion);
  const siteId = options.siteId || env.site?.siteId || env.suggestedSiteId || 'appliance-single-node';
  const derivedSite = env.site || (env.configBaseDir ? resolveSitePaths(env.configBaseDir, siteId) : null);
  const args = buildScriptArgs({
    'site-id': siteId,
    'release-version': releaseVersion,
    'bootstrap-mode': options.bootstrapMode,
    'node-ip': options.nodeIp || env.nodeIp,
    hostname: options.hostname,
    'app-url': options.appUrl || env.appUrl,
    interface: options.interface,
    'network-mode': options.networkMode,
    'static-address': options.staticAddress,
    'static-gateway': options.staticGateway,
    'dns-servers': options.dnsServers,
    'config-dir': options.configDir || derivedSite?.configDir,
    kubeconfig: options.kubeconfig,
    talosconfig: options.talosconfig,
    'repo-url': options.repoUrl,
    'repo-branch': options.repoBranch,
    'prepull-images': options.prepullImages,
    'dry-run': options.dryRun,
  });

  return runLifecycleScript({
    script: env.runtime.bootstrapScript,
    args,
    runner: options.runner,
    cwd: env.runtime.assetRoot,
    onProgress: options.onProgress,
    phaseDetector: detectBootstrapPhase,
  });
}

export async function runUpgrade(env, options = {}) {
  const releaseVersion = normalizeReleaseVersion(env, options.releaseVersion);
  const args = buildScriptArgs({
    'release-version': releaseVersion,
    kubeconfig: options.kubeconfig || env.paths.kubeconfig,
    'config-dir': options.configDir || env.site.configDir,
    profile: options.profile,
    'skip-reconcile': options.reconcileAfterApply === false,
    'dry-run': options.dryRun,
  });

  return runLifecycleScript({
    script: env.runtime.upgradeScript,
    args,
    runner: options.runner,
    cwd: env.runtime.assetRoot,
    onProgress: options.onProgress,
  });
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
    phaseDetector: detectBootstrapPhase,
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
