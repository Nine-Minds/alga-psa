import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { loadAll } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '../../../..');
const chartPath = path.join(repositoryRoot, 'ee/helm/temporal-worker');
const applianceValuesPath = path.join(
  repositoryRoot,
  'ee/appliance/flux/profiles/single-node/values/temporal-worker.single-node.yaml'
);
const helmPath = process.env.HELM_BIN || 'helm';

function renderDeployment(args: string[] = []): Record<string, any> {
  const rendered = execFileSync(helmPath, ['template', 'temporal-worker', chartPath, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  return loadAll(rendered).find((document: any) => document?.kind === 'Deployment') as Record<string, any>;
}

function sharedTenantSecrets(deployment: Record<string, any>) {
  const podSpec = deployment.spec.template.spec;
  const container = podSpec.containers.find((candidate: any) => candidate.name === 'temporal-worker');
  return {
    env: container.env.find((entry: any) => entry.name === 'SECRET_FS_BASE_PATH'),
    mount: (container.volumeMounts || []).find((entry: any) => entry.name === 'shared-tenant-secrets'),
    volume: (podSpec.volumes || []).find((entry: any) => entry.name === 'shared-tenant-secrets'),
  };
}

describe('temporal-worker shared tenant secrets Helm rendering', () => {
  it('keeps the hosted selector at two labels while the appliance retains its legacy component label', () => {
    expect(renderDeployment().spec.selector.matchLabels).toEqual({
      'app.kubernetes.io/name': 'temporal-worker',
      'app.kubernetes.io/instance': 'temporal-worker',
    });
    expect(renderDeployment(['--values', applianceValuesPath]).spec.selector.matchLabels).toEqual({
      'app.kubernetes.io/name': 'temporal-worker',
      'app.kubernetes.io/instance': 'temporal-worker',
      'app.kubernetes.io/component': 'temporal-worker',
    });
  });

  it('renders the shared hostPath, writable mount, and filesystem base path when enabled', () => {
    const secrets = sharedTenantSecrets(renderDeployment(['--set', 'sharedTenantSecrets.enabled=true']));

    expect(secrets.volume).toEqual({
      name: 'shared-tenant-secrets',
      hostPath: {
        path: '/var/lib/alga-appliance/tenant-secrets',
        type: 'DirectoryOrCreate',
      },
    });
    // Entra sync persists refreshed tokens through this mount; readOnly must not render.
    expect(secrets.mount).toEqual({
      name: 'shared-tenant-secrets',
      mountPath: '/shared-tenant-secrets',
    });
    expect(secrets.env).toEqual({ name: 'SECRET_FS_BASE_PATH', value: '/shared-tenant-secrets' });
  });

  it('still honours an explicit read-only opt-in', () => {
    const secrets = sharedTenantSecrets(
      renderDeployment(['--set', 'sharedTenantSecrets.enabled=true', '--set', 'sharedTenantSecrets.readOnly=true'])
    );

    expect(secrets.mount).toEqual({
      name: 'shared-tenant-secrets',
      mountPath: '/shared-tenant-secrets',
      readOnly: true,
    });
  });

  it('does not change the default hosted Deployment object graph', () => {
    expect(sharedTenantSecrets(renderDeployment())).toEqual({
      env: undefined,
      mount: undefined,
      volume: undefined,
    });
  });

  it('enables a writable shared mount through the single-node Flux values overlay', () => {
    const deployment = renderDeployment(['--values', applianceValuesPath]);
    const secrets = sharedTenantSecrets(deployment);

    expect(secrets.mount).toEqual({
      name: 'shared-tenant-secrets',
      mountPath: '/shared-tenant-secrets',
    });
    expect(secrets.env).toEqual({ name: 'SECRET_FS_BASE_PATH', value: '/shared-tenant-secrets' });
  });

  it('runs the appliance worker as the uid that initializes the shared secret store', () => {
    const deployment = renderDeployment(['--values', applianceValuesPath]);
    const container = deployment.spec.template.spec.containers.find(
      (candidate: any) => candidate.name === 'temporal-worker'
    );
    const coreRendered = execFileSync(helmPath, [
      'template', 'alga-core', path.join(repositoryRoot, 'helm'),
      '--values', path.join(repositoryRoot, 'ee/appliance/flux/profiles/single-node/values/alga-core.single-node.yaml'),
      '--show-only', 'templates/deployment.yaml',
    ], { cwd: repositoryRoot, encoding: 'utf8' });
    const corePod = (loadAll(coreRendered).find((doc: any) => doc?.kind === 'Deployment') as any).spec.template.spec;
    const initializer = corePod.initContainers.find((candidate: any) => candidate.name === 'fix-permissions');
    const initEnv = Object.fromEntries(initializer.env.map((entry: any) => [entry.name, entry.value]));

    expect(container.securityContext).toEqual({ runAsUser: 1000, runAsGroup: 1000 });
    expect(Number(initEnv.TARGET_UID)).toBe(container.securityContext.runAsUser);
    expect(Number(initEnv.TARGET_GID)).toBe(container.securityContext.runAsGroup);
    expect(initializer.command).toEqual(['/usr/local/bin/alga-runtime-permissions']);
    expect(initializer.securityContext).toMatchObject({ runAsUser: 0, allowPrivilegeEscalation: false });
    const initMount = initializer.volumeMounts.find((mount: any) => mount.name === 'shared-tenant-secrets');
    expect(initEnv.TENANTS_DIR).toBe(initMount.mountPath);
    expect(corePod.volumes.find((volume: any) => volume.name === initMount.name).hostPath)
      .toEqual(sharedTenantSecrets(deployment).volume.hostPath);
  });
});
