import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The core logger used to build a winston logger with console/file/external
// HTTP transports driven by LOG_* env vars. That implementation now lives in
// server/src/utils/logger.tsx; the @alga-psa/core logger was intentionally
// reduced to a client-safe console proxy because top-level winston imports
// broke client bundling. These tests pin the console-proxy contract, including
// the LOG_LEVEL threshold that keeps debug/trace off by default.
describe('logger outputs', () => {
  const originalLogLevel = process.env.LOG_LEVEL;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    if (originalLogLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = originalLogLevel;
    }
  });

  it('delegates each level to the console backend when LOG_LEVEL allows it', async () => {
    process.env.LOG_LEVEL = 'system';

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

  it('suppresses levels noisier than the configured LOG_LEVEL', async () => {
    process.env.LOG_LEVEL = 'INFO';

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const logger = (await import('./logger')).default;

    logger.info('kept');
    logger.debug('dropped', { tenant: 'tenant-1' });
    logger.trace('dropped', { tenant: 'tenant-1' });
    logger.verbose('dropped');

    expect(infoSpy).toHaveBeenCalledWith('kept');
    expect(debugSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('defaults to info when LOG_LEVEL is unset', async () => {
    delete process.env.LOG_LEVEL;

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);

    const logger = (await import('./logger')).default;

    logger.info('kept');
    logger.debug('dropped');

    expect(infoSpy).toHaveBeenCalledWith('kept');
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('accepts the LOG_LEVEL spellings documented in .env.example', async () => {
    process.env.LOG_LEVEL = 'WARNING';

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const logger = (await import('./logger')).default;

    logger.warn('kept');
    logger.info('dropped');

    expect(warnSpy).toHaveBeenCalledWith('kept');
    expect(infoSpy).not.toHaveBeenCalled();
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
