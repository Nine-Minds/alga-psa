import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { load, loadAll } from 'js-yaml';
import { __setCommandRunnerForTests } from '../portal-domain-activities';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const virtualServices: any[] = [];
const certificates: any[] = [];
const deletedVirtualServices: Array<{ namespace: string; name: string }> = [];

vi.mock('@alga-psa/db/admin.js', () => {
  const rows = [
    {
      id: 'domain-success',
      tenant: 'tenant-success',
      domain: 'success.example.com',
      canonical_host: 'tenantok.portal.algapsa.com',
      status: 'pending_certificate',
      status_message: 'DNS verified. Awaiting certificate issuance.',
      verification_details: {},
      certificate_secret_name: null,
      last_synced_resource_version: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  function matches(where: Record<string, any>, row: Record<string, any>): boolean {
    return Object.entries(where).every(([key, value]) => row[key] === value);
  }

  const knexFnNow = () => new Date().toISOString();

  const knex: any = (tableName: string) => {
    if (tableName !== 'portal_domains') {
      throw new Error(`Unexpected table name: ${tableName}`);
    }

    return {
      async select() {
        return rows.map((row) => ({ ...row }));
      },
      where(whereClause: Record<string, any>) {
        return {
          async first() {
            return rows.find((row) => matches(whereClause, row)) ?? null;
          },
          async update(updates: Record<string, any>) {
            rows.forEach((row) => {
              if (matches(whereClause, row)) {
                Object.assign(row, normalizeUpdates(updates));
              }
            });
            return 1;
          },
        };
      },
      async update(updates: Record<string, any>) {
        rows.forEach((row) => Object.assign(row, normalizeUpdates(updates)));
        return rows.length;
      },
      whereIn(field: string, values: string[]) {
        return {
          async update(updates: Record<string, any>) {
            rows.forEach((row) => {
              if (values.includes(row[field])) {
                Object.assign(row, normalizeUpdates(updates));
              }
            });
            return values.length;
          },
        };
      },
    };
  };

  knex.fn = { now: knexFnNow };

  function normalizeUpdates(updates: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (typeof value === 'function') {
        result[key] = value();
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  return {
    getAdminConnection: vi.fn(async () => knex),
    retryOnAdminReadOnly: async (operation: () => Promise<unknown>) => operation(),
  };
});

let workspace: string;

describe('applyPortalDomainResources', () => {
  beforeEach(async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), 'portal-reconcile-'));
    vi.stubEnv('PORTAL_DOMAIN_SERVICE_HOST', 'sebastian.msp.svc.cluster.local');
    vi.stubEnv('PORTAL_DOMAIN_GIT_REPO', 'https://example.invalid/fixtures.git');
    vi.stubEnv('PORTAL_DOMAIN_GIT_WORKDIR', workspace);
    vi.stubEnv('PORTAL_DOMAIN_GIT_ROOT', 'portal-domains');
    vi.stubEnv('PORTAL_DOMAIN_BASE_VIRTUAL_SERVICE', '');
    vi.stubEnv('GITHUB_ACCESS_TOKEN', 'dummy-test-token');
    vi.stubEnv('GITHUB_APP_ID', '');
    vi.stubEnv('PORTAL_DOMAIN_GATEWAY_NAMESPACE', 'msp');
    vi.stubEnv('PORTAL_DOMAIN_CERT_NAMESPACE', 'msp');
    __setCommandRunnerForTests(async (command, args) => {
      if (command === 'git' && args[0] === 'clone') {
        const root = path.join(args[2], 'portal-domains');
        await mkdir(root, { recursive: true });
        await mkdir(path.join(args[2], '.git'), { recursive: true });
        await writeFile(path.join(root, 'old.yaml'), 'kind: VirtualService\nmetadata:\n  name: portal-domain-vs-old\n  namespace: msp\n');
      } else if (command === 'kubectl' && args[0] === 'delete') {
        const old = load(await readFile(args[2], 'utf8')) as any;
        deletedVirtualServices.push(old.metadata);
      } else if (command === 'kubectl' && args[0] === 'apply') {
        for (const file of await readdir(args[2])) {
          const manifests = loadAll(await readFile(path.join(args[2], file), 'utf8')) as any[];
          for (const item of manifests) {
            if (item.kind === 'VirtualService') virtualServices.push(item);
            if (item.kind === 'Certificate') certificates.push(item);
          }
        }
      }
      return { stdout: '', stderr: '' };
    });
    virtualServices.length = 0;
    certificates.length = 0;
    deletedVirtualServices.length = 0;
  });

  afterEach(async () => {
    __setCommandRunnerForTests(null);
    vi.unstubAllEnvs();
    await rm(workspace, { recursive: true, force: true });
  });

  it('routes virtual service traffic to the app once certificate succeeds', async () => {
    const { applyPortalDomainResources } = await import('../portal-domain-activities.js');

    const result = await applyPortalDomainResources({ tenantId: 'tenant-success', portalDomainId: 'domain-success' });

    expect(result.success, JSON.stringify(result.errors)).toBe(true);
    expect(virtualServices).toHaveLength(1);

    const [virtualService] = virtualServices;
    const httpRoutes = virtualService?.spec?.http ?? [];
    expect(httpRoutes.length).toBeGreaterThan(0);

    const primaryRoute = httpRoutes[httpRoutes.length - 1];
    expect(primaryRoute?.route?.[0]?.destination?.host).toBe('sebastian.msp.svc.cluster.local');
  });

  it('creates new manifests and prunes legacy virtual services when the domain changes', async () => {
    const { applyPortalDomainResources } = await import('../portal-domain-activities.js');

    const result = await applyPortalDomainResources({ tenantId: 'tenant-success', portalDomainId: 'domain-success' });

    expect(result.success, JSON.stringify(result.errors)).toBe(true);

    expect(virtualServices).toHaveLength(1);
    const newVirtualService = virtualServices[0];
    expect(newVirtualService.metadata?.name).toContain('portal-domain');
    expect(newVirtualService.spec?.http?.[0]?.route?.[0]?.destination?.host).toBe('sebastian.msp.svc.cluster.local');

    expect(deletedVirtualServices).toContainEqual({ namespace: 'msp', name: 'portal-domain-vs-old' });
  });
});
