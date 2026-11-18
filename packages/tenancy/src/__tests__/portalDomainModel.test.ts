import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => fn,
  withOptionalAuth: (fn: unknown) => fn,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => {
    throw new Error('createTenantKnex must not be used by tenant-scoped model helpers in unit tests');
  }),
  tenantDb: (conn: any, tenant: string) => ({
    table: (t: string) => conn(t).where({ tenant }),
    unscoped: (t: string, _reason?: string) => conn(t),
  }),
}));

import {
  PORTAL_DOMAIN_STATUSES,
  computeCanonicalHost,
  getPortalDomain,
  getPortalDomainByHostname,
  getTerminalStatuses,
  normalizeHostname,
  updatePortalDomain,
  upsertPortalDomain,
} from '../lib/PortalDomainModel';

type Row = Record<string, unknown>;

interface CapturedCalls {
  wheres: Array<{ table: string; filter: Row }>;
  inserts: Array<{ table: string; payload: Row }>;
  conflicts: string[];
  merges: Row[];
  updates: Array<{ table: string; filter: Row | null; payload: Row }>;
  deletes: Array<{ table: string; filter: Row | null; count: number }>;
}

function rowMatches(row: Row, filter: Row | null): boolean {
  if (!filter) return true;
  return Object.entries(filter).every(([key, value]) => row[key] === value);
}

/**
 * Minimal fake knex implementing only the query-builder surface the portal
 * domain model uses. It applies where-filters against an in-memory table so
 * a missing tenant constraint in the product code surfaces as a cross-tenant
 * leak in the assertions.
 */
function createFakeKnex(rows: Row[]) {
  const calls: CapturedCalls = { wheres: [], inserts: [], conflicts: [], merges: [], updates: [], deletes: [] };

  const knex = ((table: string) => {
    let filter: Row | null = null;
    const builder = {
      where(condition: Row) {
        // Accumulates like knex: tenant scope + row scope are both applied.
        filter = { ...(filter ?? {}), ...condition };
        calls.wheres.push({ table, filter: condition });
        return builder;
      },
      orderBy() {
        return builder;
      },
      select() {
        return Promise.resolve(rows.filter((row) => rowMatches(row, filter)));
      },
      async delete() {
        const matched = rows.filter((row) => rowMatches(row, filter));
        calls.deletes.push({ table, filter, count: matched.length });
        for (const row of matched) rows.splice(rows.indexOf(row), 1);
        return matched.length;
      },
      async first() {
        return rows.find((row) => rowMatches(row, filter));
      },
      insert(payload: Row) {
        calls.inserts.push({ table, payload });
        return {
          onConflict(column: string) {
            calls.conflicts.push(column);
            return {
              merge(mergePayload: Row) {
                calls.merges.push(mergePayload);
                return {
                  async returning() {
                    const existing = rows.find((row) => row.tenant === payload.tenant);
                    if (existing) {
                      Object.assign(existing, mergePayload);
                      return [existing];
                    }
                    rows.push({ ...payload });
                    return [{ ...payload }];
                  },
                };
              },
            };
          },
        };
      },
      update(payload: Row) {
        calls.updates.push({ table, filter, payload });
        return {
          async returning() {
            const matched = rows.filter((row) => rowMatches(row, filter));
            for (const row of matched) {
              Object.assign(row, payload);
            }
            return matched;
          },
        };
      },
    };
    return builder;
  }) as unknown as Knex & { fn: { now: () => string } };

  (knex as unknown as { fn: { now: () => string } }).fn = { now: () => 'db-now()' };

  return { knex, calls, rows };
}

function tenantARecord(): Row {
  return {
    id: 'pd-1',
    tenant: 'tenant-a',
    domain: 'portal.tenant-a.example',
    canonical_host: 'tenanta.portal.algapsa.com',
    status: 'active',
    status_message: 'all good',
    last_checked_at: new Date('2026-01-02T03:04:05Z'),
    verification_method: 'cname',
    verification_details: { expected_cname: 'tenanta.portal.algapsa.com' },
    certificate_secret_name: 'secret-a',
    last_synced_resource_version: '41',
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-02T00:00:00Z'),
  };
}

function tenantBRecord(): Row {
  return {
    ...tenantARecord(),
    id: 'pd-2',
    tenant: 'tenant-b',
    domain: 'portal.tenant-b.example',
  };
}

