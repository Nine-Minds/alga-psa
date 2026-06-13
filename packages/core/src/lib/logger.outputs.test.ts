import { afterEach, describe, expect, it, vi } from 'vitest';

// The core logger used to build a winston logger with console/file/external
// HTTP transports driven by LOG_* env vars. That implementation now lives in
// server/src/utils/logger.tsx; the @alga-psa/core logger was intentionally
// reduced to a client-safe console proxy because top-level winston imports
// broke client bundling. These tests pin the console-proxy contract.
describe('logger outputs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('delegates each level to the console backend', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const logger = (await import('./logger')).default;

    logger.error('err');
    logger.warn('warn');
    logger.info('info');
    logger.debug('debug');
    logger.trace('trace'); // trace maps to console.debug
    logger.http('http'); // http/verbose/system map to console.log
    logger.verbose('verbose');
    logger.system('system');

    expect(errorSpy).toHaveBeenCalledWith('err');
    expect(warnSpy).toHaveBeenCalledWith('warn');
    expect(infoSpy).toHaveBeenCalledWith('info');
    expect(debugSpy).toHaveBeenCalledWith('debug');
    expect(debugSpy).toHaveBeenCalledWith('trace');
    expect(logSpy).toHaveBeenCalledWith('http');
    expect(logSpy).toHaveBeenCalledWith('verbose');
    expect(logSpy).toHaveBeenCalledWith('system');
  });

  it('forwards structured meta only when provided', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const logger = (await import('./logger')).default;

    logger.info('no-meta');
    logger.info('with-meta', { tenant: 'tenant-1' });

    expect(infoSpy).toHaveBeenNthCalledWith(1, 'no-meta');
    expect(infoSpy).toHaveBeenNthCalledWith(2, 'with-meta', { tenant: 'tenant-1' });
  });
});
