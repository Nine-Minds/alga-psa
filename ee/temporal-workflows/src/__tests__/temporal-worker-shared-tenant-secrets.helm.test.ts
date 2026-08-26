import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadAll } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '../../../..');
const chartPath = path.join(repositoryRoot, 'ee/helm/temporal-worker');
const applianceValuesPath = path.join(
  repositoryRoot,
  'ee/appliance/flux/profiles/single-node/values/temporal-worker.single-node.yaml'
);
const helmPath = process.env.HELM_BIN || '/snap/bin/helm';
const helmAvailable = existsSync(helmPath);

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

describe.skipIf(!helmAvailable)('temporal-worker shared tenant secrets Helm rendering', () => {
  it('renders the shared hostPath, read-only mount, and filesystem base path when enabled', () => {
    const secrets = sharedTenantSecrets(renderDeployment(['--set', 'sharedTenantSecrets.enabled=true']));

    expect(secrets.volume).toEqual({
      name: 'shared-tenant-secrets',
      hostPath: {
        path: '/var/lib/alga-appliance/tenant-secrets',
        type: 'DirectoryOrCreate',
      },
    });
    expect(secrets.mount).toEqual({
      name: 'shared-tenant-secrets',
      mountPath: '/shared-tenant-secrets',
      readOnly: true,
    });
    expect(secrets.env).toEqual({ name: 'SECRET_FS_BASE_PATH', value: '/shared-tenant-secrets' });
  });

  it('does not change the default hosted Deployment object graph', () => {
    expect(sharedTenantSecrets(renderDeployment())).toEqual({
      env: undefined,
      mount: undefined,
      volume: undefined,
    });
  });

  it('enables the shared mount through the single-node Flux values overlay', () => {
    const secrets = sharedTenantSecrets(renderDeployment(['--values', applianceValuesPath]));

    expect(secrets.mount).toMatchObject({
      name: 'shared-tenant-secrets',
      mountPath: '/shared-tenant-secrets',
      readOnly: true,
    });
    expect(secrets.env).toEqual({ name: 'SECRET_FS_BASE_PATH', value: '/shared-tenant-secrets' });
  });
});

if (!helmAvailable) {
  // Vitest surfaces this clear message beside the skipped suite in environments
  // that do not install Helm (for example a minimal unit-test image).
  console.warn(`Skipping temporal-worker Helm render tests: Helm was not found at ${helmPath}`);
}
