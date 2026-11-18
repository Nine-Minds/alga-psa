import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  admitWrite,
  registerWriteAdmissionProvider,
  registerWriteAdmissionResolver,
  resetWriteAdmissionCache,
  resetWriteAdmissionProvider,
  resetWriteAdmissionResolver,
} from './writeAdmission';

afterEach(() => {
  resetWriteAdmissionProvider();
  resetWriteAdmissionResolver();
  resetWriteAdmissionCache();
});

describe('writeAdmission', () => {
  it('with no provider resolves without touching trx', async () => {
    const trx = new Proxy({}, { get() { throw new Error('trx touched'); } }) as any;
    await expect(admitWrite(trx, { tenant: 't', operation: 'op' })).resolves.toBeUndefined();
  });

  it('calls the provider once with the trx and context', async () => {
    const provider = vi.fn(async () => {});
    registerWriteAdmissionProvider(provider);
    const trx = { isTransaction: true } as any;
    await admitWrite(trx, { tenant: 't', operation: 'op' });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(provider).toHaveBeenCalledWith(trx, { tenant: 't', operation: 'op' });
  });

  it('requires a transaction once a provider is registered', async () => {
    registerWriteAdmissionProvider(async () => {});
    await expect(admitWrite({} as any, { tenant: 't', operation: 'op' })).rejects.toThrow();
  });

  it('reset restores the no-op', async () => {
    const provider = vi.fn(async () => {});
    registerWriteAdmissionProvider(provider);
    resetWriteAdmissionProvider();
    await admitWrite({} as any, { tenant: 't', operation: 'op' });
    expect(provider).not.toHaveBeenCalled();
  });
});

describe('writeAdmission: resolver backs admitWrite (one decision source)', () => {
  const coManagedTrx = () => {
    const query: any = { where: () => query, first: async () => ({ product_code: 'co_managed' }) };
    const trx: any = (_table: string) => query;
    trx.isTransaction = true;
    return trx;
  };

  it('a refusing resolver refuses admitWrite and the provider is not reached', async () => {
    const provider = vi.fn(async () => {});
    registerWriteAdmissionProvider(provider);
    registerWriteAdmissionResolver(async () => ({ canWrite: false, denial: new Error('refused') }));
    await expect(admitWrite(coManagedTrx(), { tenant: 't', operation: 'op' })).rejects.toThrow('refused');
    expect(provider).not.toHaveBeenCalled();
  });

  it('an admitting resolver still lets the exact provider decide', async () => {
    const provider = vi.fn(async () => { throw new Error('provider says no'); });
    registerWriteAdmissionProvider(provider);
    registerWriteAdmissionResolver(async () => ({ canWrite: true }));
    await expect(admitWrite(coManagedTrx(), { tenant: 't', operation: 'op' })).rejects.toThrow('provider says no');
  });

  it('with only a resolver, a transaction is still required', async () => {
    registerWriteAdmissionResolver(async () => ({ canWrite: true }));
    await expect(admitWrite({} as any, { tenant: 't', operation: 'op' })).rejects.toThrow();
  });
});
