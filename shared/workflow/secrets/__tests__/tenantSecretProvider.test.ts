import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/db', () => ({ tenantDb: (conn: any) => ({ table: (name: string) => conn(name) }) }));
vi.mock('@alga-psa/core/secrets', () => ({ getSecretProviderInstance: vi.fn() }));

import { TenantSecretProvider } from '../tenantSecretProvider';

type Row = Record<string, any>;

function harness(failures: { insert?: boolean; update?: boolean; delete?: boolean } = {}) {
  const state = { secrets: [] as Row[], audit: [] as Row[], sequence: 0, events: [] as string[] };
  const rollback = () => ({ secrets: structuredClone(state.secrets), audit: structuredClone(state.audit), sequence: state.sequence });
  const db: any = (table: string) => {
    const rows = table === 'tenant_secrets' ? state.secrets : state.audit;
    let where: Row = {};
    const filtered = () => rows.filter((row) => Object.entries(where).every(([key, value]) => row[key] === value));
    const query: any = {
      where(input: Row) { where = input; return query; },
      insert(input: Row) {
        state.events.push(`db:insert:${table}`);
        if (failures.insert && table === 'tenant_secrets') throw new Error('insert failed');
        if (table === 'tenant_secrets' && rows.some((row) => row.tenant === input.tenant && row.name === input.name)) {
          throw Object.assign(new Error('duplicate'), { code: '23505' });
        }
        const row = { id: `id-${++state.sequence}`, created_at: 'now', updated_at: 'now', ...input };
        rows.push(row);
        query.result = [row];
        return query;
      },
      update(input: Row) {
        state.events.push(`db:update:${table}`);
        if (failures.update) throw new Error('update failed');
        query.result = filtered().map((row) => Object.assign(row, input));
        return query;
      },
      delete() {
        state.events.push(`db:delete:${table}`);
        if (failures.delete) throw new Error('delete failed');
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
    state.events.push('tx:begin');
    try { const result = await fn(db); state.events.push('tx:commit'); return result; } catch (error) { state.secrets = before.secrets; state.audit = before.audit; state.sequence = before.sequence; state.events.push('tx:rollback'); throw error; }
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
    const { db, state } = harness(); const events = state.events;
    const provider = providerStub(events);
    const service = new TenantSecretProvider(db, 'tenant-1', provider);
    await service.create({ name: 'API_KEY', value: 'new-value' }, 'user-1');
    expect(state.secrets).toHaveLength(1);
    expect(state.audit.map((row) => row.event_type)).toEqual(['created']);
    expect(provider.values.get('API_KEY')).toBe('new-value');
    expect(state.events).toEqual(['tx:begin', 'db:insert:tenant_secrets', 'provider:set:API_KEY', 'db:insert:tenant_secrets_audit_log', 'tx:commit']);
  });

  it('rolls back create/update metadata and audit when provider write fails', async () => {
    const created = harness(); const createProvider = providerStub([], { failSet: true });
    await expect(new TenantSecretProvider(created.db, 'tenant-1', createProvider).create({ name: 'API_KEY', value: 'new' }, 'user-1')).rejects.toThrow('provider set failed');
    expect(created.state.secrets).toEqual([]); expect(created.state.audit).toEqual([]);

    const updated = harness(); const provider = providerStub(updated.state.events);
    const service = new TenantSecretProvider(updated.db, 'tenant-1', provider);
    await service.create({ name: 'API_KEY', value: 'old' }, 'user-1');
    provider.values.set('API_KEY', 'old');
    provider.values.set('API_KEY', 'old');
    const originalSet = provider.setTenantSecret.bind(provider);
    provider.setTenantSecret = async (_tenant: string, name: string, value: string) => { if (value === 'new') throw new Error('provider set failed'); return originalSet(_tenant, name, value); };
    const failing = new TenantSecretProvider(updated.db, 'tenant-1', provider);
    await expect(failing.update('API_KEY', { value: 'new', description: 'changed' }, 'user-2')).rejects.toThrow('provider set failed');
    expect(updated.state.secrets[0].description).toBeNull();
    expect(provider.values.get('API_KEY')).toBe('old');
    expect(updated.state.audit).toHaveLength(1);
  });

  it('does not call the provider when database insert, update, or delete fails', async () => {
    for (const [failure, method] of [['insert', 'create'], ['update', 'update'], ['delete', 'delete']] as const) {
      const { db, state } = harness({ [failure]: true }); const provider = providerStub(state.events);
      const service = new TenantSecretProvider(db, 'tenant-1', provider);
      if (method !== 'create') state.secrets.push({ id: 'existing', tenant: 'tenant-1', name: 'X', description: null, created_by: 'u', updated_by: 'u', created_at: 'now', updated_at: 'now' });
      const call = method === 'create' ? service.create({ name: 'X', value: 'new' }, 'u') : method === 'update' ? service.update('X', { value: 'new' }, 'u') : service.delete('X', 'u');
      await expect(call).rejects.toThrow(); expect(state.events.some((event) => event.startsWith('provider:'))).toBe(false);
    }
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
    const { db, state } = harness(); const events = state.events; const provider = providerStub(events);
    const service = new TenantSecretProvider(db, 'tenant-1', provider);
    await service.create({ name: 'DELETE_ME', value: 'value' }, 'user-1');
    await service.delete('DELETE_ME', 'user-1');
    expect(state.secrets).toEqual([]); expect(state.audit.at(-1)?.event_type).toBe('deleted');
    expect(events.at(-1)).toBe('provider:delete:DELETE_ME');
    expect(events.indexOf('tx:commit')).toBeLessThan(events.indexOf('provider:delete:DELETE_ME'));
    await expect(service.delete('DELETE_ME', 'user-1')).rejects.toThrow('not found');
  });
});
