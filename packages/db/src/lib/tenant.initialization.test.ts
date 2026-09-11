import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ config: vi.fn(), create: vi.fn() }));
vi.mock('./knexfile', () => ({ getKnexConfig: state.config }));
vi.mock('./knex-turbopack', () => ({ default: state.create }));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), error: vi.fn() } }));
import { getConnection, destroyTenantConnection, resetTenantConnectionPool } from './tenant';

const config = { client: 'pg', connection: { host: 'localhost', port: 5432, database: 'test', user: 'test' }, pool: {} };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setupFactory() {
  const pools: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];
  state.create.mockImplementation(() => {
    const pool = { destroy: vi.fn(async () => {}) };
    pools.push(pool);
    return pool;
  });
  return pools;
}
afterEach(async () => { await resetTenantConnectionPool(); vi.resetAllMocks(); });

it('shares one pool across concurrent cold requests waiting for configuration', async () => {
  const gate = deferred<typeof config>();
  state.config.mockReturnValue(gate.promise);
  const pools = setupFactory();
  const pending = Array.from({ length: 20 }, (_, index) => getConnection(`tenant-${index}`));
  gate.resolve(config);
  const connections = await Promise.all(pending);
  expect(state.config).toHaveBeenCalledTimes(1);
  expect(pools).toHaveLength(1);
  expect(connections.every(connection => connection === connections[0])).toBe(true);
  await destroyTenantConnection();
  expect(pools[0].destroy).toHaveBeenCalledOnce();
});

it('shares initialization failure but permits a later successful retry', async () => {
  const gate = deferred<typeof config>();
  state.config.mockReturnValueOnce(gate.promise).mockResolvedValue(config);
  const pools = setupFactory();
  const failed = Promise.allSettled([getConnection(), getConnection()]);
  gate.reject(new Error('Synthetic configuration failure'));
  expect(await failed).toEqual([
    expect.objectContaining({ status: 'rejected' }), expect.objectContaining({ status: 'rejected' }),
  ]);
  expect(pools).toHaveLength(0);
  await getConnection();
  expect(pools).toHaveLength(1);
});

it('reset waits for an initializing pool and destroys it before another cold request', async () => {
  const gate = deferred<typeof config>();
  state.config.mockReturnValueOnce(gate.promise).mockResolvedValue(config);
  const pools = setupFactory();
  const first = getConnection();
  const resetting = resetTenantConnectionPool();
  const next = getConnection();
  gate.resolve(config);
  const [oldPool, , newPool] = await Promise.all([first, resetting, next]);
  expect(pools).toHaveLength(2);
  expect(oldPool).not.toBe(newPool);
  expect(pools[0].destroy).toHaveBeenCalledOnce();
  expect(pools[1].destroy).not.toHaveBeenCalled();
});

it('shares concurrent teardown and holds new requests until the old pool is closed', async () => {
  state.config.mockResolvedValue(config);
  const pools = setupFactory();
  await getConnection();
  const closed = deferred<void>();
  pools[0].destroy.mockImplementation(() => closed.promise);
  const destroying = destroyTenantConnection();
  const resetting = resetTenantConnectionPool();
  const next = getConnection();
  await vi.waitFor(() => expect(pools[0].destroy).toHaveBeenCalledOnce());
  expect(pools).toHaveLength(1);
  closed.resolve();
  await Promise.all([destroying, resetting]);
  expect(await next).toBe(pools[1]);
  expect(pools).toHaveLength(2);
  expect(pools[0].destroy).toHaveBeenCalledOnce();
});

it('reports teardown failure and permits a fresh pool on a later request', async () => {
  state.config.mockResolvedValue(config);
  const pools = setupFactory();
  await getConnection();
  const failure = new Error('Synthetic pool teardown failure');
  pools[0].destroy.mockRejectedValue(failure);
  await expect(resetTenantConnectionPool()).rejects.toBe(failure);
  expect(await getConnection()).toBe(pools[1]);
  expect(pools).toHaveLength(2);
});
