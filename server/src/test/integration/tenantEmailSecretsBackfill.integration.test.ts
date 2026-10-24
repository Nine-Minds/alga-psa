import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { tenantDb } from '@alga-psa/db';
import { FileSystemSecretProvider } from '@alga-psa/core/secrets';
import {
  migrateTenantProviderSecrets,
  resolveProviderSecrets,
  type TenantSecretStore,
} from '@alga-psa/email/providerSecrets';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const timeout = 300_000;
const FAKE_PASSWORD = 'fake-backfill-smtp-password';
const FAKE_KEY = 'fake-backfill-resend-key';

let db: Knex;
let secretDir: string;
let store: TenantSecretStore;
const tenantIds: string[] = [];
const previousBasePath = process.env.SECRET_FS_BASE_PATH;

async function seedTenant(configs: unknown[]): Promise<string> {
  const tenant = randomUUID();
  tenantIds.push(tenant);
  await db('tenants').insert({ tenant, client_name: `Email secrets ${tenant.slice(0, 6)}`, email: `${tenant}@example.test` });
  await tenantDb(db, tenant).table('tenant_email_settings').insert({
    tenant,
    email_provider: 'smtp',
    default_from_domain: 'example.test',
    provider_configs: JSON.stringify(configs),
    fallback_enabled: true,
    tracking_enabled: false,
  });
  return tenant;
}

const legacyConfigs = () => [
  { providerId: 'smtp-provider', providerType: 'smtp', isEnabled: true,
    config: { host: 'smtp.example.test', port: 587, username: 'mailer', password: FAKE_PASSWORD, from: 'a@example.test' } },
  { providerId: 'resend-provider', providerType: 'resend', isEnabled: false,
    config: { api_key: FAKE_KEY, from: 'a@example.test' } },
];

async function readRow(tenant: string) {
  const row = await tenantDb(db, tenant).table('tenant_email_settings').select('*', db.raw('updated_at::text as updated_text')).first();
  const configs = typeof row.provider_configs === 'string' ? JSON.parse(row.provider_configs) : row.provider_configs;
  return { row, configs, raw: JSON.stringify(row.provider_configs) };
}

function secretFiles(tenant: string): string[] {
  const dir = path.join(secretDir, 'tenants', tenant);
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

describe('tenant email secrets backfill (real Postgres, filesystem secret provider)', () => {
  beforeAll(async () => {
    secretDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-email-secrets-'));
    process.env.SECRET_FS_BASE_PATH = secretDir;
    store = new FileSystemSecretProvider();
    db = await createTestDbConnection();
  }, timeout);

  afterAll(async () => {
    if (db) {
      for (const tenant of tenantIds) {
        await tenantDb(db, tenant).table('tenant_email_settings').delete().catch(() => undefined);
        await db('tenants').where({ tenant }).delete().catch(() => undefined);
      }
      await db.destroy();
    }
    if (previousBasePath === undefined) delete process.env.SECRET_FS_BASE_PATH;
    else process.env.SECRET_FS_BASE_PATH = previousBasePath;
    fs.rmSync(secretDir, { recursive: true, force: true });
  }, timeout);

  it('dry-run reports field labels and changes nothing', async () => {
    const tenant = await seedTenant(legacyConfigs());
    const result = await migrateTenantProviderSecrets(db, tenant, store, { dryRun: true });
    expect(result.migrated.sort()).toEqual(['resend.apiKey', 'smtp.password']);
    expect(secretFiles(tenant)).toEqual([]);
    expect((await readRow(tenant)).raw).toContain(FAKE_PASSWORD);
  }, timeout);

  it('moves plaintext into the secret store, blanks the row, and is idempotent', async () => {
    const tenant = await seedTenant(legacyConfigs());
    const before = await readRow(tenant);

    const result = await migrateTenantProviderSecrets(db, tenant, store);
    expect(result.migrated.sort()).toEqual(['resend.apiKey', 'smtp.password']);

    const after = await readRow(tenant);
    expect(after.raw).not.toContain(FAKE_PASSWORD);
    expect(after.raw).not.toContain(FAKE_KEY);
    expect(after.row.updated_text).toBe(before.row.updated_text); // updated_at untouched
    expect(secretFiles(tenant)).toHaveLength(2);

    const smtp = after.configs.find((c: any) => c.providerType === 'smtp');
    const resend = after.configs.find((c: any) => c.providerType === 'resend');
    expect(smtp.config).not.toHaveProperty('password');
    expect(resend.config).not.toHaveProperty('api_key');
    expect(smtp.config.host).toBe('smtp.example.test');
    expect((await resolveProviderSecrets(tenant, smtp, store)).password).toBe(FAKE_PASSWORD);
    expect((await resolveProviderSecrets(tenant, resend, store)).apiKey).toBe(FAKE_KEY);

    const second = await migrateTenantProviderSecrets(db, tenant, store);
    expect(second).toMatchObject({ migrated: [], skipped: 'nothing-to-migrate' });
    expect(secretFiles(tenant)).toHaveLength(2);
    expect((await readRow(tenant)).raw).toBe(after.raw);
  }, timeout);

  it('skips and deletes the orphaned ref when a concurrent save moved updated_at', async () => {
    const tenant = await seedTenant(legacyConfigs());
    const racingStore: TenantSecretStore = {
      getTenantSecret: (t, n) => store.getTenantSecret(t, n),
      deleteTenantSecret: (t, n) => store.deleteTenantSecret(t, n),
      setTenantSecret: async (t, n, v) => {
        await store.setTenantSecret(t, n, v);
        // A concurrent save lands after the backfill read the row.
        await tenantDb(db, tenant).table('tenant_email_settings').update({ updated_at: db.raw("updated_at + interval '5 seconds'") });
      },
    };

    const result = await migrateTenantProviderSecrets(db, tenant, racingStore);
    expect(result).toMatchObject({ migrated: [], skipped: 'concurrent' });
    expect(secretFiles(tenant)).toEqual([]);
    expect((await readRow(tenant)).raw).toContain(FAKE_PASSWORD); // untouched; next run retries

    const retry = await migrateTenantProviderSecrets(db, tenant, store);
    expect(retry.migrated.sort()).toEqual(['resend.apiKey', 'smtp.password']);
    expect(secretFiles(tenant)).toHaveLength(2);
  }, timeout);

  it('is a no-op for tenants without settings or without plaintext', async () => {
    expect(await migrateTenantProviderSecrets(db, randomUUID(), store)).toMatchObject({ skipped: 'no-settings' });
    const tenant = await seedTenant([
      { providerId: 'smtp-provider', providerType: 'smtp', isEnabled: true, config: { host: 'h', password: '' } },
      { providerId: 'resend-provider', providerType: 'resend', isEnabled: false, config: { apiKey: '***' } },
    ]);
    expect(await migrateTenantProviderSecrets(db, tenant, store)).toMatchObject({ migrated: [], skipped: 'nothing-to-migrate' });
    expect(secretFiles(tenant)).toEqual([]);
  }, timeout);
});
