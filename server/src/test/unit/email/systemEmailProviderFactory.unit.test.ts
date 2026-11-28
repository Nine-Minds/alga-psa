import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  system: vi.fn(),
}));
vi.mock('@alga-psa/core/logger', () => ({ default: loggerMock }));

vi.mock('../../../../../packages/email/src/providers/SMTPEmailProvider', () => ({
  SMTPEmailProvider: class {
    providerType = 'smtp';
    capabilities = {};
    constructor(public providerId: string) {}
    async initialize() {}
    async sendEmail() {
      return { success: true };
    }
  },
}));

vi.mock('../../../../../packages/email/src/providers/ResendEmailProvider', () => ({
  ResendEmailProvider: class {
    providerType = 'resend';
    capabilities = {};
    constructor(public providerId: string) {}
    async initialize() {}
    async sendEmail() {
      return { success: true };
    }
  },
}));

import { SystemEmailProviderFactory } from '../../../../../packages/email/src/system/SystemEmailProviderFactory';

const KEYS = [
  'EMAIL_ENABLE', 'EMAIL_PROVIDER_TYPE', 'EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_FROM', 'RESEND_API_KEY',
] as const;
const SAVED_ENV: Record<string, string | undefined> = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

beforeEach(() => {
  for (const key of KEYS) delete process.env[key];
  vi.clearAllMocks();
});

afterEach(() => {
  for (const [key, value] of Object.entries(SAVED_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('SystemEmailProviderFactory: on when configured, EMAIL_ENABLE=false disables', () => {
  it('creates a Resend provider with RESEND_API_KEY set and EMAIL_ENABLE unset', async () => {
    process.env.RESEND_API_KEY = 're_test_key_123';
    const provider = await SystemEmailProviderFactory.createProvider();
    expect(provider?.providerType).toBe('resend');
    expect(provider?.providerId).toBe('system-email-provider');
  });

  it('creates an SMTP provider with EMAIL_HOST set and EMAIL_ENABLE unset', async () => {
    process.env.EMAIL_HOST = '127.0.0.1';
    process.env.EMAIL_PORT = '3025';
    process.env.EMAIL_FROM = 'noreply@example.com';
    const provider = await SystemEmailProviderFactory.createProvider();
    expect(provider?.providerType).toBe('smtp');
  });

  it('still creates the provider when EMAIL_ENABLE=true', async () => {
    process.env.EMAIL_ENABLE = 'true';
    process.env.EMAIL_PROVIDER_TYPE = 'smtp';
    process.env.EMAIL_HOST = '127.0.0.1';
    const provider = await SystemEmailProviderFactory.createProvider();
    expect(provider?.providerType).toBe('smtp');
  });

  it('returns null when EMAIL_ENABLE=false even with credentials, and logs the disabled state', async () => {
    process.env.EMAIL_ENABLE = 'false';
    process.env.RESEND_API_KEY = 're_test_key_123';
    await expect(SystemEmailProviderFactory.createProvider()).resolves.toBeNull();
    expect(loggerMock.info).toHaveBeenCalledWith(expect.stringContaining('disabled'));
  });

  it('returns null without throwing when there are no credentials and no flag, logging the unconfigured state', async () => {
    await expect(SystemEmailProviderFactory.createProvider()).resolves.toBeNull();
    expect(loggerMock.info).toHaveBeenCalledWith(expect.stringContaining('not configured'));
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it('returns null when EMAIL_PROVIDER_TYPE=resend but the key is missing', async () => {
    process.env.EMAIL_PROVIDER_TYPE = 'resend';
    process.env.EMAIL_HOST = 'smtp.example.com';
    await expect(SystemEmailProviderFactory.createProvider()).resolves.toBeNull();
  });

  it('does not console.log the flag', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await SystemEmailProviderFactory.createProvider();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('reports state in the config summary', () => {
    expect(SystemEmailProviderFactory.getProviderConfigSummary()).toMatchObject({ enabled: false, state: 'unconfigured' });
    process.env.EMAIL_HOST = 'h';
    expect(SystemEmailProviderFactory.getProviderConfigSummary()).toMatchObject({ enabled: true, providerType: 'smtp' });
    process.env.EMAIL_ENABLE = 'false';
    expect(SystemEmailProviderFactory.getProviderConfigSummary()).toMatchObject({ enabled: false, state: 'disabled' });
  });
});
