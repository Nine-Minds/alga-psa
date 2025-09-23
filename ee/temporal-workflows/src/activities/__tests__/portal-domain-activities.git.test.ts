import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import { mkdtemp, rm } from 'node:fs/promises';

import {
  resolveGitConfiguration,
  prepareGitRepository,
  __setCommandRunnerForTests,
  renderManifestYaml,
  renderPortalDomainResources,
  __setConnectionFactoryForTests,
  listYamlFiles,
} from '../portal-domain-activities';

import type { PortalDomainActivityRecord } from '../../workflows/portal-domains/types.js';
import type { PortalDomainConfig, CommandRunner } from '../portal-domain-activities.js';

import { reconcilePortalDomains } from '../portal-domain-activities';
import { promises as fs } from 'node:fs';

describe('portal domain git integration helpers', () => {
  const commands: Array<{ command: string; args: string[]; cwd?: string }> = [];
  let tmpDir: string;
  const originalEnv = { ...process.env };

const commandRunner: CommandRunner = async (command, args, options) => {
  commands.push({ command, args, cwd: options.cwd });
  if (command === 'git') {
    if (args[0] === 'clone') {
      const targetDir = args[2];
      await fs.mkdir(path.join(targetDir, '.git'), { recursive: true });
      const manifestDir = path.join(targetDir, 'portal-domains');
      await fs.mkdir(manifestDir, { recursive: true });
      await fs.writeFile(path.join(manifestDir, 'stale.yaml'), 'kind: List\n', 'utf8');
    }
    if (args[0] === 'status') {
      return { stdout: ' M portal-domains/example.yaml\n', stderr: '' };
    }
  }
  return { stdout: '', stderr: '' };
};

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'portal-domains-test-'));
    commands.length = 0;
    __setCommandRunnerForTests(commandRunner);
  });

  afterEach(async () => {
    __setCommandRunnerForTests(null);
    __setConnectionFactoryForTests(null);
    process.env = { ...originalEnv };
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('issues git setup commands during prepareGitRepository', async () => {
    process.env.GITHUB_ACCESS_TOKEN = 'test-token';
    process.env.PORTAL_DOMAIN_GIT_REPO = 'https://example.com/mock/nm-mock-config.git';
    process.env.PORTAL_DOMAIN_GIT_WORKDIR = tmpDir;

    const config = resolveGitConfiguration();
    await prepareGitRepository(config);

    expect(commands.map((entry) => entry.command)).toEqual(['git', 'git', 'git', 'git', 'git']);
    expect(commands[0]).toMatchObject({ command: 'git', args: ['clone', config.authenticatedRepoUrl, config.repoDir] });
    expect(commands[commands.length - 1]).toMatchObject({ command: 'git', args: ['pull', 'origin', config.branch], cwd: config.repoDir });
  });

  it('renders manifest yaml with expected documents', () => {
    const record: PortalDomainActivityRecord = {
      id: '123',
      tenant: 'Acme Corp',
      domain: 'portal.acme.example',
      canonical_host: 'abc1234.portal.algapsa.com',
      status: 'active',
      status_message: null,
      verification_details: null,
      certificate_secret_name: null,
      last_synced_resource_version: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const config: PortalDomainConfig = {
      certificateApiVersion: 'cert-manager.io/v1',
      certificateNamespace: 'msp',
      certificateIssuerName: 'letsencrypt',
      certificateIssuerKind: 'ClusterIssuer',
      certificateIssuerGroup: 'cert-manager.io',
      gatewayNamespace: 'istio-system',
      gatewaySelector: { istio: 'ingressgateway' },
      gatewayHttpPort: 80,
      gatewayHttpsPort: 443,
      virtualServiceNamespace: 'msp',
      serviceHost: 'sebastian.msp.svc.cluster.local',
      servicePort: 3000,
      challengeServiceHost: null,
      challengeServicePort: undefined,
      challengeRouteEnabled: false,
      manifestOutputDirectory: null,
    };

    const rendered = renderPortalDomainResources(record, config);
    const yaml = renderManifestYaml(rendered);

    expect(yaml.split('---').length).toBe(3);
    expect(yaml).toContain('kind: Certificate');
    expect(yaml).toContain('kind: Gateway');
    expect(yaml).toContain('kind: VirtualService');
    expect(yaml).toContain('portal.acme.example');
  });

  it('runs kubectl apply/delete when reconciling domains', async () => {
    process.env.GITHUB_ACCESS_TOKEN = 'test-token';
    process.env.PORTAL_DOMAIN_GIT_REPO = 'https://example.com/mock/mock-config.git';
    process.env.PORTAL_DOMAIN_GIT_WORKDIR = tmpDir;
    process.env.PORTAL_DOMAIN_GIT_BRANCH = 'main';
    process.env.PORTAL_DOMAIN_GIT_ROOT = 'portal-domains';

    const repoDir = path.join(tmpDir, 'nm-kube-config');
    const manifestRoot = path.join(repoDir, 'portal-domains');

    const now = new Date().toISOString();
    const updates: any[] = [];
    const rows: PortalDomainActivityRecord[] = [
      {
        id: 'active-id',
        tenant: 'Tenant One',
        domain: 'one.example.com',
        canonical_host: 'tenantone.portal.algapsa.com',
        status: 'active',
        status_message: null,
        verification_details: null,
        certificate_secret_name: null,
        last_synced_resource_version: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: 'disabled-id',
        tenant: 'Tenant Two',
        domain: 'two.example.com',
        canonical_host: 'tenanttwo.portal.algapsa.com',
        status: 'disabled',
        status_message: null,
        verification_details: null,
        certificate_secret_name: 'old-secret',
        last_synced_resource_version: 'rv1',
        created_at: now,
        updated_at: now,
      },
    ];

    const knexMock = Object.assign(
      (table: string) => {
        if (table === 'portal_domains') {
          return {
            select: () => Promise.resolve(rows),
            where(this: any, criteria: Record<string, unknown>) {
              this._where = criteria;
              return this;
            },
            whereIn(this: any, _column: string, values: unknown[]) {
              this._whereIn = values;
              return this;
            },
            update(this: any, data: unknown) {
              updates.push({ where: this._where, whereIn: this._whereIn, data });
              return Promise.resolve(1);
            },
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
      {
        fn: {
          now: () => new Date(now),
        },
      }
    );

    __setConnectionFactoryForTests(() => Promise.resolve(knexMock as unknown as Knex));

    await reconcilePortalDomains({ tenantId: 'tenant-one', portalDomainId: 'active-id' });

    const kubectlCommands = commands.filter((entry) => entry.command === 'kubectl').map((entry) => entry.args[0]);
    expect(kubectlCommands).toContain('delete');
    expect(kubectlCommands).toContain('apply');

    const newFiles = await listYamlFiles(manifestRoot);
    expect(newFiles).toContain('tenantone.yaml');
    expect(newFiles).not.toContain('stale.yaml');

    expect(updates.length).toBeGreaterThan(0);
  });
});
