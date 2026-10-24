import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { load, loadAll } from 'js-yaml';
import { __setCommandRunnerForTests } from '../portal-domain-activities';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const virtualServices: any[] = [];
const certificates: any[] = [];
const deletedVirtualServices: Array<{ namespace: string; name: string }> = [];

const db = vi.hoisted(() => {
  const seedRows = () => [
    {
      id: 'domain-success',
      tenant: 'tenant-success',
      domain: 'success.example.com',
      canonical_host: 'tenantok.portal.algapsa.com',
      status: 'pending_certificate',
      status_message: 'DNS verified. Awaiting certificate issuance.',
      verification_details: {},
      certificate_secret_name: null as string | null,
      last_synced_resource_version: null as string | null,
      surface: 'client_portal',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];
  return { seedRows, rows: [] as Array<Record<string, any>> };
});

vi.mock('@alga-psa/db/admin.js', () => {
  type Predicate = (row: Record<string, any>) => boolean;

  function normalizeUpdates(updates: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(updates)) {
      result[key] = typeof value === 'function' ? value() : value;
    }
    return result;
  }

  // Chainable like a real knex builder: every where/whereIn narrows the row set,
  // so tenant scoping added by tenantDb composes with the caller's row filter.
  function builder(predicates: Predicate[]): any {
    const matching = () => db.rows.filter((row) => predicates.every((predicate) => predicate(row)));
    return {
      where(columnOrClause: string | Record<string, any>, value?: unknown) {
        const predicate: Predicate =
          typeof columnOrClause === 'string'
            ? (row) => row[columnOrClause.split('.').pop() as string] === value
            : (row) => Object.entries(columnOrClause).every(([key, expected]) => row[key] === expected);
        return builder([...predicates, predicate]);
      },
      whereIn(field: string, values: unknown[]) {
        return builder([...predicates, (row) => values.includes(row[field])]);
      },
      async select() {
        return matching().map((row) => ({ ...row }));
      },
      async first() {
        const [row] = matching();
        return row ? { ...row } : undefined;
      },
      async update(updates: Record<string, any>) {
        const targets = matching();
        targets.forEach((row) => Object.assign(row, normalizeUpdates(updates)));
        return targets.length;
      },
    };
  }

  const knex: any = (tableName: string) => {
    if (tableName !== 'portal_domains') {
      throw new Error(`Unexpected table name: ${tableName}`);
    }
    return builder([]);
  };

  knex.fn = { now: () => new Date().toISOString() };

  return {
    getAdminConnection: vi.fn(async () => knex),
    retryOnAdminReadOnly: async (operation: () => Promise<unknown>) => operation(),
  };
});

let workspace: string;

describe('applyPortalDomainResources', () => {
  beforeEach(async () => {
    db.rows.splice(0, db.rows.length, ...db.seedRows());
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

  it('writes reconcile metadata only to the addressed (tenant, id) rows and never touches surface', async () => {
    db.rows.push(
      {
        ...db.seedRows()[0],
        id: 'domain-msp-disabled',
        tenant: 'tenant-other',
        domain: 'msp.other.example.com',
        status: 'disabled',
        certificate_secret_name: 'stale-secret',
        last_synced_resource_version: '42',
        surface: 'msp',
      },
      {
        ...db.seedRows()[0],
        id: 'domain-success',
        tenant: 'tenant-other',
        domain: 'collision.other.example.com',
        status: 'disabled',
        certificate_secret_name: null,
        last_synced_resource_version: null,
        surface: 'msp',
      },
    );
    const { applyPortalDomainResources } = await import('../portal-domain-activities.js');

    const result = await applyPortalDomainResources({ tenantId: 'tenant-success', portalDomainId: 'domain-success' });

    expect(result.success, JSON.stringify(result.errors)).toBe(true);
    const byKey = (tenant: string, id: string) => db.rows.find((row) => row.tenant === tenant && row.id === id);

    const managed = byKey('tenant-success', 'domain-success');
    expect(managed?.certificate_secret_name).toEqual(expect.any(String));
    expect(managed?.surface).toBe('client_portal');

    const cleared = byKey('tenant-other', 'domain-msp-disabled');
    expect(cleared?.certificate_secret_name).toBeNull();
    expect(cleared?.last_synced_resource_version).toBeNull();
    expect(cleared?.surface).toBe('msp');

    // Same id, different tenant: the secret sync for tenant-success must not leak onto it.
    const sameIdOtherTenant = byKey('tenant-other', 'domain-success');
    expect(sameIdOtherTenant?.certificate_secret_name).toBeNull();
    expect(sameIdOtherTenant?.surface).toBe('msp');
  });
});
