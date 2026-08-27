import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/db', () => ({ tenantDb: (conn: any) => ({ table: (name: string) => conn(name) }) }));
vi.mock('@alga-psa/core/secrets', () => ({ getSecretProviderInstance: vi.fn() }));

import { TenantSecretProvider } from '../tenantSecretProvider';

type Row = Record<string, any>;

function harness() {
  const state = { secrets: [] as Row[], audit: [] as Row[], sequence: 0 };
  const rollback = () => ({ secrets: structuredClone(state.secrets), audit: structuredClone(state.audit), sequence: state.sequence });
  const db: any = (table: string) => {
    const rows = table === 'tenant_secrets' ? state.secrets : state.audit;
    let where: Row = {};
    const filtered = () => rows.filter((row) => Object.entries(where).every(([key, value]) => row[key] === value));
    const query: any = {
      where(input: Row) { where = input; return query; },
      insert(input: Row) {
        if (table === 'tenant_secrets' && rows.some((row) => row.tenant === input.tenant && row.name === input.name)) {
          throw Object.assign(new Error('duplicate'), { code: '23505' });
        }
        const row = { id: `id-${++state.sequence}`, created_at: 'now', updated_at: 'now', ...input };
        rows.push(row);
        query.result = [row];
        return query;
      },
      update(input: Row) {
        query.result = filtered().map((row) => Object.assign(row, input));
        return query;
      },
      delete() {
        const matched = filtered();
        query.result = [...matched];
        for (const row of matched) rows.splice(rows.indexOf(row), 1);
        return query;
      },
      returning() { return Promise.resolve(query.result); },
    };
    return query;
  };
  db.transaction = async (fn: (trx: any) => Promise<any>) => {
    const before = rollback();
    try { return await fn(db); } catch (error) { state.secrets = before.secrets; state.audit = before.audit; state.sequence = before.sequence; throw error; }
  };
  return { db, state };
}

function providerStub(events: string[], options: { failSet?: boolean; failDelete?: boolean } = {}) {
  const values = new Map<string, string>();
  return {
    values,
    async setTenantSecret(_tenant: string, name: string, value: string) {
      events.push(`provider:set:${name}`);
      if (options.failSet) throw new Error('provider set failed');
      values.set(name, value);
    },
    async deleteTenantSecret(_tenant: string, name: string) {
      events.push(`provider:delete:${name}`);
      if (options.failDelete) throw new Error('provider delete failed');
      values.delete(name);
    },
  } as any;
}

describe('TenantSecretProvider mutation ordering', () => {
  it('creates metadata, writes provider, then audits in one transaction', async () => {
    const { db, state } = harness(); const events: string[] = [];
    const provider = providerStub(events);
    const service = new TenantSecretProvider(db, 'tenant-1', provider);
    await service.create({ name: 'API_KEY', value: 'new-value' }, 'user-1');
    expect(state.secrets).toHaveLength(1);
    expect(state.audit.map((row) => row.event_type)).toEqual(['created']);
    expect(provider.values.get('API_KEY')).toBe('new-value');
    expect(events).toEqual(['provider:set:API_KEY']);
  });

  it('rolls back create/update metadata and audit when provider write fails', async () => {
    const created = harness(); const createProvider = providerStub([], { failSet: true });
    await expect(new TenantSecretProvider(created.db, 'tenant-1', createProvider).create({ name: 'API_KEY', value: 'new' }, 'user-1')).rejects.toThrow('provider set failed');
    expect(created.state.secrets).toEqual([]); expect(created.state.audit).toEqual([]);

    const updated = harness(); const provider = providerStub([]);
    const service = new TenantSecretProvider(updated.db, 'tenant-1', provider);
    await service.create({ name: 'API_KEY', value: 'old' }, 'user-1');
    provider.values.set('API_KEY', 'old');
    const failing = new TenantSecretProvider(updated.db, 'tenant-1', providerStub([], { failSet: true }));
    await expect(failing.update('API_KEY', { value: 'new', description: 'changed' }, 'user-2')).rejects.toThrow('provider set failed');
    expect(updated.state.secrets[0].description).toBeNull();
    expect(provider.values.get('API_KEY')).toBe('old');
    expect(updated.state.audit).toHaveLength(1);
  });

  it('uses the database unique constraint for concurrent creates and never overwrites the winner', async () => {
    const { db, state } = harness(); const provider = providerStub([]);
    const service = new TenantSecretProvider(db, 'tenant-1', provider);
    const results = await Promise.allSettled([
      service.create({ name: 'RACE', value: 'winner' }, 'user-1'),
      service.create({ name: 'RACE', value: 'loser' }, 'user-2'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(state.secrets).toHaveLength(1);
    expect(provider.values.get('RACE')).toBe('winner');
  });

  it('commits delete before the provider call and reports a concurrent delete as not found', async () => {
    const { db, state } = harness(); const events: string[] = []; const provider = providerStub(events);
    const service = new TenantSecretProvider(db, 'tenant-1', provider);
    await service.create({ name: 'DELETE_ME', value: 'value' }, 'user-1');
    await service.delete('DELETE_ME', 'user-1');
    expect(state.secrets).toEqual([]); expect(state.audit.at(-1)?.event_type).toBe('deleted');
    expect(events.at(-1)).toBe('provider:delete:DELETE_ME');
    await expect(service.delete('DELETE_ME', 'user-1')).rejects.toThrow('not found');
  });
});
