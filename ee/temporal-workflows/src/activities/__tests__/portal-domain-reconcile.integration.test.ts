import { beforeEach, describe, expect, it, vi } from 'vitest';

const virtualServices: any[] = [];
const certificates: any[] = [];

vi.mock('@alga-psa/shared/db/admin.js', () => {
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
  };
});

vi.mock('@kubernetes/client-node', () => {
  class FakeCustomObjectsApi {
    getNamespacedCustomObject = vi.fn().mockRejectedValue({ response: { status: 404 } });
    replaceNamespacedCustomObject = vi.fn();
    createNamespacedCustomObject = vi.fn((group: string, version: string, namespace: string, plural: string, body: any) => {
      if (plural === 'virtualservices') {
        virtualServices.push(body);
      }
      if (plural === 'certificates') {
        certificates.push(body);
      }
      return { body: { metadata: { resourceVersion: '1' } } };
    });
    listNamespacedCustomObject = vi.fn().mockResolvedValue({ body: { items: [] } });
    deleteNamespacedCustomObject = vi.fn().mockResolvedValue({});
  }

  const fakeApi = new FakeCustomObjectsApi();

  class FakeKubeConfig {
    loadFromFile() {}
    loadFromDefault() {}
    makeApiClient() {
      return fakeApi;
    }
  }

  return {
    KubeConfig: FakeKubeConfig,
    CustomObjectsApi: FakeCustomObjectsApi,
  };
});

describe('reconcilePortalDomains', () => {
  beforeEach(() => {
    virtualServices.length = 0;
    certificates.length = 0;
  });

  it('routes virtual service traffic to the app once certificate succeeds', async () => {
    const { reconcilePortalDomains } = await import('../portal-domain-activities.js');

    const result = await reconcilePortalDomains({ tenantId: 'tenant-success', portalDomainId: 'domain-success' });

    expect(result.success).toBe(true);
    expect(virtualServices).toHaveLength(1);

    const [virtualService] = virtualServices;
    const httpRoutes = virtualService?.spec?.http ?? [];
    expect(httpRoutes.length).toBeGreaterThan(0);

    const primaryRoute = httpRoutes[httpRoutes.length - 1];
    expect(primaryRoute?.route?.[0]?.destination?.host).toBe('sebastian.msp.svc.cluster.local');
  });
});
