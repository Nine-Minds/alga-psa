import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ secret: vi.fn(), create: vi.fn() }));
vi.mock('knex', () => ({ default: mocks.create }));
vi.mock('@alga-psa/core/secrets', () => ({ getSecretProviderInstance: async () => ({ getAppSecret: mocks.secret }) }));
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetModules(); mocks.secret.mockReset(); mocks.create.mockReset();
  mocks.secret.mockResolvedValue('synthetic-password');
  mocks.create.mockImplementation(() => ({ destroy: vi.fn().mockResolvedValue(undefined) }));
});
describe('default connection initialization lifecycle', () => {
  it('failed cleanup rejects waiting callers and never reuses the detached pool', async () => {
    const destruction = deferred<void>();
    const oldPool = { destroy: vi.fn(() => destruction.promise) };
    mocks.create.mockReturnValueOnce(oldPool);
    const { getConnection, cleanupConnections } = await import('./connection');
    expect(await getConnection()).toBe(oldPool);
    const cleanup = cleanupConnections();
    const waiting = getConnection();
    const settled = Promise.allSettled([cleanup, waiting]);
    await vi.waitFor(() => expect(oldPool.destroy).toHaveBeenCalledTimes(1));
    const failure = new Error('Synthetic teardown failure');
    destruction.reject(failure);
    expect(await settled).toEqual([
      { status: 'rejected', reason: failure }, { status: 'rejected', reason: failure },
    ]);
    const fresh = await getConnection();
    expect(fresh).not.toBe(oldPool);
    expect(mocks.create).toHaveBeenCalledTimes(2);
    await cleanupConnections();
    expect(oldPool.destroy).toHaveBeenCalledTimes(1);
    expect(fresh.destroy).toHaveBeenCalledTimes(1);
  });
  it('shares one cold initialization while secret lookup is pending', async () => {
    const secret = deferred<string>(); mocks.secret.mockReturnValue(secret.promise);
    const { getConnection, cleanupConnections } = await import('./connection');
    const calls = Array.from({ length: 8 }, () => getConnection());
    await vi.waitFor(() => expect(mocks.secret).toHaveBeenCalled());
    secret.resolve('synthetic-password');
    const pools = await Promise.all(calls);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(pools.every(pool => pool === pools[0])).toBe(true);
    await cleanupConnections();
    expect(pools[0].destroy).toHaveBeenCalledTimes(1);
  });
  it('cleanup waits for initialization and blocks new callers until the old pool is destroyed', async () => {
    const secret = deferred<string>(), destruction = deferred<void>();
    mocks.secret.mockReturnValueOnce(secret.promise);
    const oldPool = { destroy: vi.fn(() => destruction.promise) };
    mocks.create.mockReturnValueOnce(oldPool);
    const { getConnection, cleanupConnections } = await import('./connection');
    const initial = getConnection();
    await vi.waitFor(() => expect(mocks.secret).toHaveBeenCalledTimes(1));
    let cleaned = false;
    const cleanup = cleanupConnections().then(() => { cleaned = true; });
    const secondCleanup = cleanupConnections();
    const next = getConnection();
    secret.resolve('synthetic-password');
    expect(await initial).toBe(oldPool);
    await vi.waitFor(() => expect(oldPool.destroy).toHaveBeenCalledTimes(1));
    expect(cleaned).toBe(false);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    destruction.resolve();
    await Promise.all([cleanup, secondCleanup]);
    const fresh = await next;
    expect(fresh).not.toBe(oldPool);
    expect(mocks.create).toHaveBeenCalledTimes(2);
    await cleanupConnections();
    expect(fresh.destroy).toHaveBeenCalledTimes(1);
  });
  it('retries a failed cold initialization without requiring cleanup', async () => {
    mocks.secret.mockRejectedValueOnce(new Error('Synthetic secret failure'));
    const { getConnection, cleanupConnections } = await import('./connection');
    await expect(getConnection()).rejects.toThrow('Synthetic secret failure');
    const pool = await getConnection();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    await cleanupConnections();
    const fresh = await getConnection();
    expect(fresh).not.toBe(pool);
    expect(mocks.create).toHaveBeenCalledTimes(2);
    await cleanupConnections();
  });
  it('failed initialization rejects every waiter and permits retry after cleanup', async () => {
    const secret = deferred<string>(); mocks.secret.mockReturnValueOnce(secret.promise);
    const { getConnection, cleanupConnections } = await import('./connection');
    const results = Promise.allSettled([getConnection(), getConnection()]);
    await vi.waitFor(() => expect(mocks.secret).toHaveBeenCalledTimes(1));
    const cleanup = cleanupConnections();
    secret.reject(new Error('Synthetic secret failure'));
    expect((await results).map(result => result.status)).toEqual(['rejected', 'rejected']);
    await cleanup;
    expect(mocks.create).not.toHaveBeenCalled();
    const pool = await getConnection();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    await cleanupConnections();
    expect(pool.destroy).toHaveBeenCalledTimes(1);
  });
});
