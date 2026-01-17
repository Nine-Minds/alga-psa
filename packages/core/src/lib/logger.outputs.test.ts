import DailyRotateFile from 'winston-daily-rotate-file';
import winston from 'winston';
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
  it('defaults to console-only transport', async () => {
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
        expect(logger.transports).toHaveLength(1);
        expect(logger.transports[0]).toBeInstanceOf(winston.transports.Console);
      },
    );
  });

  it('configures external and file transports when enabled', async () => {
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

        const consoleTransport = logger.transports.find(
          (t: unknown) => t instanceof winston.transports.Console,
        );
        expect(consoleTransport).toBeTruthy();

        const httpTransport = logger.transports.find(
          (t: unknown) => t instanceof winston.transports.Http,
        );
        expect(httpTransport).toBeTruthy();
        expect((httpTransport as any).host).toBe('example.com');
        expect((httpTransport as any).port).toBe(8080);
        expect((httpTransport as any).path).toBe('/logs');
        expect((httpTransport as any).level).toBe('warn');
        expect((httpTransport as any).headers?.Authorization).toBe('Bearer token123');

        const fileTransports = logger.transports.filter((t: unknown) => t instanceof DailyRotateFile);
        expect(fileTransports).toHaveLength(2);

        const filenames = fileTransports.map((t: any) => String(t.options?.filename ?? '')).sort();
        expect(filenames).toEqual(['./logs-test/combined-%DATE%.log', './logs-test/error-%DATE%.log']);

        const errorTransport = fileTransports.find((t: any) => t.options?.level === 'error');
        expect(errorTransport).toBeTruthy();
      },
    );
  });
});

