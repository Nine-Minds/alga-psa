import { describe, expect, it, vi } from 'vitest';
import { connectionFingerprint } from '../../../../integrations/src/lib/providerConnectionIdentity';

const { createTransportMock } = vi.hoisted(() => ({ createTransportMock: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: createTransportMock } }));
vi.mock('@alga-psa/core/logger', () => ({ default: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('@alga-psa/core/secrets', () => ({ getSecretProviderInstance: vi.fn() }));
vi.mock('@alga-psa/db', () => ({ getConnection: vi.fn(), tenantDb: vi.fn() }));

import { EmailProviderManager } from '../EmailProviderManager';

describe('EmailProviderManager stored-secret identity gate', () => {
  it('rejects a database-mutated host before provider creation or socket open', async () => {
    const original = { host: 'smtp.original.test', port: 587, username: 'mailer', password: 'credential-value', secure: false, requireTLS: true, rejectUnauthorized: true };
    const settings: any = {
      tenantId: 'tenant-1', emailProvider: 'smtp',
      providerConfigs: [{ providerId: 'smtp-1', providerType: 'smtp', isEnabled: true, config: {
        ...original,
        __secretFingerprint: connectionFingerprint(original, 'smtp'),
        host: 'smtp.changed-in-database.test',
      } }],
    };
    const manager = new EmailProviderManager();
    const createProvider = vi.spyOn(manager as any, 'createProvider');

    await expect(manager.initialize(settings)).rejects.toMatchObject({
      message: expect.stringContaining('Credentials no longer match this server'),
      errorCode: 'SECRET_IDENTITY_MISMATCH',
    });
    expect(createProvider).not.toHaveBeenCalled();
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it('fails closed for a legacy stored secret with no identity fingerprint', async () => {
    const manager = new EmailProviderManager();
    await expect(manager.initialize({
      tenantId: 'tenant-1', emailProvider: 'smtp',
      providerConfigs: [{ providerId: 'smtp-1', providerType: 'smtp', isEnabled: true, config: { host: 'smtp.test', port: 587, username: 'mailer', password: 'credential-value' } }],
    } as any)).rejects.toMatchObject({ errorCode: 'SECRET_IDENTITY_MISMATCH' });
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it('names the provider whose credential went stale, not the first enabled provider', async () => {
    const smtpConfig = { host: 'smtp.original.test', port: 587, username: 'mailer', password: 'smtp-credential', secure: false };
    const resendConfig = { apiKey: 'resend-credential' };
    const manager = new EmailProviderManager();

    await expect(manager.initialize({
      tenantId: 'tenant-1', emailProvider: 'smtp',
      providerConfigs: [
        { providerId: 'smtp-1', providerType: 'smtp', isEnabled: true, config: {
          ...smtpConfig, __secretFingerprint: connectionFingerprint(smtpConfig, 'smtp'),
        } },
        { providerId: 'resend-1', providerType: 'resend', isEnabled: true, config: {
          ...resendConfig, __secretFingerprint: 'stale-fingerprint',
        } },
      ],
    } as any)).rejects.toMatchObject({
      errorCode: 'SECRET_IDENTITY_MISMATCH',
      providerId: 'resend-1',
      providerType: 'resend',
    });
    expect(createTransportMock).not.toHaveBeenCalled();
  });
});
