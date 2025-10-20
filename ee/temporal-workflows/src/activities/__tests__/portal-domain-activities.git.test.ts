import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import { mkdtemp, rm } from 'node:fs/promises';
import { load as yamlLoad } from 'js-yaml';

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
import type { Knex } from 'knex';
import { applyPortalDomainResources } from '../portal-domain-activities';
import { promises as fs } from 'node:fs';

describe('portal domain git integration helpers', () => {
  const commands: Array<{ command: string; args: string[]; cwd?: string }> = [];
  let tmpDir: string;
  const originalEnv = { ...process.env };
  let baseVirtualService: any;
  let baseVirtualServicePatches: Array<Record<string, any>>;
  const secretStore = new Map<string, any>();
  const gitTrackedFiles = new Map<string, string>();

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
      if (args[0] === 'add') {
        const pathsToAdd = args.slice(1);
        const allFlagIndex = pathsToAdd.indexOf('--all');
        if (allFlagIndex >= 0) {
          const dirPath = pathsToAdd[allFlagIndex + 1] || '.';
          const fullDirPath = path.isAbsolute(dirPath)
            ? dirPath
            : path.join(options.cwd || tmpDir, dirPath);

          gitTrackedFiles.set(path.join(fullDirPath, 'istio-virtualservice.yaml'), 'staged');
          gitTrackedFiles.set(path.join(fullDirPath, 'portal-domain-*.yaml'), 'staged');
        } else {
          for (const filePath of pathsToAdd) {
            gitTrackedFiles.set(filePath, 'staged');
          }
        }
      }
      if (args[0] === 'status') {
        const modifiedFiles = Array.from(gitTrackedFiles.keys())
          .filter(f => gitTrackedFiles.get(f) === 'staged')
          .map(f => ` M ${f}`)
          .join('\n');
        return { stdout: modifiedFiles || ' M portal-domains/example.yaml\n', stderr: '' };
      }
    }
    if (command === 'kubectl') {
      if (args[0] === 'get' && args[1] === 'virtualservice') {
        return {
          stdout: JSON.stringify(baseVirtualService ?? {}),
          stderr: '',
        };
      }
      if (args[0] === 'patch' && args[1] === 'virtualservice') {
        const payloadIndex = args.indexOf('-p');
        if (payloadIndex >= 0) {
          const patch = JSON.parse(args[payloadIndex + 1] ?? '{}');
          baseVirtualServicePatches.push(patch);
          if (patch?.spec?.hosts) {
            baseVirtualService.spec = baseVirtualService.spec || {};
            baseVirtualService.spec.hosts = patch.spec.hosts;
          }
          if (patch?.spec?.gateways) {
            baseVirtualService.spec = baseVirtualService.spec || {};
            baseVirtualService.spec.gateways = patch.spec.gateways;
          }
          if (patch?.spec?.http) {
            baseVirtualService.spec = baseVirtualService.spec || {};
            baseVirtualService.spec.http = patch.spec.http;
          }
          if (patch?.metadata?.annotations) {
            baseVirtualService.metadata = baseVirtualService.metadata || {};
            baseVirtualService.metadata.annotations =
              baseVirtualService.metadata.annotations || {};
            for (const [key, value] of Object.entries(
              patch.metadata.annotations,
            )) {
              if (value === null) {
                delete baseVirtualService.metadata.annotations[key];
              } else {
                baseVirtualService.metadata.annotations[key] = value;
              }
            }
          }
        }
        return { stdout: '', stderr: '' };
      }
      if (args[0] === 'get' && args[1] === 'secret') {
        const name = args[2];
        const namespaceIndex = args.indexOf('-n');
        const namespace = namespaceIndex >= 0 ? args[namespaceIndex + 1] : 'default';
        const key = `${namespace}/${name}`;
        if (!secretStore.has(key)) {
          const secret = {
            apiVersion: 'v1',
            kind: 'Secret',
            metadata: {
              name,
              namespace,
              resourceVersion: '1',
            },
            type: 'kubernetes.io/tls',
            data: {
              'tls.crt': Buffer.from('certificate').toString('base64'),
              'tls.key': Buffer.from('key').toString('base64'),
            },
          };
          secretStore.set(key, secret);
        }

        return { stdout: JSON.stringify(secretStore.get(key)), stderr: '' };
      }
    }
    return { stdout: '', stderr: '' };
  };

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'portal-domains-test-'));
    commands.length = 0;
    baseVirtualService = {
      apiVersion: 'networking.istio.io/v1beta1',
      kind: 'VirtualService',
      metadata: {
        name: 'alga-psa-vs',
        namespace: 'msp',
        annotations: {},
      },
      spec: {
        hosts: ['apps.algapsa.com'],
        gateways: ['istio-system/alga-psa-gw'],
        http: [],
      },
    };
    baseVirtualServicePatches = [];
    secretStore.clear();
    gitTrackedFiles.clear();
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
      gatewayHttpsPort: 443,
  virtualServiceNamespace: 'msp',
  serviceHost: 'sebastian.msp.svc.cluster.local',
  servicePort: 3000,
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

  it('runs kubectl apply/delete when applying domain resources', async () => {
    process.env.GITHUB_ACCESS_TOKEN = 'test-token';
    process.env.PORTAL_DOMAIN_GIT_REPO = 'https://example.com/mock/mock-config.git';
    process.env.PORTAL_DOMAIN_GIT_WORKDIR = tmpDir;
    process.env.PORTAL_DOMAIN_GIT_BRANCH = 'main';
    process.env.PORTAL_DOMAIN_GIT_ROOT = 'portal-domains';
    process.env.PORTAL_DOMAIN_SERVICE_HOST = 'sebastian.msp.svc.cluster.local';

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

    await applyPortalDomainResources({ tenantId: 'tenant-one', portalDomainId: 'active-id' });

    const kubectlCommands = commands.filter((entry) => entry.command === 'kubectl').map((entry) => entry.args[0]);
    expect(kubectlCommands).toContain('delete');
    expect(kubectlCommands).toContain('apply');

    const newFiles = await listYamlFiles(manifestRoot);
    expect(newFiles).toContain('active-id.yaml');
    expect(newFiles).not.toContain('stale.yaml');

    expect(updates.length).toBeGreaterThan(0);
  });

  it('adds the new portal domain host and gateway to the base virtual service', async () => {
    process.env.GITHUB_ACCESS_TOKEN = 'test-token';
    process.env.PORTAL_DOMAIN_GIT_REPO = 'https://example.com/mock/mock-config.git';
    process.env.PORTAL_DOMAIN_GIT_WORKDIR = tmpDir;
    process.env.PORTAL_DOMAIN_GIT_BRANCH = 'main';
    process.env.PORTAL_DOMAIN_GIT_ROOT = 'portal-domains';
    process.env.PORTAL_DOMAIN_BASE_VIRTUAL_SERVICE = 'msp/alga-psa-vs';
    process.env.PORTAL_DOMAIN_SERVICE_HOST = 'sebastian.msp.svc.cluster.local';

    const repoDir = path.join(tmpDir, 'nm-kube-config');
    const manifestRoot = path.join(repoDir, 'portal-domains');

    const now = new Date().toISOString();
    const rows: PortalDomainActivityRecord[] = [
      {
        id: 'active-id',
        tenant: 'Tenant One',
        domain: 'portal.mspmind.com',
        canonical_host: 'tenantone.portal.algapsa.com',
        status: 'active',
        status_message: null,
        verification_details: null,
        certificate_secret_name: null,
        last_synced_resource_version: null,
        created_at: now,
        updated_at: now,
      },
    ];

    const knexMock = Object.assign(
      (table: string) => {
        if (table === 'portal_domains') {
          return {
            select: () => Promise.resolve(rows),
            where() {
              return {
                update: () => Promise.resolve(1),
              };
            },
            whereIn() {
              return {
                update: () => Promise.resolve(1),
              };
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

    await applyPortalDomainResources({ tenantId: 'tenant-one', portalDomainId: 'active-id' });

    const renderedFiles = await listYamlFiles(manifestRoot);
    expect(renderedFiles).toContain('active-id.yaml');

    const vsFilePath = path.join(repoDir, 'istio-virtualservice.yaml');
    const vsContent = await fs.readFile(vsFilePath, 'utf8');
    const vs = yamlLoad(vsContent) as any;

    expect(vs.spec.hosts).toContain('portal.mspmind.com');
    expect(vs.spec.gateways).toContain(
      'istio-system/portal-domain-gw-active-id',
    );
    expect(
      JSON.parse(
        vs.metadata.annotations?.[
          'portal.alga-psa.com/managed-hosts'
        ] ?? '[]',
      ),
    ).toContain('portal.mspmind.com');
    expect(
      JSON.parse(
        vs.metadata.annotations?.[
          'portal.alga-psa.com/managed-gateways'
        ] ?? '[]',
      ),
    ).toContain('istio-system/portal-domain-gw-active-id');
  });

  it('adds a default redirect route for the new domain in the base virtual service', async () => {
    process.env.GITHUB_ACCESS_TOKEN = 'test-token';
    process.env.PORTAL_DOMAIN_GIT_REPO = 'https://example.com/mock/mock-config.git';
    process.env.PORTAL_DOMAIN_GIT_WORKDIR = tmpDir;
    process.env.PORTAL_DOMAIN_GIT_BRANCH = 'main';
    process.env.PORTAL_DOMAIN_GIT_ROOT = 'portal-domains';
    process.env.PORTAL_DOMAIN_BASE_VIRTUAL_SERVICE = 'msp/alga-psa-vs';
    process.env.PORTAL_DOMAIN_SERVICE_HOST = 'sebastian.msp.svc.cluster.local';

    const repoDir = path.join(tmpDir, 'nm-kube-config');
    const manifestRoot = path.join(repoDir, 'portal-domains');

    const now = new Date().toISOString();
    const rows: PortalDomainActivityRecord[] = [
      {
        id: 'active-id',
        tenant: 'Tenant One',
        domain: 'portal.mspmind.com',
        canonical_host: 'tenantone.portal.algapsa.com',
        status: 'active',
        status_message: null,
        verification_details: null,
        certificate_secret_name: null,
        last_synced_resource_version: null,
        created_at: now,
        updated_at: now,
      },
    ];

    const knexMock = Object.assign(
      (table: string) => {
        if (table === 'portal_domains') {
          return {
            select: () => Promise.resolve(rows),
            where() {
              return {
                update: () => Promise.resolve(1),
              };
            },
            whereIn() {
              return {
                update: () => Promise.resolve(1),
              };
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

    await applyPortalDomainResources({ tenantId: 'tenant-one', portalDomainId: 'active-id' });

    const vsFilePath = path.join(repoDir, 'istio-virtualservice.yaml');
    const vsContent = await fs.readFile(vsFilePath, 'utf8');
    const vs = yamlLoad(vsContent) as any;

    const managedRedirect = (vs.spec.http || []).find((route: any) => {
        if (!route?.redirect || !Array.isArray(route?.match)) {
          return false;
        }
        const matchesDomain = route.match.some(
          (condition: any) =>
            condition?.authority?.exact === 'portal.mspmind.com' &&
            condition?.uri?.exact === '/',
        );
        return matchesDomain && route.redirect.uri === '/client-portal/dashboard';
      });

    expect(managedRedirect).toBeDefined();
    expect(managedRedirect?.redirect).toMatchObject({ uri: '/client-portal/dashboard' });
    expect(managedRedirect?.match).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          authority: expect.objectContaining({ exact: 'portal.mspmind.com' }),
          uri: expect.objectContaining({ exact: '/' }),
        }),
      ]),
    );
  });

  it('does not duplicate host entries when the domain already exists', async () => {
    process.env.GITHUB_ACCESS_TOKEN = 'test-token';
    process.env.PORTAL_DOMAIN_GIT_REPO = 'https://example.com/mock/mock-config.git';
    process.env.PORTAL_DOMAIN_GIT_WORKDIR = tmpDir;
    process.env.PORTAL_DOMAIN_GIT_BRANCH = 'main';
    process.env.PORTAL_DOMAIN_GIT_ROOT = 'portal-domains';
    process.env.PORTAL_DOMAIN_BASE_VIRTUAL_SERVICE = 'msp/alga-psa-vs';
    process.env.PORTAL_DOMAIN_SERVICE_HOST = 'sebastian.msp.svc.cluster.local';

    const repoDir = path.join(tmpDir, 'nm-kube-config');
    const manifestRoot = path.join(repoDir, 'portal-domains');

    baseVirtualService.spec.hosts.push('portal.mspmind.com');
    baseVirtualService.spec.gateways.push('istio-system/portal-domain-gw-active-id');
    baseVirtualService.metadata.annotations![
      'portal.alga-psa.com/managed-hosts'
    ] = JSON.stringify(['portal.mspmind.com']);
    baseVirtualService.metadata.annotations![
      'portal.alga-psa.com/managed-gateways'
    ] = JSON.stringify(['istio-system/portal-domain-gw-active-id']);
    baseVirtualService.spec.http.push({
      match: [
        {
          authority: { exact: 'portal.mspmind.com' },
          uri: { exact: '/' },
        },
      ],
      redirect: { uri: '/client-portal/dashboard' },
    });

    const now = new Date().toISOString();
    const rows: PortalDomainActivityRecord[] = [
      {
        id: 'active-id',
        tenant: 'Tenant One',
        domain: 'portal.mspmind.com',
        canonical_host: 'tenantone.portal.algapsa.com',
        status: 'active',
        status_message: null,
        verification_details: null,
        certificate_secret_name: 'existing-secret',
        last_synced_resource_version: '1',
        created_at: now,
        updated_at: now,
      },
    ];

    const knexMock = Object.assign(
      (table: string) => {
        if (table === 'portal_domains') {
          return {
            select: () => Promise.resolve(rows),
            where() {
              return {
                update: () => Promise.resolve(1),
              };
            },
            whereIn() {
              return {
                update: () => Promise.resolve(1),
              };
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

    await applyPortalDomainResources({ tenantId: 'tenant-one', portalDomainId: 'active-id' });

    const hostOccurrences = baseVirtualService.spec.hosts.filter(
      (host: string) => host === 'portal.mspmind.com',
    ).length;
    expect(hostOccurrences).toBe(1);
    const gatewayOccurrences = baseVirtualService.spec.gateways.filter(
      (gateway: string) => gateway === 'istio-system/portal-domain-gw-active-id',
    ).length;
    expect(gatewayOccurrences).toBe(1);
    const redirectOccurrences = baseVirtualService.spec.http.filter((route: any) => {
      if (!route?.redirect || !Array.isArray(route?.match)) {
        return false;
      }
      return route.redirect.uri === '/client-portal/dashboard' &&
        route.match.some(
          (condition: any) =>
            condition?.authority?.exact === 'portal.mspmind.com' &&
            condition?.uri?.exact === '/',
        );
    }).length;
    expect(redirectOccurrences).toBe(1);
  });

  it('removes managed hosts and gateways when no domains remain', async () => {
    process.env.GITHUB_ACCESS_TOKEN = 'test-token';
    process.env.PORTAL_DOMAIN_GIT_REPO = 'https://example.com/mock/mock-config.git';
    process.env.PORTAL_DOMAIN_GIT_WORKDIR = tmpDir;
    process.env.PORTAL_DOMAIN_GIT_BRANCH = 'main';
    process.env.PORTAL_DOMAIN_GIT_ROOT = 'portal-domains';
    process.env.PORTAL_DOMAIN_BASE_VIRTUAL_SERVICE = 'msp/alga-psa-vs';
    process.env.PORTAL_DOMAIN_SERVICE_HOST = 'sebastian.msp.svc.cluster.local';

    const repoDir = path.join(tmpDir, 'nm-kube-config');
    const manifestRoot = path.join(repoDir, 'portal-domains');

    baseVirtualService.spec.hosts.push('portal.mspmind.com');
    baseVirtualService.spec.gateways.push('istio-system/portal-domain-gw-active-id');
    baseVirtualService.metadata.annotations![
      'portal.alga-psa.com/managed-hosts'
    ] = JSON.stringify(['portal.mspmind.com']);
    baseVirtualService.metadata.annotations![
      'portal.alga-psa.com/managed-gateways'
    ] = JSON.stringify(['istio-system/portal-domain-gw-active-id']);

    const now = new Date().toISOString();
    const rows: PortalDomainActivityRecord[] = [];

    const knexMock = Object.assign(
      (table: string) => {
        if (table === 'portal_domains') {
          return {
            select: () => Promise.resolve(rows),
            where() {
              return {
                update: () => Promise.resolve(0),
              };
            },
            whereIn() {
              return {
                update: () => Promise.resolve(0),
              };
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

    await applyPortalDomainResources({ tenantId: 'tenant-one', portalDomainId: 'inactive-id' });

    const vsFilePath = path.join(repoDir, 'istio-virtualservice.yaml');
    const vsContent = await fs.readFile(vsFilePath, 'utf8');
    const vs = yamlLoad(vsContent) as any;

    expect(vs.spec.hosts).toEqual(['apps.algapsa.com']);
    expect(vs.spec.gateways).toEqual(['istio-system/alga-psa-gw']);
    expect(
      vs.metadata.annotations?.[
        'portal.alga-psa.com/managed-hosts'
      ],
    ).toBeUndefined();
    expect(
      vs.metadata.annotations?.[
        'portal.alga-psa.com/managed-gateways'
      ],
    ).toBeUndefined();
  });

  it('removes managed redirect routes when the domain is removed', async () => {
    process.env.GITHUB_ACCESS_TOKEN = 'test-token';
    process.env.PORTAL_DOMAIN_GIT_REPO = 'https://example.com/mock/mock-config.git';
    process.env.PORTAL_DOMAIN_GIT_WORKDIR = tmpDir;
    process.env.PORTAL_DOMAIN_GIT_BRANCH = 'main';
    process.env.PORTAL_DOMAIN_GIT_ROOT = 'portal-domains';
    process.env.PORTAL_DOMAIN_BASE_VIRTUAL_SERVICE = 'msp/alga-psa-vs';
    process.env.PORTAL_DOMAIN_SERVICE_HOST = 'sebastian.msp.svc.cluster.local';

    const repoDir = path.join(tmpDir, 'nm-kube-config');
    const manifestRoot = path.join(repoDir, 'portal-domains');

    baseVirtualService.spec.hosts.push('portal.mspmind.com');
    baseVirtualService.spec.gateways.push('istio-system/portal-domain-gw-active-id');
    baseVirtualService.metadata.annotations![
      'portal.alga-psa.com/managed-hosts'
    ] = JSON.stringify(['portal.mspmind.com']);
    baseVirtualService.metadata.annotations![
      'portal.alga-psa.com/managed-gateways'
    ] = JSON.stringify(['istio-system/portal-domain-gw-active-id']);
    baseVirtualService.spec.http.push(
      {
        match: [
          {
            authority: { exact: 'portal.mspmind.com' },
            uri: { exact: '/' },
          },
        ],
        redirect: { uri: '/client-portal/dashboard' },
      },
      {
        match: [
          {
            uri: { prefix: '/' },
          },
        ],
        route: [
          {
            destination: {
              host: 'apps.algapsa.com',
            },
          },
        ],
      },
    );

    const now = new Date().toISOString();
    const rows: PortalDomainActivityRecord[] = [];

    const knexMock = Object.assign(
      (table: string) => {
        if (table === 'portal_domains') {
          return {
            select: () => Promise.resolve(rows),
            where() {
              return {
                update: () => Promise.resolve(0),
              };
            },
            whereIn() {
              return {
                update: () => Promise.resolve(0),
              };
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

    await applyPortalDomainResources({ tenantId: 'tenant-one', portalDomainId: 'inactive-id' });

    const vsFilePath = path.join(repoDir, 'istio-virtualservice.yaml');
    const vsContent = await fs.readFile(vsFilePath, 'utf8');
    const vs = yamlLoad(vsContent) as any;

    const redirectStillPresent = (vs.spec.http || []).some((route: any) => {
      if (!route?.redirect || !Array.isArray(route?.match)) {
        return false;
      }
      return route.redirect.uri === '/client-portal/dashboard' &&
        route.match.some(
          (condition: any) =>
            condition?.authority?.exact === 'portal.mspmind.com' &&
            condition?.uri?.exact === '/',
        );
    });

    expect(redirectStillPresent).toBe(false);
  });

  it('removes gateway resources and routing when a domain is disabled', async () => {
    process.env.GITHUB_ACCESS_TOKEN = 'test-token';
    process.env.PORTAL_DOMAIN_GIT_REPO = 'https://example.com/mock/mock-config.git';
    process.env.PORTAL_DOMAIN_GIT_WORKDIR = tmpDir;
    process.env.PORTAL_DOMAIN_GIT_BRANCH = 'main';
    process.env.PORTAL_DOMAIN_GIT_ROOT = 'portal-domains';
    process.env.PORTAL_DOMAIN_BASE_VIRTUAL_SERVICE = 'msp/alga-psa-vs';
    process.env.PORTAL_DOMAIN_SERVICE_HOST = 'sebastian.msp.svc.cluster.local';

    baseVirtualService.spec.hosts.push('portal.mspmind.com');
    baseVirtualService.spec.gateways.push('istio-system/portal-domain-gw-active-id');
    baseVirtualService.metadata.annotations![
      'portal.alga-psa.com/managed-hosts'
    ] = JSON.stringify(['portal.mspmind.com']);
    baseVirtualService.metadata.annotations![
      'portal.alga-psa.com/managed-gateways'
    ] = JSON.stringify(['istio-system/portal-domain-gw-active-id']);

    const now = new Date().toISOString();
    const rows: PortalDomainActivityRecord[] = [
      {
        id: 'disabled-id',
        tenant: 'Tenant One',
        domain: 'portal.mspmind.com',
        canonical_host: 'tenantone.portal.algapsa.com',
        status: 'disabled',
        status_message: 'Custom domain disabled',
        verification_details: null,
        certificate_secret_name: 'portal-domain-disabled-id',
        last_synced_resource_version: '42',
        created_at: now,
        updated_at: now,
      },
    ];

    const knexMock = Object.assign(
      (table: string) => {
        if (table === 'portal_domains') {
          return {
            select: () => Promise.resolve(rows),
            where() {
              return {
                update: () => Promise.resolve(1),
              };
            },
            whereIn() {
              return {
                update: () => Promise.resolve(1),
              };
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

    await applyPortalDomainResources({ tenantId: 'tenant-one', portalDomainId: 'disabled-id' });

    const kubectlDeletes = commands.filter(
      (entry) => entry.command === 'kubectl' && entry.args[0] === 'delete',
    );
    expect(kubectlDeletes.length).toBeGreaterThan(0);

    const repoDir = path.join(tmpDir, 'nm-kube-config');
    const manifestRoot = path.join(repoDir, 'portal-domains');
    const vsFilePath = path.join(repoDir, 'istio-virtualservice.yaml');
    const vsContent = await fs.readFile(vsFilePath, 'utf8');
    const vs = yamlLoad(vsContent) as any;

    expect(vs.spec.hosts).toEqual(['apps.algapsa.com']);
    expect(vs.spec.gateways).toEqual(['istio-system/alga-psa-gw']);
    expect(
      vs.metadata.annotations?.[
        'portal.alga-psa.com/managed-hosts'
      ],
    ).toBeUndefined();
    expect(
      vs.metadata.annotations?.[
        'portal.alga-psa.com/managed-gateways'
      ],
    ).toBeUndefined();
  });

  it('cleans up unmanaged resources when domain is removed', async () => {
    process.env.GITHUB_ACCESS_TOKEN = 'test-token';
    process.env.PORTAL_DOMAIN_GIT_REPO = 'https://example.com/mock/mock-config.git';
    process.env.PORTAL_DOMAIN_GIT_WORKDIR = tmpDir;
    process.env.PORTAL_DOMAIN_GIT_BRANCH = 'main';
    process.env.PORTAL_DOMAIN_GIT_ROOT = 'portal-domains';
    process.env.PORTAL_DOMAIN_BASE_VIRTUAL_SERVICE = 'msp/alga-psa-vs';
    process.env.PORTAL_DOMAIN_SERVICE_HOST = 'sebastian.msp.svc.cluster.local';

    const repoDir = path.join(tmpDir, 'nm-kube-config');
    const manifestRoot = path.join(repoDir, 'portal-domains');

    baseVirtualService.spec.hosts.push('portal.orphaned.com');
    baseVirtualService.spec.gateways.push('istio-system/portal-domain-gw-orphaned-id');

    const now = new Date().toISOString();
    const rows: PortalDomainActivityRecord[] = [
      {
        id: 'orphaned-id',
        tenant: 'Tenant Orphaned',
        domain: 'portal.orphaned.com',
        canonical_host: 'orphaned.portal.algapsa.com',
        status: 'disabled',
        status_message: 'Custom domain disabled',
        verification_details: null,
        certificate_secret_name: 'portal-domain-orphaned-id',
        last_synced_resource_version: '42',
        created_at: now,
        updated_at: now,
      },
    ];

    const knexMock = Object.assign(
      (table: string) => {
        if (table === 'portal_domains') {
          return {
            select: () => Promise.resolve(rows),
            where() {
              return {
                update: () => Promise.resolve(0),
              };
            },
            whereIn() {
              return {
                update: () => Promise.resolve(0),
              };
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

    await applyPortalDomainResources({ tenantId: 'tenant-orphaned', portalDomainId: 'orphaned-id' });

    const vsFilePath = path.join(repoDir, 'istio-virtualservice.yaml');
    const vsContent = await fs.readFile(vsFilePath, 'utf8');
    const vs = yamlLoad(vsContent) as any;

    expect(vs.spec.hosts).not.toContain('portal.orphaned.com');
    expect(vs.spec.hosts).toEqual(['apps.algapsa.com']);

    expect(vs.spec.gateways).not.toContain('istio-system/portal-domain-gw-orphaned-id');
    expect(vs.spec.gateways).toEqual(['istio-system/alga-psa-gw']);
  });

  it('places redirect route before generic catch-all route', async () => {
    process.env.GITHUB_ACCESS_TOKEN = 'test-token';
    process.env.PORTAL_DOMAIN_GIT_REPO = 'https://example.com/mock/mock-config.git';
    process.env.PORTAL_DOMAIN_GIT_WORKDIR = tmpDir;
    process.env.PORTAL_DOMAIN_GIT_BRANCH = 'main';
    process.env.PORTAL_DOMAIN_GIT_ROOT = 'portal-domains';
    process.env.PORTAL_DOMAIN_BASE_VIRTUAL_SERVICE = 'msp/alga-psa-vs';
    process.env.PORTAL_DOMAIN_SERVICE_HOST = 'sebastian.msp.svc.cluster.local';

    baseVirtualService.spec.http.push({
      route: [
        {
          destination: {
            host: 'sebastian-blue.msp.svc.cluster.local',
            port: {
              number: 3000,
            },
          },
          weight: 100,
        },
        {
          destination: {
            host: 'sebastian-green.msp.svc.cluster.local',
            port: {
              number: 3000,
            },
          },
          weight: 0,
        },
      ],
    });

    const now = new Date().toISOString();
    const rows: PortalDomainActivityRecord[] = [
      {
        id: 'active-id',
        tenant: 'Tenant One',
        domain: 'portal.mspmind.com',
        canonical_host: 'tenantone.portal.algapsa.com',
        status: 'active',
        status_message: null,
        verification_details: null,
        certificate_secret_name: null,
        last_synced_resource_version: null,
        created_at: now,
        updated_at: now,
      },
    ];

    const knexMock = Object.assign(
      (table: string) => {
        if (table === 'portal_domains') {
          return {
            select: () => Promise.resolve(rows),
            where() {
              return {
                update: () => Promise.resolve(1),
              };
            },
            whereIn() {
              return {
                update: () => Promise.resolve(1),
              };
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

    await applyPortalDomainResources({ tenantId: 'tenant-one', portalDomainId: 'active-id' });

    const repoDir = path.join(tmpDir, 'nm-kube-config');
    const manifestRoot = path.join(repoDir, 'portal-domains');
    const vsFilePath = path.join(repoDir, 'istio-virtualservice.yaml');
    const vsContent = await fs.readFile(vsFilePath, 'utf8');
    const vs = yamlLoad(vsContent) as any;

    const finalHttpRoutes = vs.spec.http;

    const redirectIndex = finalHttpRoutes.findIndex((route: any) => {
      if (!route?.redirect || !Array.isArray(route?.match)) {
        return false;
      }
      return route.redirect.uri === '/client-portal/dashboard' &&
        route.match.some(
          (condition: any) =>
            condition?.authority?.exact === 'portal.mspmind.com' &&
            condition?.uri?.exact === '/',
        );
    });

    const catchAllIndex = finalHttpRoutes.findIndex((route: any) => {
      if (!route?.route || Array.isArray(route?.match)) {
        return false;
      }
      return route.route.some(
        (dest: any) =>
          dest?.destination?.host === 'sebastian-blue.msp.svc.cluster.local' ||
          dest?.destination?.host === 'sebastian-green.msp.svc.cluster.local',
      );
    });

    expect(redirectIndex).toBeGreaterThanOrEqual(0);
    expect(catchAllIndex).toBeGreaterThanOrEqual(0);
    expect(redirectIndex).toBeLessThan(catchAllIndex);
  });

  describe('Base VirtualService file-based editing (TDD - these tests expose the gap)', () => {
    it('should write base VirtualService updates to istio-virtualservice.yaml in git', async () => {
      process.env.GITHUB_ACCESS_TOKEN = 'test-token';
      process.env.PORTAL_DOMAIN_GIT_REPO = 'https://example.com/mock/mock-config.git';
      process.env.PORTAL_DOMAIN_GIT_WORKDIR = tmpDir;
      process.env.PORTAL_DOMAIN_GIT_BRANCH = 'main';
      process.env.PORTAL_DOMAIN_GIT_ROOT = 'portal-domains';
      process.env.PORTAL_DOMAIN_BASE_VIRTUAL_SERVICE = 'msp/alga-psa-vs';
      process.env.PORTAL_DOMAIN_SERVICE_HOST = 'sebastian.msp.svc.cluster.local';

      const repoDir = path.join(tmpDir, 'nm-kube-config');
      const manifestRoot = path.join(repoDir, 'portal-domains');

      const now = new Date().toISOString();
      const rows: PortalDomainActivityRecord[] = [
        {
          id: 'active-id',
          tenant: 'Tenant One',
          domain: 'portal.mspmind.com',
          canonical_host: 'tenantone.portal.algapsa.com',
          status: 'active',
          status_message: null,
          verification_details: null,
          certificate_secret_name: null,
          last_synced_resource_version: null,
          created_at: now,
          updated_at: now,
        },
      ];

      const knexMock = Object.assign(
        (table: string) => {
          if (table === 'portal_domains') {
            return {
              select: () => Promise.resolve(rows),
              where() {
                return {
                  update: () => Promise.resolve(1),
                };
              },
              whereIn() {
                return {
                  update: () => Promise.resolve(1),
                };
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

      await applyPortalDomainResources({ tenantId: 'tenant-one', portalDomainId: 'active-id' });

      const vsFilePath = path.join(repoDir, 'istio-virtualservice.yaml');
      const fileExists = await fs.access(vsFilePath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);

      const fileContent = await fs.readFile(vsFilePath, 'utf8');
      const parsed = yamlLoad(fileContent) as any;
      expect(parsed.kind).toBe('VirtualService');
      expect(parsed.metadata.name).toBe('alga-psa-vs');
      expect(parsed.spec.hosts).toContain('portal.mspmind.com');
      expect(parsed.spec.gateways).toContain('istio-system/portal-domain-gw-active-id');
    });

    it('should strip runtime metadata fields before writing base VirtualService', async () => {
      process.env.GITHUB_ACCESS_TOKEN = 'test-token';
      process.env.PORTAL_DOMAIN_GIT_REPO = 'https://example.com/mock/mock-config.git';
      process.env.PORTAL_DOMAIN_GIT_WORKDIR = tmpDir;
      process.env.PORTAL_DOMAIN_GIT_BRANCH = 'main';
      process.env.PORTAL_DOMAIN_GIT_ROOT = 'portal-domains';
      process.env.PORTAL_DOMAIN_BASE_VIRTUAL_SERVICE = 'msp/alga-psa-vs';
      process.env.PORTAL_DOMAIN_SERVICE_HOST = 'sebastian.msp.svc.cluster.local';

      baseVirtualService.metadata.resourceVersion = '603903974';
      baseVirtualService.metadata.uid = '55c7a351-a091-4db8-a83b-df882fab6b7c';
      baseVirtualService.metadata.creationTimestamp = '2025-09-30T21:44:39Z';
      baseVirtualService.metadata.generation = 19;
      baseVirtualService.metadata.annotations['kubectl.kubernetes.io/last-applied-configuration'] = '{"mock":"config"}';
      baseVirtualService.status = { observedGeneration: 19 };

      const repoDir = path.join(tmpDir, 'nm-kube-config');

      const now = new Date().toISOString();
      const rows: PortalDomainActivityRecord[] = [
        {
          id: 'active-id',
          tenant: 'Tenant One',
          domain: 'portal.mspmind.com',
          canonical_host: 'tenantone.portal.algapsa.com',
          status: 'active',
          status_message: null,
          verification_details: null,
          certificate_secret_name: null,
          last_synced_resource_version: null,
          created_at: now,
          updated_at: now,
        },
      ];

      const knexMock = Object.assign(
        (table: string) => {
          if (table === 'portal_domains') {
            return {
              select: () => Promise.resolve(rows),
              where() {
                return {
                  update: () => Promise.resolve(1),
                };
              },
              whereIn() {
                return {
                  update: () => Promise.resolve(1),
                };
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

      await applyPortalDomainResources({ tenantId: 'tenant-one', portalDomainId: 'active-id' });

      const vsFilePath = path.join(repoDir, 'istio-virtualservice.yaml');
      const fileContent = await fs.readFile(vsFilePath, 'utf8');
      const parsed = yamlLoad(fileContent) as any;

      expect(parsed.metadata.resourceVersion).toBeUndefined();
      expect(parsed.metadata.uid).toBeUndefined();
      expect(parsed.metadata.creationTimestamp).toBeUndefined();
      expect(parsed.metadata.generation).toBeUndefined();
      expect(parsed.metadata.annotations?.['kubectl.kubernetes.io/last-applied-configuration']).toBeUndefined();
      expect(parsed.status).toBeUndefined();
    });

    it('should sanitize base VirtualService metadata even when routing is unchanged', async () => {
      process.env.GITHUB_ACCESS_TOKEN = 'test-token';
      process.env.PORTAL_DOMAIN_GIT_REPO = 'https://example.com/mock/mock-config.git';
      process.env.PORTAL_DOMAIN_GIT_WORKDIR = tmpDir;
      process.env.PORTAL_DOMAIN_GIT_BRANCH = 'main';
      process.env.PORTAL_DOMAIN_GIT_ROOT = 'portal-domains';
      process.env.PORTAL_DOMAIN_BASE_VIRTUAL_SERVICE = 'msp/alga-psa-vs';
      process.env.PORTAL_DOMAIN_SERVICE_HOST = 'sebastian.msp.svc.cluster.local';

      baseVirtualService.metadata.resourceVersion = '12345';
      baseVirtualService.metadata.creationTimestamp = '2025-01-01T00:00:00Z';
      baseVirtualService.metadata.annotations['kubectl.kubernetes.io/last-applied-configuration'] = '{"mock":"config"}';
      baseVirtualService.spec.hosts = ['apps.algapsa.com'];
      baseVirtualService.spec.gateways = ['istio-system/alga-psa-gw'];

      const repoDir = path.join(tmpDir, 'nm-kube-config');

      const knexMock = Object.assign(
        (table: string) => {
          if (table === 'portal_domains') {
            return {
              select: () => Promise.resolve([]),
              where() {
                return {
                  update: () => Promise.resolve(0),
                };
              },
              whereIn() {
                return {
                  update: () => Promise.resolve(0),
                };
              },
            };
          }
          throw new Error(`Unexpected table ${table}`);
        },
        {
          fn: {
            now: () => new Date(),
          },
        }
      );

      __setConnectionFactoryForTests(() => Promise.resolve(knexMock as unknown as Knex));

      await applyPortalDomainResources({ tenantId: 'tenant-one', portalDomainId: 'inactive-id' });

      const vsFilePath = path.join(repoDir, 'istio-virtualservice.yaml');
      const fileContent = await fs.readFile(vsFilePath, 'utf8');
      const parsed = yamlLoad(fileContent) as any;

      expect(parsed.metadata.resourceVersion).toBeUndefined();
      expect(parsed.metadata.creationTimestamp).toBeUndefined();
      expect(parsed.metadata.annotations?.['kubectl.kubernetes.io/last-applied-configuration']).toBeUndefined();
      expect(parsed.spec.hosts).toEqual(['apps.algapsa.com']);
      expect(parsed.spec.gateways).toEqual(['istio-system/alga-psa-gw']);
    });

    it('should commit base VirtualService changes to git', async () => {
      process.env.GITHUB_ACCESS_TOKEN = 'test-token';
      process.env.PORTAL_DOMAIN_GIT_REPO = 'https://example.com/mock/mock-config.git';
      process.env.PORTAL_DOMAIN_GIT_WORKDIR = tmpDir;
      process.env.PORTAL_DOMAIN_GIT_BRANCH = 'main';
      process.env.PORTAL_DOMAIN_GIT_ROOT = 'portal-domains';
      process.env.PORTAL_DOMAIN_BASE_VIRTUAL_SERVICE = 'msp/alga-psa-vs';
      process.env.PORTAL_DOMAIN_SERVICE_HOST = 'sebastian.msp.svc.cluster.local';

      const now = new Date().toISOString();
      const rows: PortalDomainActivityRecord[] = [
        {
          id: 'active-id',
          tenant: 'Tenant One',
          domain: 'portal.mspmind.com',
          canonical_host: 'tenantone.portal.algapsa.com',
          status: 'active',
          status_message: null,
          verification_details: null,
          certificate_secret_name: null,
          last_synced_resource_version: null,
          created_at: now,
          updated_at: now,
        },
      ];

      const knexMock = Object.assign(
        (table: string) => {
          if (table === 'portal_domains') {
            return {
              select: () => Promise.resolve(rows),
              where() {
                return {
                  update: () => Promise.resolve(1),
                };
              },
              whereIn() {
                return {
                  update: () => Promise.resolve(1),
                };
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

      await applyPortalDomainResources({ tenantId: 'tenant-one', portalDomainId: 'active-id' });

      const gitStatusCommands = commands.filter(
        cmd => cmd.command === 'git' && cmd.args[0] === 'status'
      );
      expect(gitStatusCommands.length).toBeGreaterThan(0);

      const vsFileTracked = Array.from(gitTrackedFiles.keys()).some(
        key => key.includes('istio-virtualservice.yaml')
      );
      expect(vsFileTracked).toBe(true);
    });

    it('should not use kubectl patch for base VirtualService updates', async () => {
      process.env.GITHUB_ACCESS_TOKEN = 'test-token';
      process.env.PORTAL_DOMAIN_GIT_REPO = 'https://example.com/mock/mock-config.git';
      process.env.PORTAL_DOMAIN_GIT_WORKDIR = tmpDir;
      process.env.PORTAL_DOMAIN_GIT_BRANCH = 'main';
      process.env.PORTAL_DOMAIN_GIT_ROOT = 'portal-domains';
      process.env.PORTAL_DOMAIN_BASE_VIRTUAL_SERVICE = 'msp/alga-psa-vs';
      process.env.PORTAL_DOMAIN_SERVICE_HOST = 'sebastian.msp.svc.cluster.local';

      const now = new Date().toISOString();
      const rows: PortalDomainActivityRecord[] = [
        {
          id: 'active-id',
          tenant: 'Tenant One',
          domain: 'portal.mspmind.com',
          canonical_host: 'tenantone.portal.algapsa.com',
          status: 'active',
          status_message: null,
          verification_details: null,
          certificate_secret_name: null,
          last_synced_resource_version: null,
          created_at: now,
          updated_at: now,
        },
      ];

      const knexMock = Object.assign(
        (table: string) => {
          if (table === 'portal_domains') {
            return {
              select: () => Promise.resolve(rows),
              where() {
                return {
                  update: () => Promise.resolve(1),
                };
              },
              whereIn() {
                return {
                  update: () => Promise.resolve(1),
                };
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

      await applyPortalDomainResources({ tenantId: 'tenant-one', portalDomainId: 'active-id' });

      const patchCommands = commands.filter(
        cmd => cmd.command === 'kubectl' &&
               cmd.args[0] === 'patch' &&
               cmd.args[1] === 'virtualservice'
      );
      expect(patchCommands.length).toBe(0);
    });

    it('should generate valid base VirtualService YAML with correct structure', async () => {
      process.env.GITHUB_ACCESS_TOKEN = 'test-token';
      process.env.PORTAL_DOMAIN_GIT_REPO = 'https://example.com/mock/mock-config.git';
      process.env.PORTAL_DOMAIN_GIT_WORKDIR = tmpDir;
      process.env.PORTAL_DOMAIN_GIT_BRANCH = 'main';
      process.env.PORTAL_DOMAIN_GIT_ROOT = 'portal-domains';
      process.env.PORTAL_DOMAIN_BASE_VIRTUAL_SERVICE = 'msp/alga-psa-vs';
      process.env.PORTAL_DOMAIN_SERVICE_HOST = 'sebastian.msp.svc.cluster.local';

      const repoDir = path.join(tmpDir, 'nm-kube-config');
      const manifestRoot = path.join(repoDir, 'portal-domains');

      baseVirtualService.spec.http.push({
        route: [
          {
            destination: {
              host: 'sebastian-blue.msp.svc.cluster.local',
              port: { number: 3000 },
            },
            weight: 100,
          },
        ],
      });

      const now = new Date().toISOString();
      const rows: PortalDomainActivityRecord[] = [
        {
          id: 'domain-1',
          tenant: 'Tenant One',
          domain: 'portal1.example.com',
          canonical_host: 'tenant1.portal.algapsa.com',
          status: 'active',
          status_message: null,
          verification_details: null,
          certificate_secret_name: null,
          last_synced_resource_version: null,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'domain-2',
          tenant: 'Tenant Two',
          domain: 'portal2.example.com',
          canonical_host: 'tenant2.portal.algapsa.com',
          status: 'active',
          status_message: null,
          verification_details: null,
          certificate_secret_name: null,
          last_synced_resource_version: null,
          created_at: now,
          updated_at: now,
        },
      ];

      const knexMock = Object.assign(
        (table: string) => {
          if (table === 'portal_domains') {
            return {
              select: () => Promise.resolve(rows),
              where() {
                return {
                  update: () => Promise.resolve(2),
                };
              },
              whereIn() {
                return {
                  update: () => Promise.resolve(2),
                };
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

      await applyPortalDomainResources({ tenantId: 'tenant-one', portalDomainId: 'domain-1' });

      const vsFilePath = path.join(repoDir, 'istio-virtualservice.yaml');
      const fileContent = await fs.readFile(vsFilePath, 'utf8');
      const vs = yamlLoad(fileContent) as any;

      expect(vs.spec.hosts).toContain('portal1.example.com');
      expect(vs.spec.hosts).toContain('portal2.example.com');
      expect(vs.spec.hosts).toContain('apps.algapsa.com');

      expect(vs.spec.gateways).toContain('istio-system/portal-domain-gw-domain-1');
      expect(vs.spec.gateways).toContain('istio-system/portal-domain-gw-domain-2');

      expect(vs.metadata.annotations['portal.alga-psa.com/managed-hosts']).toBeDefined();
      const managedHosts = JSON.parse(vs.metadata.annotations['portal.alga-psa.com/managed-hosts']);
      expect(managedHosts).toContain('portal1.example.com');
      expect(managedHosts).toContain('portal2.example.com');

      expect(vs.spec.http.length).toBeGreaterThan(0);
      const redirectRouteIndex = vs.spec.http.findIndex((r: any) => r.redirect);
      const catchAllIndex = vs.spec.http.findIndex((r: any) => !r.match && r.route);
      if (redirectRouteIndex >= 0 && catchAllIndex >= 0) {
        expect(redirectRouteIndex).toBeLessThan(catchAllIndex);
      }
    });

    it('should apply base VirtualService from file after editing', async () => {
      process.env.GITHUB_ACCESS_TOKEN = 'test-token';
      process.env.PORTAL_DOMAIN_GIT_REPO = 'https://example.com/mock/mock-config.git';
      process.env.PORTAL_DOMAIN_GIT_WORKDIR = tmpDir;
      process.env.PORTAL_DOMAIN_GIT_BRANCH = 'main';
      process.env.PORTAL_DOMAIN_GIT_ROOT = 'portal-domains';
      process.env.PORTAL_DOMAIN_BASE_VIRTUAL_SERVICE = 'msp/alga-psa-vs';
      process.env.PORTAL_DOMAIN_SERVICE_HOST = 'sebastian.msp.svc.cluster.local';

      const now = new Date().toISOString();
      const rows: PortalDomainActivityRecord[] = [
        {
          id: 'active-id',
          tenant: 'Tenant One',
          domain: 'portal.mspmind.com',
          canonical_host: 'tenantone.portal.algapsa.com',
          status: 'active',
          status_message: null,
          verification_details: null,
          certificate_secret_name: null,
          last_synced_resource_version: null,
          created_at: now,
          updated_at: now,
        },
      ];

      const knexMock = Object.assign(
        (table: string) => {
          if (table === 'portal_domains') {
            return {
              select: () => Promise.resolve(rows),
              where() {
                return {
                  update: () => Promise.resolve(1),
                };
              },
              whereIn() {
                return {
                  update: () => Promise.resolve(1),
                };
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

      await applyPortalDomainResources({ tenantId: 'tenant-one', portalDomainId: 'active-id' });

      const applyCommands = commands.filter(
        cmd => cmd.command === 'kubectl' && cmd.args[0] === 'apply'
      );

      expect(applyCommands.length).toBeGreaterThan(0);

      const baseVsApplied = applyCommands.some(cmd =>
        cmd.args.some(arg =>
          arg.includes('istio-virtualservice.yaml') ||
          arg.includes('portal-domains')
        )
      );

      expect(baseVsApplied).toBe(true);
    });

    it('should remove managed hosts from base VirtualService file when domains are removed', async () => {
      process.env.GITHUB_ACCESS_TOKEN = 'test-token';
      process.env.PORTAL_DOMAIN_GIT_REPO = 'https://example.com/mock/mock-config.git';
      process.env.PORTAL_DOMAIN_GIT_WORKDIR = tmpDir;
      process.env.PORTAL_DOMAIN_GIT_BRANCH = 'main';
      process.env.PORTAL_DOMAIN_GIT_ROOT = 'portal-domains';
      process.env.PORTAL_DOMAIN_BASE_VIRTUAL_SERVICE = 'msp/alga-psa-vs';
      process.env.PORTAL_DOMAIN_SERVICE_HOST = 'sebastian.msp.svc.cluster.local';

      const repoDir = path.join(tmpDir, 'nm-kube-config');
      const manifestRoot = path.join(repoDir, 'portal-domains');

      baseVirtualService.spec.hosts.push('portal.example.com');
      baseVirtualService.spec.gateways.push('istio-system/portal-domain-gw-test-id');
      baseVirtualService.metadata.annotations['portal.alga-psa.com/managed-hosts'] =
        JSON.stringify(['portal.example.com']);
      baseVirtualService.metadata.annotations['portal.alga-psa.com/managed-gateways'] =
        JSON.stringify(['istio-system/portal-domain-gw-test-id']);

      const rows: PortalDomainActivityRecord[] = [];

      const knexMock = Object.assign(
        (table: string) => {
          if (table === 'portal_domains') {
            return {
              select: () => Promise.resolve(rows),
              where() {
                return {
                  update: () => Promise.resolve(0),
                };
              },
              whereIn() {
                return {
                  update: () => Promise.resolve(0),
                };
              },
            };
          }
          throw new Error(`Unexpected table ${table}`);
        },
        {
          fn: {
            now: () => new Date(),
          },
        }
      );

      __setConnectionFactoryForTests(() => Promise.resolve(knexMock as unknown as Knex));

      await applyPortalDomainResources({ tenantId: 'tenant-one', portalDomainId: 'inactive-id' });

      const vsFilePath = path.join(repoDir, 'istio-virtualservice.yaml');
      const fileContent = await fs.readFile(vsFilePath, 'utf8');
      const vs = yamlLoad(fileContent) as any;

      expect(vs.spec.hosts).not.toContain('portal.example.com');
      expect(vs.spec.hosts).toContain('apps.algapsa.com');
      expect(vs.spec.gateways).not.toContain('istio-system/portal-domain-gw-test-id');

      expect(vs.metadata.annotations?.['portal.alga-psa.com/managed-hosts']).toBeUndefined();
      expect(vs.metadata.annotations?.['portal.alga-psa.com/managed-gateways']).toBeUndefined();
    });

    it('should not delete base VirtualService when removing managed domains and gateways', async () => {
      process.env.GITHUB_ACCESS_TOKEN = 'test-token';
      process.env.PORTAL_DOMAIN_GIT_REPO = 'https://example.com/mock/mock-config.git';
      process.env.PORTAL_DOMAIN_GIT_WORKDIR = tmpDir;
      process.env.PORTAL_DOMAIN_GIT_BRANCH = 'main';
      process.env.PORTAL_DOMAIN_GIT_ROOT = 'portal-domains';
      process.env.PORTAL_DOMAIN_BASE_VIRTUAL_SERVICE = 'msp/alga-psa-vs';
      process.env.PORTAL_DOMAIN_SERVICE_HOST = 'sebastian.msp.svc.cluster.local';

      const repoDir = path.join(tmpDir, 'nm-kube-config');
      const manifestRoot = path.join(repoDir, 'portal-domains');

      baseVirtualService.spec.hosts.push('portal.mspmind.com');
      baseVirtualService.spec.gateways.push('istio-system/portal-domain-gw-active-id');
      baseVirtualService.metadata.annotations['portal.alga-psa.com/managed-hosts'] =
        JSON.stringify(['portal.mspmind.com']);
      baseVirtualService.metadata.annotations['portal.alga-psa.com/managed-gateways'] =
        JSON.stringify(['istio-system/portal-domain-gw-active-id']);

      baseVirtualService.spec.http.push({
        match: [
          {
            authority: { exact: 'portal.mspmind.com' },
            uri: { exact: '/' },
          },
        ],
        redirect: { uri: '/client-portal/dashboard' },
      });

      const rows: PortalDomainActivityRecord[] = [];

      const knexMock = Object.assign(
        (table: string) => {
          if (table === 'portal_domains') {
            return {
              select: () => Promise.resolve(rows),
              where() {
                return {
                  update: () => Promise.resolve(0),
                };
              },
              whereIn() {
                return {
                  update: () => Promise.resolve(0),
                };
              },
            };
          }
          throw new Error(`Unexpected table ${table}`);
        },
        {
          fn: {
            now: () => new Date(),
          },
        }
      );

      __setConnectionFactoryForTests(() => Promise.resolve(knexMock as unknown as Knex));

      await applyPortalDomainResources({ tenantId: 'tenant-one', portalDomainId: 'removed-id' });

      const deleteCommands = commands.filter(
        cmd => cmd.command === 'kubectl' && cmd.args[0] === 'delete'
      );

      const baseVsDeleted = deleteCommands.some(cmd =>
        cmd.args.includes('virtualservice') &&
        (cmd.args.includes('alga-psa-vs') || cmd.args.some(arg => arg.includes('istio-virtualservice.yaml')))
      );

      expect(baseVsDeleted).toBe(false);

      const vsFilePath = path.join(repoDir, 'istio-virtualservice.yaml');
      let fileExists = false;
      try {
        await fs.access(vsFilePath);
        fileExists = true;
      } catch (error) {
        fileExists = false;
      }

      expect(fileExists).toBe(true);

      const fileContent = await fs.readFile(vsFilePath, 'utf8');
      const vs = yamlLoad(fileContent) as any;

      expect(vs.spec.hosts).toContain('apps.algapsa.com');
      expect(vs.spec.gateways).toContain('istio-system/alga-psa-gw');

      expect(vs.spec.hosts).not.toContain('portal.mspmind.com');
      expect(vs.spec.gateways).not.toContain('istio-system/portal-domain-gw-active-id');

      expect(vs.metadata.annotations?.['portal.alga-psa.com/managed-hosts']).toBeUndefined();
      expect(vs.metadata.annotations?.['portal.alga-psa.com/managed-gateways']).toBeUndefined();
    });

    it('should not delete pre-existing istio-virtualservice.yaml during cleanup phase', async () => {
      process.env.GITHUB_ACCESS_TOKEN = 'test-token';
      process.env.PORTAL_DOMAIN_GIT_REPO = 'https://example.com/mock/mock-config.git';
      process.env.PORTAL_DOMAIN_GIT_WORKDIR = tmpDir;
      process.env.PORTAL_DOMAIN_GIT_BRANCH = 'main';
      process.env.PORTAL_DOMAIN_GIT_ROOT = 'portal-domains';
      process.env.PORTAL_DOMAIN_BASE_VIRTUAL_SERVICE = 'msp/alga-psa-vs';
      process.env.PORTAL_DOMAIN_SERVICE_HOST = 'sebastian.msp.svc.cluster.local';

      const repoDir = path.join(tmpDir, 'nm-kube-config');
      const manifestRoot = path.join(repoDir, 'portal-domains');

      await fs.mkdir(repoDir, { recursive: true });
      const { dump: dumpYaml } = await import('js-yaml');
      const vsFilePath = path.join(repoDir, 'istio-virtualservice.yaml');
      await fs.writeFile(vsFilePath, dumpYaml(baseVirtualService), 'utf8');

      const now = new Date().toISOString();
      const rows: PortalDomainActivityRecord[] = [
        {
          id: 'active-id',
          tenant: 'Tenant One',
          domain: 'portal.mspmind.com',
          canonical_host: 'tenantone.portal.algapsa.com',
          status: 'active',
          status_message: null,
          verification_details: null,
          certificate_secret_name: null,
          last_synced_resource_version: null,
          created_at: now,
          updated_at: now,
        },
      ];

      const knexMock = Object.assign(
        (table: string) => {
          if (table === 'portal_domains') {
            return {
              select: () => Promise.resolve(rows),
              where() {
                return {
                  update: () => Promise.resolve(1),
                };
              },
              whereIn() {
                return {
                  update: () => Promise.resolve(1),
                };
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

      await applyPortalDomainResources({ tenantId: 'tenant-one', portalDomainId: 'active-id' });

      const deleteCommands = commands.filter(
        cmd => cmd.command === 'kubectl' && cmd.args[0] === 'delete'
      );

      const vsDeletedByKubectl = deleteCommands.some(cmd =>
        cmd.args.some(arg => arg.includes('istio-virtualservice.yaml'))
      );

      expect(vsDeletedByKubectl).toBe(false);

      let fileExists = false;
      try {
        await fs.access(vsFilePath);
        fileExists = true;
      } catch (error) {
        fileExists = false;
      }

      expect(fileExists).toBe(true);

      const fileContent = await fs.readFile(vsFilePath, 'utf8');
      const vs = yamlLoad(fileContent) as any;

      expect(vs.spec.hosts).toContain('portal.mspmind.com');
    });

    it('should edit existing istio-virtualservice.yaml in parent folder, not create new file in portal-domains', async () => {
      process.env.GITHUB_ACCESS_TOKEN = 'test-token';
      process.env.PORTAL_DOMAIN_GIT_REPO = 'https://example.com/mock/mock-config.git';
      process.env.PORTAL_DOMAIN_GIT_WORKDIR = tmpDir;
      process.env.PORTAL_DOMAIN_GIT_BRANCH = 'main';
      process.env.PORTAL_DOMAIN_GIT_ROOT = 'portal-domains';
      process.env.PORTAL_DOMAIN_BASE_VIRTUAL_SERVICE = 'msp/alga-psa-vs';
      process.env.PORTAL_DOMAIN_SERVICE_HOST = 'sebastian.msp.svc.cluster.local';

      const repoDir = path.join(tmpDir, 'nm-kube-config');
      const manifestRoot = path.join(repoDir, 'portal-domains');

      await fs.mkdir(repoDir, { recursive: true });
      const { dump: dumpYaml } = await import('js-yaml');
      const correctVsFilePath = path.join(repoDir, 'istio-virtualservice.yaml');
      await fs.writeFile(correctVsFilePath, dumpYaml(baseVirtualService), 'utf8');

      const now = new Date().toISOString();
      const rows: PortalDomainActivityRecord[] = [
        {
          id: 'active-id',
          tenant: 'Tenant One',
          domain: 'portal.mspmind.com',
          canonical_host: 'tenantone.portal.algapsa.com',
          status: 'active',
          status_message: null,
          verification_details: null,
          certificate_secret_name: null,
          last_synced_resource_version: null,
          created_at: now,
          updated_at: now,
        },
      ];

      const knexMock = Object.assign(
        (table: string) => {
          if (table === 'portal_domains') {
            return {
              select: () => Promise.resolve(rows),
              where() {
                return {
                  update: () => Promise.resolve(1),
                };
              },
              whereIn() {
                return {
                  update: () => Promise.resolve(1),
                };
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

      await applyPortalDomainResources({ tenantId: 'tenant-one', portalDomainId: 'active-id' });

      let correctFileExists = false;
      try {
        await fs.access(correctVsFilePath);
        correctFileExists = true;
      } catch (error) {
        correctFileExists = false;
      }
      expect(correctFileExists).toBe(true);

      const correctFileContent = await fs.readFile(correctVsFilePath, 'utf8');
      const correctVs = yamlLoad(correctFileContent) as any;
      expect(correctVs.spec.hosts).toContain('portal.mspmind.com');

      const wrongVsFilePath = path.join(manifestRoot, 'istio-virtualservice.yaml');
      let wrongFileExists = false;
      try {
        await fs.access(wrongVsFilePath);
        wrongFileExists = true;
      } catch (error) {
        wrongFileExists = false;
      }

      expect(wrongFileExists).toBe(false);

      const applyCommands = commands.filter(
        cmd => cmd.command === 'kubectl' && cmd.args[0] === 'apply'
      );

      const appliedFromWrongLocation = applyCommands.some(cmd =>
        cmd.args.some(arg => {
          if (typeof arg !== 'string') {
            return false;
          }
          const normalized = arg.replace(/\\/g, '/');
          return normalized.includes('/portal-domains/istio-virtualservice.yaml');
        })
      );

      expect(appliedFromWrongLocation).toBe(false);
    });
  });
});
