import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pgConnectMock = vi.fn(async () => undefined);
const pgQueryMock = vi.fn(async () => ({ rows: [{ '?column?': 1 }] }));
const pgEndMock = vi.fn(async () => undefined);
const temporalCloseMock = vi.fn(async () => undefined);
const temporalConnectMock = vi.fn(async () => ({ close: temporalCloseMock }));

vi.mock('pg', () => {
  class MockClient {
    async connect(): Promise<void> {
      await pgConnectMock();
    }

    async query(sql: string): Promise<unknown> {
      return await pgQueryMock(sql);
    }

    async end(): Promise<void> {
      await pgEndMock();
    }
  }

  return { Client: MockClient };
});

vi.mock('@temporalio/client', () => ({
  Connection: {
    connect: temporalConnectMock,
  },
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    async getAppSecret(key: string): Promise<string | undefined> {
      return process.env[key] ?? process.env[key.toUpperCase()] ?? process.env[key.toLowerCase()];
    },
  }),
}));

const REQUIRED_ENV: Record<string, string> = {
  ALGA_AUTH_KEY: 'test-auth-key',
  NEXTAUTH_SECRET: 'test-nextauth-secret',
  APPLICATION_URL: 'http://localhost:3004',
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_NAME_SERVER: 'server',
  DB_USER_SERVER: 'app_user',
  DB_PASSWORD_SERVER: 'postpass123',
  DB_USER_ADMIN: 'postgres',
  DB_PASSWORD_ADMIN: 'postpass123',
  TEMPORAL_ADDRESS: 'localhost:7233',
  TEMPORAL_NAMESPACE: 'default',
  TEMPORAL_TASK_QUEUE: 'alga-jobs',
  PORTAL_DOMAIN_BASE_VIRTUAL_SERVICE: 'msp/alga-psa-vs',
};

const ORIGINAL_ENV = { ...process.env };

async function loadModule() {
  return await import('../startupValidation.js');
}

function setEnv(overrides: Record<string, string | undefined> = {}): void {
  process.env = { ...ORIGINAL_ENV };

  for (const [key, value] of Object.entries({ ...REQUIRED_ENV, ...overrides })) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
}

describe('startupValidation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setEnv();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('fails required validation when DB_PASSWORD_ADMIN is missing', async () => {
    setEnv({ DB_PASSWORD_ADMIN: undefined });
    const { validateRequiredConfiguration } = await loadModule();

    await expect(validateRequiredConfiguration()).rejects.toThrow(
      'Required configuration validation failed'
    );
  });

  it('requires RESEND_API_KEY when EMAIL_PROVIDER is resend', async () => {
    setEnv({
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: undefined,
    });
    const { validateOptionalConfiguration } = await loadModule();

    await expect(validateOptionalConfiguration()).rejects.toThrow(
      'RESEND_API_KEY is required when EMAIL_PROVIDER is set to "resend"'
    );
  });

  it('passes validateStartup with valid env and connectivity', async () => {
    setEnv({
      EMAIL_PROVIDER: 'mock',
      RESEND_API_KEY: undefined,
    });
    const { validateStartup } = await loadModule();

    await expect(validateStartup()).resolves.toBeUndefined();
    expect(pgConnectMock).toHaveBeenCalledTimes(1);
    expect(pgQueryMock).toHaveBeenCalledWith('SELECT 1');
    expect(pgEndMock).toHaveBeenCalledTimes(1);
    expect(temporalConnectMock).toHaveBeenCalledTimes(1);
    expect(temporalCloseMock).toHaveBeenCalledTimes(1);
  });
});
