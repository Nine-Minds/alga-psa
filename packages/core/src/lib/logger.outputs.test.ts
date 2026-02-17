import { describe, expect, it, vi } from 'vitest';

const withEnv = async (env: Record<string, string | undefined>, run: () => Promise<void>) => {
  const before = { ...process.env };

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    vi.resetModules();
    await run();
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in before)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(before)) {
      process.env[key] = value;
    }
    vi.resetModules();
  }
};

describe('logger outputs', () => {
  it('uses console methods by default', async () => {
    await withEnv(
      {
        LOG_ENABLED_FILE_LOGGING: undefined,
        LOG_ENABLED_EXTERNAL_LOGGING: undefined,
        LOG_DIR_PATH: undefined,
        LOG_EXTERNAL_HTTP_HOST: undefined,
        LOG_EXTERNAL_HTTP_PORT: undefined,
        LOG_EXTERNAL_HTTP_PATH: undefined,
        LOG_EXTERNAL_HTTP_LEVEL: undefined,
        LOG_EXTERNAL_HTTP_TOKEN: undefined,
      },
      async () => {
        const logger = (await import('./logger')).default as any;
        expect(logger.transports).toBeUndefined();
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
        logger.info('hello');
        expect(infoSpy).toHaveBeenCalledWith('hello');
        infoSpy.mockRestore();
      },
    );
  });

  it('ignores external transport config and still uses console', async () => {
    await withEnv(
      {
        LOG_ENABLED_FILE_LOGGING: 'true',
        LOG_DIR_PATH: './logs-test',
        LOG_ENABLED_EXTERNAL_LOGGING: 'true',
        LOG_EXTERNAL_HTTP_HOST: 'example.com',
        LOG_EXTERNAL_HTTP_PORT: '8080',
        LOG_EXTERNAL_HTTP_PATH: '/logs',
        LOG_EXTERNAL_HTTP_LEVEL: 'warn',
        LOG_EXTERNAL_HTTP_TOKEN: 'token123',
      },
      async () => {
        const logger = (await import('./logger')).default as any;
        expect(logger.transports).toBeUndefined();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        logger.warn('warn');
        expect(warnSpy).toHaveBeenCalledWith('warn');
        warnSpy.mockRestore();
      },
    );
  });
});
