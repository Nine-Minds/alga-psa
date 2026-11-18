/**
 * Integration tests for EmailProviderService.getProviders (alga-2026-0002700).
 *
 * getProviders must load vendor configs with one batched query per vendor
 * table, run sequentially, instead of one concurrent query per provider.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { EmailProviderService } from '../../services/email/EmailProviderService';

const describeDb = await describeWithDb();

let testDb: Knex;
let tenantA: string;
let tenantB: string;
let service: EmailProviderService;

vi.mock('../../lib/db', () => ({
  createTenantKnex: vi.fn().mockImplementation(async () => ({
    knex: testDb,
    tenant: tenantA,
  })),
}));

function table(tenant: string, name: string) {
  return tenantDb(testDb, tenant).table(name);
}

function tenantFixtureTable() {
  return tenantDb(testDb, tenantA).unscoped(
    'tenants',
    'getProviders integration test fixture creates and removes tenant rows'
  );
}

const base = Date.now() - 3_600_000;
const at = (minutes: number) => new Date(base + minutes * 60_000);

type Seeded = { id: string; type: 'google' | 'microsoft' | 'imap'; clientId?: string };

async function seedProvider(
  tenant: string,
  type: 'google' | 'microsoft' | 'imap',
  name: string,
  createdMinutes: number,
  withConfig = true
): Promise<Seeded> {
  const id = uuidv4();
  const created = at(createdMinutes);
  await table(tenant, 'email_providers').insert({
    id,
    tenant,
    provider_type: type,
    provider_name: name,
    mailbox: `${name.toLowerCase().replace(/\W+/g, '-')}@example.com`,
    is_active: true,
    status: 'connected',
    created_at: created,
    updated_at: created,
  });
  if (!withConfig) return { id, type };

  const clientId = `client-${name}`;
  if (type === 'google') {
    await table(tenant, 'google_email_provider_config').insert({
      email_provider_id: id,
      tenant,
      client_id: clientId,
      client_secret: 'secret',
      project_id: 'project',
      auto_process_emails: true,
      max_emails_per_sync: 50,
      label_filters: JSON.stringify([]),
      created_at: created,
      updated_at: created,
    });
  } else if (type === 'microsoft') {
    await table(tenant, 'microsoft_email_provider_config').insert({
      email_provider_id: id,
      tenant,
      client_id: clientId,
      client_secret: 'secret',
      tenant_id: 'directory-tenant-guid',
      redirect_uri: 'https://psa.example.com/api/auth/microsoft/callback',
      auto_process_emails: true,
      max_emails_per_sync: 50,
      folder_filters: JSON.stringify(['Inbox']),
      delivery_mode: 'polling',
      webhook_subscription_id: `sub-${name}`,
      webhook_verification_token: `verify-${name}`,
      created_at: created,
      updated_at: created,
    });
  } else {
    await table(tenant, 'imap_email_provider_config').insert({
      email_provider_id: id,
      tenant,
      host: `imap-${name}.example.com`,
      port: 993,
      secure: true,
      allow_starttls: false,
      auth_type: 'password',
      username: `user-${name}`,
      folder_filters: JSON.stringify(['INBOX']),
      auto_process_emails: true,
      max_emails_per_sync: 50,
      created_at: created,
      updated_at: created,
    });
  }
  return { id, type, clientId };
}

async function countQueries<T>(fn: () => Promise<T>): Promise<{ result: T; count: number }> {
  let count = 0;
  const listener = () => {
    count += 1;
  };
  testDb.on('query', listener);
  try {
    const result = await fn();
    return { result, count };
  } finally {
    testDb.removeListener('query', listener);
  }
}

describeDb('EmailProviderService.getProviders (DB-backed)', () => {
  // Oldest -> newest by created_at
  let g1: Seeded;
  let m1: Seeded;
  let i1: Seeded;
  let gNoConfig: Seeded;
  let g2: Seeded;
  let m2: Seeded;
  let otherTenantGoogle: Seeded;

  beforeAll(async () => {
    wireLocalTestDbEnv();
    testDb = await createTestDbConnection();
    service = new EmailProviderService();
    tenantA = uuidv4();
    tenantB = uuidv4();
    for (const [tenant, label] of [[tenantA, 'A'], [tenantB, 'B']] as const) {
      await tenantFixtureTable().insert({
        tenant,
        client_name: `getProviders Test ${label}`,
        email: `getproviders-${label}@client.com`,
        created_at: new Date(),
        updated_at: new Date(),
      });
    }

    g1 = await seedProvider(tenantA, 'google', 'G1', 1);
    m1 = await seedProvider(tenantA, 'microsoft', 'M1', 2);
    i1 = await seedProvider(tenantA, 'imap', 'I1', 3);
    gNoConfig = await seedProvider(tenantA, 'google', 'GNoConfig', 4, false);
    g2 = await seedProvider(tenantA, 'google', 'G2', 5);
    m2 = await seedProvider(tenantA, 'microsoft', 'M2', 6);
    otherTenantGoogle = await seedProvider(tenantB, 'google', 'OtherTenantG', 7);
  }, 120_000);

  afterAll(async () => {
    if (testDb) {
      for (const tenant of [tenantA, tenantB].filter(Boolean)) {
        for (const name of [
          'google_email_provider_config',
          'microsoft_email_provider_config',
          'imap_email_provider_config',
          'email_providers',
        ]) {
          await table(tenant, name).delete().catch(() => undefined);
        }
        await tenantFixtureTable().where({ tenant }).delete().catch(() => undefined);
      }
      await testDb.destroy().catch(() => undefined);
    }
  }, 30_000);

  it('returns all tenant providers in created_at desc order', async () => {
    const providers = await service.getProviders({ tenant: tenantA });
    expect(providers.map((p) => p.id)).toEqual([m2, g2, gNoConfig, i1, m1, g1].map((s) => s.id));
  });

  it('matches each provider to its own vendor config row', async () => {
    const providers = await service.getProviders({ tenant: tenantA });
    const byId = new Map(providers.map((p) => [p.id, p]));

    for (const seeded of [g1, g2, m1, m2]) {
      const config = byId.get(seeded.id)!.provider_config as Record<string, any>;
      expect(config.client_id ?? config.clientId).toBe(seeded.clientId);
    }
    const imapConfig = byId.get(i1.id)!.provider_config as Record<string, any>;
    expect(JSON.stringify(imapConfig)).toContain('imap-I1.example.com');
  });

  it('passes Microsoft webhook fields through from each config row', async () => {
    const providers = await service.getProviders({ tenant: tenantA, providerType: 'microsoft' });
    const byName = new Map(providers.map((p) => [p.name, p]));
    expect(byName.get('M1')!.webhook_subscription_id).toBe('sub-M1');
    expect(byName.get('M1')!.webhook_verification_token).toBe('verify-M1');
    expect(byName.get('M2')!.webhook_subscription_id).toBe('sub-M2');
    expect(byName.get('M2')!.webhook_verification_token).toBe('verify-M2');
  });

  it('returns an empty provider_config for a provider without a config row', async () => {
    const providers = await service.getProviders({ tenant: tenantA });
    const noConfig = providers.find((p) => p.id === gNoConfig.id)!;
    expect(noConfig.provider_config).toEqual({});
    expect(noConfig.webhook_subscription_id).toBeNull();
  });

  it('honours the providerType filter', async () => {
    const providers = await service.getProviders({ tenant: tenantA, providerType: 'imap' });
    expect(providers.map((p) => p.id)).toEqual([i1.id]);
  });

  it('never returns another tenant\'s providers or configs', async () => {
    const providers = await service.getProviders({ tenant: tenantA });
    expect(providers.every((p) => p.tenant === tenantA)).toBe(true);
    expect(providers.map((p) => p.id)).not.toContain(otherTenantGoogle.id);

    const other = await service.getProviders({ tenant: tenantB });
    expect(other.map((p) => p.id)).toEqual([otherTenantGoogle.id]);
  });

  it('bounds query count independent of provider count', async () => {
    const mixed = await countQueries(() => service.getProviders({ tenant: tenantA }));
    expect(mixed.result).toHaveLength(6);
    expect(mixed.count).toBeLessThanOrEqual(4);

    const googleOnly = await countQueries(() =>
      service.getProviders({ tenant: tenantA, providerType: 'google' })
    );
    expect(googleOnly.result).toHaveLength(3);
    expect(googleOnly.count).toBeLessThanOrEqual(2);
  });
});
