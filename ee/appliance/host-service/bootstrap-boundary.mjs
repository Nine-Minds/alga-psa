export const DEFAULT_APPLIANCE_ROOT = '/opt/alga-appliance';
export const DEFAULT_SETUP_PORT = 8080;
export const DEFAULT_K3S_KUBECONFIG = '/etc/rancher/k3s/k3s.yaml';

export const HOST_BOOTSTRAP_PHASES = Object.freeze([
  {
    id: 'substrate',
    label: 'k3s substrate',
    responsibilities: Object.freeze([
      'install-or-start-k3s',
      'wait-for-kubernetes-api'
    ])
  },
  {
    id: 'assets',
    label: 'baked control-plane assets',
    responsibilities: Object.freeze([
      'import-baked-image-archives',
      'apply-local-storage-manifest',
      'apply-control-plane-manifests'
    ])
  },
  {
    id: 'handoff',
    label: 'setup handoff',
    responsibilities: Object.freeze([
      'report-setup-url',
      'report-fallback-command'
    ])
  }
]);

export const CONTROL_PLANE_RESPONSIBILITIES = Object.freeze([
  'serve-setup-ui',
  'serve-status-api',
  'validate-setup-inputs',
  'persist-release-selection',
  'configure-flux-source',
  'configure-application-runtime-values',
  'create-initial-tenant-admin-secret',
  'trigger-application-bootstrap',
  'report-application-status-and-blockers'
]);

export const HOST_BOOTSTRAP_FORBIDDEN_RESPONSIBILITIES = Object.freeze([
  ...CONTROL_PLANE_RESPONSIBILITIES,
  'run-primary-host-setup-service',
  'depend-on-github-before-setup-ui',
  'depend-on-dns-before-setup-ui',
  'depend-on-registry-pulls-before-setup-ui',
  'depend-on-flux-before-setup-ui'
]);

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '') || '/';
}

export function appliancePaths(options = {}) {
  const root = trimTrailingSlash(options.applianceRoot || DEFAULT_APPLIANCE_ROOT);
  return {
    root,
    localPathStorageManifest: `${root}/manifests/local-path-storage.yaml`,
    controlPlaneManifestDir: `${root}/control-plane/manifests`,
    controlPlaneImageDir: `${root}/control-plane/images`,
    setupTokenFile: options.setupTokenFile || '/var/lib/alga-appliance/setup-token',
    fallbackCommand: options.fallbackCommand || `${root}/bin/alga-control-plane-reapply`,
    kubeconfig: options.kubeconfig || DEFAULT_K3S_KUBECONFIG
  };
}

export function buildHostBootstrapPlan(options = {}) {
  const paths = appliancePaths(options);
  const port = Number(options.setupPort || DEFAULT_SETUP_PORT);

  return {
    boundaryVersion: 1,
    setupPort: port,
    paths,
    phases: HOST_BOOTSTRAP_PHASES.map((phase) => ({ ...phase, responsibilities: [...phase.responsibilities] })),
    commands: [
      {
        id: 'ensure-k3s',
        phase: 'substrate',
        action: 'install-or-start-k3s',
        idempotent: true,
        requiresNetwork: false,
        description: 'Install k3s if absent, otherwise ensure the existing k3s service is running.'
      },
      {
        id: 'wait-kubernetes-api',
        phase: 'substrate',
        action: 'wait-for-kubernetes-api',
        idempotent: true,
        requiresNetwork: false,
        description: `Wait until kubectl can talk to ${paths.kubeconfig}.`
      },
      {
        id: 'import-control-plane-images',
        phase: 'assets',
        action: 'import-baked-image-archives',
        idempotent: true,
        requiresNetwork: false,
        path: paths.controlPlaneImageDir,
        description: 'Import every baked control-plane image archive into k3s/containerd before applying workloads.'
      },
      {
        id: 'apply-local-storage',
        phase: 'assets',
        action: 'apply-local-storage-manifest',
        idempotent: true,
        requiresNetwork: false,
        path: paths.localPathStorageManifest,
        description: 'Apply local-path storage from the installed appliance path.'
      },
      {
        id: 'apply-control-plane',
        phase: 'assets',
        action: 'apply-control-plane-manifests',
        idempotent: true,
        requiresNetwork: false,
        path: paths.controlPlaneManifestDir,
        description: 'Apply the baked appliance control-plane namespace, RBAC, service, and workloads.'
      },
      {
        id: 'report-setup-url',
        phase: 'handoff',
        action: 'report-setup-url',
        idempotent: true,
        requiresNetwork: false,
        port,
        tokenFile: paths.setupTokenFile,
        description: 'Print and persist the tokenized setup URL for the Kubernetes-hosted control plane.'
      },
      {
        id: 'report-fallback-command',
        phase: 'handoff',
        action: 'report-fallback-command',
        idempotent: true,
        requiresNetwork: false,
        command: paths.fallbackCommand,
        description: 'Print the local recovery command that reapplies the baked control-plane bundle.'
      }
    ],
    forbiddenHostResponsibilities: [...HOST_BOOTSTRAP_FORBIDDEN_RESPONSIBILITIES],
    controlPlaneResponsibilities: [...CONTROL_PLANE_RESPONSIBILITIES]
  };
}

export function assertHostBootstrapBoundary(plan = buildHostBootstrapPlan()) {
  const commandActions = new Set((plan.commands || []).map((command) => command.action));
  const forbidden = (plan.forbiddenHostResponsibilities || []).filter((responsibility) => commandActions.has(responsibility));
  if (forbidden.length > 0) {
    throw new Error(`Host bootstrap crosses the control-plane boundary: ${forbidden.join(', ')}`);
  }

  const networkedBeforeHandoff = (plan.commands || []).filter((command) => command.phase !== 'handoff' && command.requiresNetwork);
  if (networkedBeforeHandoff.length > 0) {
    throw new Error(`Host bootstrap requires network before setup UI: ${networkedBeforeHandoff.map((command) => command.id).join(', ')}`);
  }

  const nonIdempotent = (plan.commands || []).filter((command) => !command.idempotent);
  if (nonIdempotent.length > 0) {
    throw new Error(`Host bootstrap command is not idempotent: ${nonIdempotent.map((command) => command.id).join(', ')}`);
  }

  return true;
}
