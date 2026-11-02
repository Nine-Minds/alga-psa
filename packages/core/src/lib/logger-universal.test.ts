import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The server branch of the universal logger loads winston lazily. Log calls are
// fire-and-forget, so whatever happens to that load must never leave a rejected
// promise behind (an unhandled rejection kills a worker, and vitest reports it
// as an error when the import races test-environment teardown).

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);

async function loadUniversal() {
  return (await import('./logger-universal')).default;
}

beforeEach(() => {
  vi.resetModules();
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
});

afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
  vi.doUnmock('./logger');
  vi.restoreAllMocks();
});

describe('universal logger (server)', () => {
  it('falls back to the console when the server logger cannot load', async () => {
    vi.doMock('./logger', () => {
      throw new Error('Cannot load logger after the environment was torn down');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const logger = await loadUniversal();

    await expect(logger.warn('capability_decision_failed', { tenantId: 't' })).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(warn).toHaveBeenCalledWith('capability_decision_failed', { tenantId: 't' });
    expect(unhandled).toEqual([]);
  });

  it('falls back to the console when the server logger throws', async () => {
    vi.doMock('./logger', () => ({
      default: { error: () => { throw new Error('transport closed'); } },
    }));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = await loadUniversal();

    await expect(logger.error('boom')).resolves.toBeUndefined();
    await expect(logger.error('again')).resolves.toBeUndefined();

    expect(error.mock.calls).toEqual([['boom'], ['again']]);
    expect(unhandled).toEqual([]);
  });

  it('loads the server logger once and then dispatches synchronously', async () => {
    const info = vi.fn();
    const factory = vi.fn(() => ({ default: { info } }));
    vi.doMock('./logger', factory);
    const logger = await loadUniversal();

    await Promise.all([logger.info('a'), logger.info('b')]);
    logger.info('c');

    expect(info.mock.calls).toEqual([['a'], ['b'], ['c']]);
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
