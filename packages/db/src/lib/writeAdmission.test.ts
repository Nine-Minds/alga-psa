import { afterEach, describe, expect, it, vi } from 'vitest';
import { admitWrite, registerWriteAdmissionProvider, resetWriteAdmissionProvider } from './writeAdmission';

afterEach(() => resetWriteAdmissionProvider());

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
