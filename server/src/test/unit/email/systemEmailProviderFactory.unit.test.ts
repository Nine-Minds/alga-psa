import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    system: vi.fn(),
  },
}));

vi.mock('../../../../../packages/email/src/providers/SMTPEmailProvider', () => ({
  SMTPEmailProvider: class {
    providerId = 'system-email-provider';
    providerType = 'smtp';
    capabilities = {};
    async initialize() {}
    async sendEmail() {
      return { success: true };
    }
  },
}));

import { SystemEmailProviderFactory } from '../../../../../packages/email/src/system/SystemEmailProviderFactory';

const SAVED_ENV: Record<string, string | undefined> = {
  EMAIL_ENABLE: process.env.EMAIL_ENABLE,
  EMAIL_PROVIDER_TYPE: process.env.EMAIL_PROVIDER_TYPE,
  EMAIL_HOST: process.env.EMAIL_HOST,
  EMAIL_PORT: process.env.EMAIL_PORT,
  EMAIL_FROM: process.env.EMAIL_FROM,
};

afterEach(() => {
  for (const [key, value] of Object.entries(SAVED_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('SystemEmailProviderFactory EMAIL_ENABLE gate', () => {
  it('returns null when EMAIL_ENABLE is false', async () => {
    process.env.EMAIL_ENABLE = 'false';
    await expect(SystemEmailProviderFactory.createProvider()).resolves.toBeNull();
  });

  it('returns null when EMAIL_ENABLE is unset', async () => {
    delete process.env.EMAIL_ENABLE;
    await expect(SystemEmailProviderFactory.createProvider()).resolves.toBeNull();
  });

  it('initializes the environment-backed system provider only for exact EMAIL_ENABLE=true', async () => {
    process.env.EMAIL_ENABLE = 'true';
    process.env.EMAIL_PROVIDER_TYPE = 'smtp';
    process.env.EMAIL_HOST = '127.0.0.1';
    process.env.EMAIL_PORT = '3025';
    process.env.EMAIL_FROM = 'noreply@example.com';

    const provider = await SystemEmailProviderFactory.createProvider();
    expect(provider).not.toBeNull();
    expect(provider?.providerId).toBe('system-email-provider');
    expect(provider?.providerType).toBe('smtp');
  });
});
