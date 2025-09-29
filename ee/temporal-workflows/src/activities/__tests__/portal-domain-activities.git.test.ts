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

    expect(baseVirtualService.spec.hosts).toContain('portal.mspmind.com');
    expect(baseVirtualService.spec.gateways).toContain(
      'istio-system/portal-domain-gw-active-id',
    );
    expect(
      JSON.parse(
        baseVirtualService.metadata.annotations?.[
          'portal.alga-psa.com/managed-hosts'
        ] ?? '[]',
      ),
    ).toContain('portal.mspmind.com');
    expect(
      JSON.parse(
        baseVirtualService.metadata.annotations?.[
          'portal.alga-psa.com/managed-gateways'
        ] ?? '[]',
      ),
    ).toContain('istio-system/portal-domain-gw-active-id');
    expect(baseVirtualServicePatches.length).toBeGreaterThan(0);
  });

  it('adds a default redirect route for the new domain in the base virtual service', async () => {
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

    const managedRedirect = baseVirtualServicePatches
      .flatMap((patch) => (Array.isArray(patch?.spec?.http) ? patch.spec.http : []))
      .find((route) => {
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
    expect(baseVirtualServicePatches.length).toBe(0);
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

    expect(baseVirtualService.spec.hosts).toEqual(['apps.algapsa.com']);
    expect(baseVirtualService.spec.gateways).toEqual(['istio-system/alga-psa-gw']);
    expect(
      baseVirtualService.metadata.annotations?.[
        'portal.alga-psa.com/managed-hosts'
      ],
    ).toBeUndefined();
    expect(
      baseVirtualService.metadata.annotations?.[
        'portal.alga-psa.com/managed-gateways'
      ],
    ).toBeUndefined();
    expect(baseVirtualServicePatches.length).toBeGreaterThan(0);
  });

  it('removes managed redirect routes when the domain is removed', async () => {
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

    const lastHttpPatch = [...baseVirtualServicePatches]
      .reverse()
      .find((patch) => Array.isArray(patch?.spec?.http));

    expect(lastHttpPatch).toBeDefined();
    const redirectStillPresent = (lastHttpPatch?.spec?.http ?? []).some((route: any) => {
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

    expect(baseVirtualService.spec.hosts).toEqual(['apps.algapsa.com']);
    expect(baseVirtualService.spec.gateways).toEqual(['istio-system/alga-psa-gw']);
    expect(
      baseVirtualService.metadata.annotations?.[
        'portal.alga-psa.com/managed-hosts'
      ],
    ).toBeUndefined();
    expect(
      baseVirtualService.metadata.annotations?.[
        'portal.alga-psa.com/managed-gateways'
      ],
    ).toBeUndefined();
    expect(baseVirtualServicePatches.length).toBeGreaterThan(0);
  });

  it('places redirect route before generic catch-all route', async () => {
    process.env.GITHUB_ACCESS_TOKEN = 'test-token';
    process.env.PORTAL_DOMAIN_GIT_REPO = 'https://example.com/mock/mock-config.git';
    process.env.PORTAL_DOMAIN_GIT_WORKDIR = tmpDir;
    process.env.PORTAL_DOMAIN_GIT_BRANCH = 'main';
    process.env.PORTAL_DOMAIN_GIT_ROOT = 'portal-domains';
    process.env.PORTAL_DOMAIN_BASE_VIRTUAL_SERVICE = 'msp/alga-psa-vs';
    process.env.PORTAL_DOMAIN_SERVICE_HOST = 'sebastian.msp.svc.cluster.local';

    // Add a generic catch-all route at the end
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

    // Get the final http routes array
    const finalHttpRoutes = baseVirtualService.spec.http;

    // Find the index of the redirect route
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

    // Find the index of the catch-all route
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
});
