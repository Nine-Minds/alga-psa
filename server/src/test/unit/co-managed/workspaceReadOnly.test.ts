import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import knexFactory from 'knex';

// A6 / hot path: the read-only probe must cost nothing for a psa tenant once L0c holds it in the negative set,
// and must never turn a missing resolver or a missing schema into a locked-out workspace.
const session = vi.hoisted(() => ({ tenant: 'psa-tenant' as string | null }));
const harness = vi.hoisted(() => ({ knex: null as any }));
vi.mock('@alga-psa/auth', () => ({ getSession: async () => (session.tenant ? { user: { tenant: session.tenant } } : null) }));
vi.mock('@alga-psa/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@alga-psa/db')>()), createTenantKnex: async () => ({ knex: harness.knex }) }));

import { invalidateWriteAdmission } from '@alga-psa/db/writeAdmission';
import { registerWriteAdmissionResolver, resetWriteAdmissionResolver } from '@alga-psa/db';
import { getWorkspaceReadOnly } from '@/lib/co-managed/workspaceReadOnly';

const CO = '00000000-0000-4000-8000-0000000000c0';
const PSA = '00000000-0000-4000-8000-0000000000a0';
let queries: string[];

/** A real knex query builder over a fake pg client: every statement is counted, none reaches a database. */
function fakeKnex(answer: (sql: string) => { rows: any[] } | Error) {
  const knex = knexFactory({ client: 'pg' });
  const client: any = knex.client;
  client.acquireConnection = async () => ({});
  client.releaseConnection = async () => undefined;
  // Shape the result the way the pg dialect would for the builder's method.
  client.processResponse = (obj: any) => (obj.method === 'first' ? obj.response.rows[0] : obj.response.rows);
  client._query = async (_connection: unknown, obj: any) => {
    queries.push(obj.sql);
    const result = answer(obj.sql);
    if (result instanceof Error) throw result;
    obj.response = { rows: result.rows, rowCount: result.rows.length };
    return obj;
  };
  return knex;
}

beforeEach(() => {
  queries = [];
  invalidateWriteAdmission();
  registerWriteAdmissionResolver((async () => ({ allowed: true })) as any);
  session.tenant = PSA;
  harness.knex = fakeKnex(() => ({ rows: [{ product_code: 'psa' }] }));
});
afterEach(() => { resetWriteAdmissionResolver(); invalidateWriteAdmission(); });

describe('getWorkspaceReadOnly cost and neutrality', () => {
  it('a psa tenant costs one product lookup the first time and ZERO queries once the negative set holds it', async () => {
    expect(await getWorkspaceReadOnly()).toBe(false);
    expect(queries).toHaveLength(1);
    queries.length = 0;
    for (let i = 0; i < 5; i++) expect(await getWorkspaceReadOnly()).toBe(false);
    expect(queries).toEqual([]);
  });

  it('returns false with zero queries when no L0c resolver is registered (flag off / capability absent)', async () => {
    resetWriteAdmissionResolver();
    expect(await getWorkspaceReadOnly()).toBe(false);
    expect(queries).toEqual([]);
  });

  it('returns false with zero queries when there is no session tenant', async () => {
    session.tenant = null;
    expect(await getWorkspaceReadOnly()).toBe(false);
    expect(queries).toEqual([]);
  });

  it('fails open when the co-managed schema is absent: the probe answers false rather than locking the workspace', async () => {
    session.tenant = CO;
    harness.knex = fakeKnex((sql) => /from "tenants"/.test(sql) ? { rows: [{ product_code: 'co_managed' }] }
      : Object.assign(new Error('relation "co_management_relationships" does not exist'), { code: '42P01' }));
    expect(await getWorkspaceReadOnly()).toBe(false);
  });

  it('a co_managed workspace with no live relationship is read-only (the probe does reach the lifecycle reader)', async () => {
    session.tenant = CO;
    harness.knex = fakeKnex((sql) => /from "tenants"/.test(sql) ? { rows: [{ product_code: 'co_managed' }] } : { rows: [] });
    expect(await getWorkspaceReadOnly()).toBe(true);
  });
});
