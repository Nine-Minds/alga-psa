import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ knex: vi.fn(), secret: vi.fn() }));
vi.mock('knex', () => ({ default: mocks.knex }));
vi.mock('./knexfile', () => ({ default: { development: { client: 'pg', connection: { host: 'base', port: 5432 } } } }));
vi.mock('@alga-psa/core/logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@alga-psa/core/secrets', () => ({ getSecret: mocks.secret }));
const deferred = () => { let resolve!: (value?: any) => void; let reject!: (reason?: any) => void;
  const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const pool = () => ({ raw: vi.fn().mockResolvedValue({ rows: [{ ro: false, tro: 'off' }] }), destroy: vi.fn().mockResolvedValue(undefined) });
let api: typeof import('./admin');
beforeEach(async () => { vi.resetModules(); vi.clearAllMocks(); mocks.secret.mockResolvedValue('synthetic-password');
  vi.stubEnv('NODE_ENV', 'development'); api = await import('./admin'); });
afterEach(() => vi.unstubAllEnvs());
describe('admin pool lifecycle', () => {
  it('shares concurrent cold initialization and publishes only after SELECT 1', async () => {
    const secret = deferred(), probe = deferred(), first = pool();
    mocks.secret.mockReturnValue(secret.promise); first.raw.mockReturnValue(probe.promise); mocks.knex.mockImplementation(() => first);
    const calls = [api.getAdminConnection(), api.getAdminConnection(), api.getAdminConnection()];
    secret.resolve('synthetic-password'); await vi.waitFor(() => expect(mocks.knex).toHaveBeenCalled());
    expect(mocks.knex).toHaveBeenCalledTimes(1);
    let resolved = false; void calls[0].then(() => { resolved = true; }); await Promise.resolve(); expect(resolved).toBe(false);
    probe.resolve({ rows: [] }); expect(await Promise.all(calls)).toEqual([first, first, first]);
  });
  it('destroys failed initialization and lets the next call retry', async () => {
    const bad = pool(), good = pool(); bad.raw.mockRejectedValue(new Error('initialization failed'));
    mocks.knex.mockReturnValueOnce(bad).mockReturnValue(good);
    await expect(api.getAdminConnection()).rejects.toThrow('initialization failed');
    expect(bad.destroy).toHaveBeenCalledTimes(1);
    expect(await api.getAdminConnection()).toBe(good);
  });
  it('singleflights replacement when a cached pool loses write capability', async () => {
    const old = pool(), replacement = pool(), probe = deferred(); mocks.knex.mockReturnValueOnce(old).mockReturnValue(replacement);
    await api.getAdminConnection(); old.raw.mockReturnValue(probe.promise);
    const calls = [api.getAdminConnection(), api.getAdminConnection(), api.getAdminConnection()];
    await vi.waitFor(() => expect(old.raw).toHaveBeenCalledTimes(2));
    probe.resolve({ rows: [{ ro: false, tro: 'on' }] });
    expect(await Promise.all(calls)).toEqual([replacement, replacement, replacement]);
    expect(old.destroy).toHaveBeenCalledTimes(1); expect(mocks.knex).toHaveBeenCalledTimes(2);
  });
  it('cleanup waits for initialization and never leaves a late published pool', async () => {
    const first = pool(), next = pool(), secret = deferred(); mocks.secret.mockReturnValueOnce(secret.promise);
    mocks.knex.mockReturnValueOnce(first).mockReturnValue(next);
    const pending = api.getAdminConnection(), cleanup = api.destroyAdminConnection();
    secret.resolve('synthetic-password'); await pending; await cleanup;
    expect(first.destroy).toHaveBeenCalledTimes(1); expect(await api.getAdminConnection()).toBe(next);
  });
  it('refresh waits for cached probe and shares concurrent replacement requests', async () => {
    const first = pool(), next = pool(), probe = deferred(); mocks.knex.mockReturnValueOnce(first).mockReturnValue(next);
    await api.getAdminConnection(); first.raw.mockReturnValue(probe.promise);
    const reading = api.getAdminConnection(); const refreshes = [api.refreshAdminConnection(), api.refreshAdminConnection()];
    probe.resolve({ rows: [{ ro: false, tro: 'off' }] }); await reading;
    expect(await Promise.all(refreshes)).toEqual([next, next]);
    expect(first.destroy).toHaveBeenCalledTimes(1); expect(next.destroy).not.toHaveBeenCalled();
  });
  it('failed destroy clears the reference so cleanup and refresh can recover', async () => {
    const first = pool(), next = pool(); mocks.knex.mockReturnValueOnce(first).mockReturnValue(next);
    await api.getAdminConnection(); first.destroy.mockRejectedValue(new Error('destroy failed'));
    await expect(api.destroyAdminConnection()).rejects.toThrow('destroy failed');
    expect(await api.getAdminConnection()).toBe(next); expect(first.destroy).toHaveBeenCalledTimes(1);
  });
  it('uses direct admin settings and preserves writable cached pool', async () => {
    const first = pool(); mocks.knex.mockReturnValue(first);
    vi.stubEnv('DB_HOST_ADMIN', 'direct-primary'); vi.stubEnv('DB_HOST', 'pooled'); vi.stubEnv('DB_PORT_ADMIN', '5434');
    vi.stubEnv('DB_USER_ADMIN', 'admin-user'); vi.stubEnv('DB_NAME_SERVER', 'test-database');
    expect(await api.getAdminConnection()).toBe(first); expect(await api.getAdminConnection()).toBe(first);
    expect(mocks.knex).toHaveBeenCalledTimes(1); expect(first.destroy).not.toHaveBeenCalled();
    expect(mocks.knex.mock.calls[0][0].connection).toEqual({ host: 'direct-primary', port: 5434, user: 'admin-user',
      database: 'test-database', password: 'synthetic-password' });
    expect(first.raw).toHaveBeenLastCalledWith("SELECT pg_is_in_recovery() AS ro, current_setting('transaction_read_only') AS tro");
  });
  it.each(['standby', 'probe error'])('replaces a cached pool after %s', async reason => {
    const first = pool(), next = pool(); mocks.knex.mockReturnValueOnce(first).mockReturnValue(next);
    await api.getAdminConnection();
    if (reason === 'standby') first.raw.mockResolvedValue({ rows: [{ ro: true, tro: 'off' }] });
    else first.raw.mockRejectedValue(new Error('probe unavailable'));
    expect(await api.getAdminConnection()).toBe(next); expect(first.destroy).toHaveBeenCalledTimes(1);
  });
  it('retains the one-retry limit for actual read-only operations', async () => {
    const first = pool(), next = pool(); mocks.knex.mockReturnValueOnce(first).mockReturnValue(next);
    await api.getAdminConnection();
    const operation = vi.fn().mockRejectedValue(new Error('cannot execute UPDATE in a read-only transaction'));
    await expect(api.retryOnAdminReadOnly(operation)).rejects.toThrow('read-only transaction');
    expect(operation).toHaveBeenCalledTimes(2); expect(mocks.knex).toHaveBeenCalledTimes(2);
    expect(first.destroy).toHaveBeenCalledTimes(1); expect(next.destroy).not.toHaveBeenCalled();
  });

});
