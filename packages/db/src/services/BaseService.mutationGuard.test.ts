import { afterEach, describe, expect, it, vi } from 'vitest';
import { BaseService } from './BaseService';
import { registerWriteAdmissionResolver, resetWriteAdmissionCache, resetWriteAdmissionResolver } from '../lib/writeAdmission';

class Refusal extends Error {}

class Svc extends BaseService<any> {
  constructor(options: Partial<ConstructorParameters<typeof BaseService>[0]> = {}) {
    super({ tableName: 'tickets', ...options } as any);
  }
  guard(trx: any, tenant: string) {
    return (this as any).mutationGuard(trx, { tenant });
  }
}

afterEach(() => {
  resetWriteAdmissionResolver();
  resetWriteAdmissionCache();
});

describe('BaseService mutationGuard composition', () => {
  it('runs the default admission before the caller guard, and the caller guard cannot opt out', async () => {
    const order: string[] = [];
    const callerGuard = vi.fn(async () => { order.push('caller'); });
    registerWriteAdmissionResolver(async () => { order.push('admission'); return { canWrite: false, denial: new Refusal('ro') }; });
    // The lookup needs a db; a co-managed product row is what makes the resolver run.
    const { default: knexFactory } = await import('knex');
    const k = knexFactory({ client: 'pg' });
    (k.client as any).acquireConnection = async () => ({});
    (k.client as any).releaseConnection = async () => {};
    (k.client as any)._query = async (_c: unknown, obj: any) => {
      obj.response = { rows: [{ product_code: 'co_managed' }], rowCount: 1, command: 'SELECT' };
      return obj;
    };
    await expect(new Svc({ mutationGuard: callerGuard }).guard(k, 'cm')).rejects.toBeInstanceOf(Refusal);
    expect(callerGuard).not.toHaveBeenCalled();
    expect(order).toEqual(['admission']);
    await k.destroy();
  });

  it('still runs the caller guard when admission allows', async () => {
    const callerGuard = vi.fn(async () => undefined);
    await new Svc({ mutationGuard: callerGuard }).guard({} as any, 'psa');
    expect(callerGuard).toHaveBeenCalledOnce();
  });
});
