import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import knexFactory from 'knex';
import {
  registerWriteAdmissionResolver,
  resetWriteAdmissionCache,
  resetWriteAdmissionResolver,
} from '@alga-psa/db/writeAdmission';
import { activateAssetTagUniquenessForTenant } from './assetTagActivation';

const tenant = 'co-managed-tenant';
const events: string[] = [];
const knex = knexFactory({ client: 'pg' });

// Exercise the real Knex builders and tenantDb guard; only the database
// transport is replaced. An unresolved audit ends activation after adoption.
const client = knex.client as any;
client.acquireConnection = async () => ({
  query(query: { text: string }, callback: (error: null, result: unknown) => void) {
    const isWrite = /^(update|insert|delete)\b/i.test(query.text);
    if (isWrite) events.push('write');
    const rows = /from "tenants"/.test(query.text)
      ? [{ tenant, product_code: 'co_managed' }]
      : /from "asset_tag_audit"/.test(query.text) ? [{ count: '1' }] : [];
    callback(null, { rows, rowCount: rows.length, command: isWrite ? 'UPDATE' : 'SELECT' });
  },
});
client.releaseConnection = async () => {};

beforeEach(() => {
  events.length = 0;
  resetWriteAdmissionCache();
});
afterEach(() => {
  resetWriteAdmissionResolver();
  resetWriteAdmissionCache();
});
afterAll(() => knex.destroy());

describe('asset tag activation write admission', () => {
  it('refuses a read-only workspace before adopting any unmanaged assets', async () => {
    const denial = new Error('Workspace is read only');
    const resolver = vi.fn(async () => {
      events.push('admission');
      return { canWrite: false, denial };
    });
    registerWriteAdmissionResolver(resolver);

    await expect(knex.transaction((trx) => activateAssetTagUniquenessForTenant(trx, tenant, 'actor')))
      .rejects.toBe(denial);
    expect(resolver).toHaveBeenCalledWith(expect.any(Function), tenant);
    expect(events).toEqual(['admission']);
  });

  it('admits adoption before writing and still refuses unresolved duplicate audits', async () => {
    registerWriteAdmissionResolver(async () => {
      events.push('admission');
      return { canWrite: true };
    });

    await expect(knex.transaction((trx) => activateAssetTagUniquenessForTenant(trx, tenant, 'actor')))
      .resolves.toEqual({ success: false, error: 'Review and reconcile every duplicate tag before activation' });
    expect(events).toEqual(['admission', 'write']);
  });
});