const ORIGINAL_NEXTAUTH_URL = process.env.NEXTAUTH_URL;

afterEach(() => {
  if (ORIGINAL_NEXTAUTH_URL === undefined) {
    delete process.env.NEXTAUTH_URL;
  } else {
    process.env.NEXTAUTH_URL = ORIGINAL_NEXTAUTH_URL;
  }
});

describe('normalizeHostname', () => {
  it('trims and lowercases hostnames', () => {
    expect(normalizeHostname('  Portal.Example.COM  ')).toBe('portal.example.com');
  });
});

describe('computeCanonicalHost', () => {
  it('prefixes the first seven characters of the tenant id under the NEXTAUTH_URL base domain', () => {
    process.env.NEXTAUTH_URL = 'https://app.example.com';
    expect(computeCanonicalHost('abcdef1-2345-6789')).toBe('abcdef1.portal.app.example.com');
  });

  it('falls back to algapsa.com when NEXTAUTH_URL is unset', () => {
    delete process.env.NEXTAUTH_URL;
    expect(computeCanonicalHost('abcdef1-2345-6789')).toBe('abcdef1.portal.algapsa.com');
  });

  it('falls back to algapsa.com when NEXTAUTH_URL is unparseable', () => {
    process.env.NEXTAUTH_URL = 'not a url at all';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(computeCanonicalHost('abcdef1-2345-6789')).toBe('abcdef1.portal.algapsa.com');
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('getTerminalStatuses', () => {
  it('returns a defensive copy of the terminal status list', () => {
    const first = getTerminalStatuses();
    first.push('pending_dns');

    const second = getTerminalStatuses();
    expect(second).toEqual(['active', 'disabled', 'dns_failed', 'certificate_failed']);
    expect(second.every((status) => PORTAL_DOMAIN_STATUSES.includes(status))).toBe(true);
  });
});

describe('getPortalDomain tenant scoping', () => {
  it('returns only the row belonging to the requested tenant, mapped to camelCase', async () => {
    const { knex, calls } = createFakeKnex([tenantARecord(), tenantBRecord()]);

    const result = await getPortalDomain(knex, 'tenant-a');

    expect(result).not.toBeNull();
    expect(result?.tenant).toBe('tenant-a');
    expect(result?.domain).toBe('portal.tenant-a.example');
    expect(result?.canonicalHost).toBe('tenanta.portal.algapsa.com');
    expect(result?.statusMessage).toBe('all good');
    expect(result?.certificateSecretName).toBe('secret-a');
    expect(calls.wheres).toEqual([{ table: 'portal_domains', filter: { tenant: 'tenant-a' } }]);
  });

  it('never returns another tenant record for an unknown tenant', async () => {
    const { knex } = createFakeKnex([tenantARecord(), tenantBRecord()]);

    await expect(getPortalDomain(knex, 'tenant-c')).resolves.toBeNull();
  });
});

describe('getPortalDomainByHostname', () => {
  it('normalizes the hostname before querying', async () => {
    const { knex, calls } = createFakeKnex([tenantARecord()]);

    const result = await getPortalDomainByHostname(knex, '  PORTAL.Tenant-A.Example ');

    expect(result?.tenant).toBe('tenant-a');
    expect(calls.wheres).toEqual([
      { table: 'portal_domains', filter: { domain: 'portal.tenant-a.example' } },
    ]);
  });
});

describe('upsertPortalDomain', () => {
  it('writes a tenant-scoped payload and resolves conflicts on the tenant column', async () => {
    delete process.env.NEXTAUTH_URL;
    const { knex, calls } = createFakeKnex([]);

    const result = await upsertPortalDomain(knex, 'tenant-a', {
      domain: '  Custom.Tenant-A.Example ',
    });

    expect(calls.inserts).toHaveLength(1);
    const payload = calls.inserts[0]!.payload;
    expect(payload.tenant).toBe('tenant-a');
    expect(payload.domain).toBe('custom.tenant-a.example');
    // First seven characters of the tenant id ("tenant-") become the prefix.
    expect(payload.canonical_host).toBe('tenant-.portal.algapsa.com');
    expect(payload.status).toBe('pending_dns');
    expect(payload.verification_method).toBe('cname');
    expect(calls.conflicts).toEqual([['tenant', 'surface']]);

    expect(result.tenant).toBe('tenant-a');
    expect(result.domain).toBe('custom.tenant-a.example');
    expect(result.status).toBe('pending_dns');
  });
});

describe('updatePortalDomain', () => {
  it('updates only rows matching the tenant filter', async () => {
    const rowA = tenantARecord();
    const rowB = tenantBRecord();
    const { knex, calls } = createFakeKnex([rowA, rowB]);

    const result = await updatePortalDomain(knex, 'tenant-a', { id: 'pd-1' }, {
      status: 'disabled',
      statusMessage: 'turned off',
      domain: ' NEW.Tenant-A.Example ',
    });

    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0]!.filter).toEqual({ tenant: 'tenant-a', id: 'pd-1' });
    expect(calls.updates[0]!.payload).toMatchObject({
      status: 'disabled',
      status_message: 'turned off',
      domain: 'new.tenant-a.example',
    });

    expect(result?.tenant).toBe('tenant-a');
    expect(result?.status).toBe('disabled');
    // Tenant B row remains untouched.
    expect(rowB.status).toBe('active');
    expect(rowB.domain).toBe('portal.tenant-b.example');
  });

  it('does not include unspecified fields in the update payload', async () => {
    const { knex, calls } = createFakeKnex([tenantARecord()]);

    await updatePortalDomain(knex, 'tenant-a', { id: 'pd-1' }, { status: 'verifying_dns' });

    const payload = calls.updates[0]!.payload;
    expect(Object.keys(payload).sort()).toEqual(['status', 'updated_at']);
  });

  it('returns null when no row exists for the tenant', async () => {
    const { knex } = createFakeKnex([tenantBRecord()]);

    await expect(updatePortalDomain(knex, 'tenant-a', { id: 'pd-1' }, { status: 'disabled' })).resolves.toBeNull();
  });

  // alga-2026-0002799: a tenant may own one row per surface; a write must hit exactly one.
  it('updates only the targeted row when the tenant owns several (by id and by surface)', async () => {
    const portalRow: Row = { ...tenantARecord(), id: 'pd-portal', surface: 'client_portal' };
    const mspRow: Row = { ...tenantARecord(), id: 'pd-msp', domain: 'helpdesk.tenant-a.example', surface: 'msp' };
    const { knex, calls } = createFakeKnex([portalRow, mspRow]);

    await updatePortalDomain(knex, 'tenant-a', { id: 'pd-msp' }, { status: 'disabled' });
    expect(mspRow.status).toBe('disabled');
    expect(portalRow.status).toBe('active');

    await updatePortalDomain(knex, 'tenant-a', { surface: 'client_portal' }, { statusMessage: 'portal only' });
    expect(portalRow.status_message).toBe('portal only');
    expect(mspRow.status_message).toBe('all good');
    expect(calls.updates.map((u) => u.filter)).toEqual([
      { tenant: 'tenant-a', id: 'pd-msp' },
      { tenant: 'tenant-a', surface: 'client_portal' },
    ]);
  });

  it('refuses a write that does not name a single row', async () => {
    const portalRow: Row = { ...tenantARecord(), id: 'pd-portal', surface: 'client_portal' };
    const mspRow: Row = { ...tenantARecord(), id: 'pd-msp', surface: 'msp' };
    const { knex, calls } = createFakeKnex([portalRow, mspRow]);

    await expect(updatePortalDomain(knex, 'tenant-a', {} as any, { status: 'disabled' })).rejects.toThrow(/single row/);
    await expect(updatePortalDomain(knex, 'tenant-a', { surface: 'bogus' } as any, { status: 'disabled' })).rejects.toThrow(/single row/);
    expect(calls.updates).toHaveLength(0);
    expect(portalRow.status).toBe('active');
    expect(mspRow.status).toBe('active');
  });

  it('cannot reach another tenant\'s row even by its id', async () => {
    const rowB = tenantBRecord();
    const { knex } = createFakeKnex([tenantARecord(), rowB]);

    await expect(updatePortalDomain(knex, 'tenant-a', { id: rowB.id as string }, { status: 'disabled' })).resolves.toBeNull();
    expect(rowB.status).toBe('active');
  });
});
