import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';

const smtp = vi.hoisted(() => ({ createTransport: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: smtp.createTransport } }));

import { EmailProviderManager, TenantEmailService } from '@alga-psa/email';
import { connectionFingerprint } from '@alga-psa/core/providerConnectionIdentity';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

describe('legacy outbound credential binding against PostgreSQL', () => {
  let db: Knex;
  const tenant = randomUUID();
  const providerId = randomUUID();
  const raceTenant = randomUUID();
  const raceProviderId = randomUUID();
  const password = 'synthetic-legacy-smtp-password';
  const sendMail = vi.fn(async () => ({ messageId: '<legacy-binding@test>', response: '250 accepted' }));

  beforeEach(() => {
    sendMail.mockClear();
  });

  beforeAll(async () => {
    db = await createTestDbConnection();
    smtp.createTransport.mockReturnValue({ verify: vi.fn(async () => true), sendMail });
    await db('tenants').insert([tenant, raceTenant].map((id) => ({
      tenant: id,
      client_name: 'Legacy SMTP binding integration',
      email: `${id}@example.test`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })));

    // Deliberately retain JSON whitespace and an escaped @ through PostgreSQL's
    // json type. JSON.stringify(parsedRow) is not byte/text-equivalent to this.
    const formattedProviderConfigs = `[
      {
        "providerId" : "${providerId}",
        "providerType" : "smtp",
        "isEnabled" : true,
        "config" : {
          "host" : "smtp.legacy.example.test",
          "port" : 587,
          "username" : "legacy-user",
          "password" : "${password}",
          "from" : "legacy\\u0040example.test"
        }
      }
    ]`;
    await db.raw(
      `INSERT INTO tenant_email_settings
        (tenant, default_from_domain, custom_domains, email_provider, provider_configs, tracking_enabled, created_at, updated_at)
       VALUES (?, ?, ?::json, ?, ?::json, ?, now(), now())`,
      [tenant, 'example.test', '[]', 'smtp', formattedProviderConfigs, false],
    );
    await db('tenant_email_settings').insert({
      tenant: raceTenant,
      default_from_domain: 'example.test',
      custom_domains: JSON.stringify([]),
      email_provider: 'smtp',
      provider_configs: JSON.stringify([{
        providerId: raceProviderId,
        providerType: 'smtp',
        isEnabled: true,
        config: { host: 'smtp.race.example.test', port: 587, username: 'race-user', password, from: 'race@example.test' },
      }]),
      tracking_enabled: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
  }, 120_000);

  afterAll(async () => {
    if (!db) return;
    await db('tenant_email_settings').whereIn('tenant', [tenant, raceTenant]).del();
    await db('tenants').whereIn('tenant', [tenant, raceTenant]).del();
    await db.destroy();
  });

  it('binds formatted legacy JSON and uses the preserved credential for outbound SMTP', async () => {
    const seeded = await db('tenant_email_settings').where({ tenant }).first('provider_configs');
    const seededConfigs = typeof seeded.provider_configs === 'string'
      ? JSON.parse(seeded.provider_configs)
      : seeded.provider_configs;
    expect(seededConfigs[0].config).not.toHaveProperty('__secretFingerprint');
    expect(seededConfigs[0].config.password).toBe(password);

    // Exercise the application delivery path: TenantEmailService reloads the
    // persisted row, binds it under the row lock, initializes SMTP, then sends.
    const service = TenantEmailService.getInstance(tenant);
    const result = await service.sendEmail({
      tenantId: tenant,
      mailClass: 'general',
      from: { email: 'legacy@example.test' },
      to: 'recipient@example.test',
      subject: 'Legacy credential upgrade',
      html: '<p>Upgrade retained the SMTP credential.</p>',
    });
    expect(result.success).toBe(true);
    const stored = await db('tenant_email_settings').where({ tenant }).first('provider_configs');
    const storedConfigs = typeof stored.provider_configs === 'string'
      ? JSON.parse(stored.provider_configs)
      : stored.provider_configs;
    expect(storedConfigs[0].config.password).toBe(password);
    expect(storedConfigs[0].config.from).toBe('legacy@example.test');
    expect(storedConfigs[0].config.__secretFingerprint).toBe(
      connectionFingerprint(storedConfigs[0].config, 'smtp', providerId),
    );
    expect(smtp.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.legacy.example.test',
      auth: { user: 'legacy-user', pass: password },
    }));
    expect(sendMail).toHaveBeenCalledTimes(1);

    // A fingerprint that exists but names a different endpoint is terminal for
    // both delivery and Test Connection, and must be rejected before SMTP.
    const tamperedConfigs = storedConfigs.map((provider: any) => ({
      ...provider,
      config: { ...provider.config, host: 'smtp.changed-in-database.example.test' },
    }));
    await db('tenant_email_settings').where({ tenant }).update({
      provider_configs: JSON.stringify(tamperedConfigs),
    });
    smtp.createTransport.mockClear();
    sendMail.mockClear();
    const rejectedSend = await service.sendEmail({
      tenantId: tenant,
      mailClass: 'general',
      to: 'recipient@example.test',
      subject: 'Tampered endpoint',
      html: '<p>Must not send.</p>',
    });
    const rejectedTest = await TenantEmailService.testConnection(tenant);
    expect(rejectedSend).toMatchObject({ success: false, error: expect.stringContaining('Credentials no longer match this server') });
    expect(rejectedTest).toMatchObject({ success: false, error: expect.stringContaining('Credentials no longer match this server') });
    expect(smtp.createTransport).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
    await TenantEmailService.invalidateTenantSettings(tenant);
  });

  it('serializes first binding against a concurrent endpoint edit and requires a replacement credential', async () => {
    const bindingTransaction = await db.transaction();
    let writerFinished = false;
    let transactionOpen = true;
    let concurrentWriter: Promise<number> | undefined;
    let originalFingerprint: string | undefined;
    try {
      const bound = await TenantEmailService.getTenantEmailSettings(raceTenant, bindingTransaction);
      expect(bound?.providerConfigs[0].config.password).toBe(password);
      originalFingerprint = bound?.providerConfigs[0].config.__secretFingerprint;
      const concurrentConfig = {
        ...bound!.providerConfigs[0].config,
        host: 'smtp.changed-during-upgrade.example.test',
      };
      concurrentWriter = db('tenant_email_settings')
        .where({ tenant: raceTenant })
        .update({ provider_configs: JSON.stringify([{ ...bound!.providerConfigs[0], config: concurrentConfig }]) })
        .then(() => { writerFinished = true; });

      // The service's nested transaction has completed, but the caller's
      // transaction still owns its SELECT FOR UPDATE lock.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(writerFinished).toBe(false);
      await bindingTransaction.commit();
      transactionOpen = false;
      await concurrentWriter;
    } finally {
      // Always release the row lock before awaiting the writer. This lets a
      // negative-control assertion fail cleanly instead of hanging afterAll.
      if (transactionOpen) await bindingTransaction.rollback();
      if (concurrentWriter) await concurrentWriter;
    }

    const afterConcurrentEdit = await TenantEmailService.getTenantEmailSettings(raceTenant, db);
    expect(afterConcurrentEdit?.providerConfigs[0].config.host).toBe('smtp.changed-during-upgrade.example.test');
    expect(afterConcurrentEdit?.providerConfigs[0].config.__secretFingerprint).toBe(originalFingerprint);
    smtp.createTransport.mockClear();
    const staleManager = new EmailProviderManager();
    await expect(staleManager.initialize(afterConcurrentEdit!)).rejects.toMatchObject({ errorCode: 'SECRET_IDENTITY_MISMATCH' });
    expect(smtp.createTransport).not.toHaveBeenCalled();

    const replacementConfig = {
      ...afterConcurrentEdit!.providerConfigs[0].config,
      password: 'synthetic-explicit-replacement-password',
    };
    replacementConfig.__secretFingerprint = connectionFingerprint(replacementConfig, 'smtp', raceProviderId);
    await db('tenant_email_settings').where({ tenant: raceTenant }).update({
      provider_configs: JSON.stringify([{ ...afterConcurrentEdit!.providerConfigs[0], config: replacementConfig }]),
    });
    const replacementSettings = await TenantEmailService.getTenantEmailSettings(raceTenant, db);
    const replacementManager = new EmailProviderManager();
    await replacementManager.initialize(replacementSettings!);
    await expect(replacementManager.sendEmail({
      from: { email: 'race@example.test' },
      to: [{ email: 'recipient@example.test' }],
      subject: 'Replacement credential',
      html: '<p>Explicit replacement works.</p>',
    } as any, raceTenant)).resolves.toMatchObject({ success: true });
    expect(smtp.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.changed-during-upgrade.example.test',
      auth: { user: 'race-user', pass: 'synthetic-explicit-replacement-password' },
    }));
  });
});
