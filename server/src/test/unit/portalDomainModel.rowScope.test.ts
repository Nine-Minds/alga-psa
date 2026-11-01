/**
 * alga-2026-0002799: a tenant may own one portal_domains row per surface, so every write
 * must be tenant-scoped AND row-scoped. updatePortalDomain / deletePortalDomain used to
 * filter by tenant only and would have touched every row the tenant owns.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: vi.fn(async () => {
    throw new Error('not used in this test');
  }),
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any, tenant: string) => ({
    table: (t: string) => conn(t).where({ tenant }),
    unscoped: (t: string) => conn(t),
  }),
}));

import { deletePortalDomain, getPortalDomain, updatePortalDomain } from 'server/src/models/PortalDomainModel';

type Row = Record<string, unknown>;

function createFakeKnex(rows: Row[]) {
  const writes: Array<{ op: 'update' | 'delete'; filter: Row }> = [];
  const matches = (row: Row, filter: Row) => Object.entries(filter).every(([k, v]) => row[k] === v);
  const knex = ((_table: string) => {
    let filter: Row = {};
    const builder: any = {
      where(condition: Row) {
        filter = { ...filter, ...condition };
        return builder;
      },
      orderBy() {
        return builder;
      },
      async first() {
        return rows.find((row) => matches(row, filter));
      },
      update(payload: Row) {
        writes.push({ op: 'update', filter });
        return {
          async returning() {
            const matched = rows.filter((row) => matches(row, filter));
            matched.forEach((row) => Object.assign(row, payload));
            return matched;
          },
        };
      },
      async delete() {
        writes.push({ op: 'delete', filter });
        const matched = rows.filter((row) => matches(row, filter));
        matched.forEach((row) => rows.splice(rows.indexOf(row), 1));
        return matched.length;
      },
    };
    return builder;
  }) as unknown as Knex;
  (knex as any).fn = { now: () => 'now()' };
  return { knex, writes };
}

function row(overrides: Row): Row {
  return {
    id: 'pd-portal',
    tenant: 'tenant-a',
    domain: 'portal.tenant-a.example',
    canonical_host: 'tenanta.portal.algapsa.com',
    surface: 'client_portal',
    status: 'active',
    status_message: null,
    last_checked_at: null,
    verification_method: 'cname',
    verification_details: {},
    certificate_secret_name: null,
    last_synced_resource_version: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('server PortalDomainModel row scoping', () => {
  it('updatePortalDomain touches only the targeted row of a multi-row tenant', async () => {
    const portal = row({});
    const msp = row({ id: 'pd-msp', domain: 'helpdesk.tenant-a.example', surface: 'msp' });
    const other = row({ id: 'pd-b', tenant: 'tenant-b', domain: 'portal.tenant-b.example' });
    const { knex, writes } = createFakeKnex([portal, msp, other]);

    const updated = await updatePortalDomain(knex, 'tenant-a', { id: 'pd-msp' }, { status: 'disabled' });

    expect(updated?.id).toBe('pd-msp');
    expect(msp.status).toBe('disabled');
    expect(portal.status).toBe('active');
    expect(other.status).toBe('active');
    expect(writes).toEqual([{ op: 'update', filter: { tenant: 'tenant-a', id: 'pd-msp' } }]);
  });

  it('deletePortalDomain deletes only the targeted row (by surface)', async () => {
    const portal = row({});
    const msp = row({ id: 'pd-msp', domain: 'helpdesk.tenant-a.example', surface: 'msp' });
    const rows = [portal, msp];
    const { knex, writes } = createFakeKnex(rows);

    await deletePortalDomain(knex, 'tenant-a', { surface: 'msp' });

    expect(rows.map((r) => r.id)).toEqual(['pd-portal']);
    expect(writes).toEqual([{ op: 'delete', filter: { tenant: 'tenant-a', surface: 'msp' } }]);
  });

  it('never deletes another tenant\'s row, even when given its id', async () => {
    const other = row({ id: 'pd-b', tenant: 'tenant-b' });
    const rows = [row({}), other];
    const { knex } = createFakeKnex(rows);

    await deletePortalDomain(knex, 'tenant-a', { id: 'pd-b' });

    expect(rows).toContain(other);
  });

  it('refuses tenant-wide writes: a target naming one row is required', async () => {
    const rows = [row({}), row({ id: 'pd-msp', surface: 'msp' })];
    const { knex, writes } = createFakeKnex(rows);

    await expect(deletePortalDomain(knex, 'tenant-a', {} as any)).rejects.toThrow(/single row/);
    await expect(updatePortalDomain(knex, 'tenant-a', undefined as any, { status: 'disabled' })).rejects.toThrow(/single row/);
    expect(writes).toHaveLength(0);
    expect(rows).toHaveLength(2);
  });

  it('getPortalDomain reads a named surface row', async () => {
    const { knex } = createFakeKnex([row({}), row({ id: 'pd-msp', surface: 'msp' })]);
    expect((await getPortalDomain(knex, 'tenant-a', 'msp'))?.id).toBe('pd-msp');
  });
});
