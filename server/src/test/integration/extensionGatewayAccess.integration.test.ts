import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';

const require = createRequire(import.meta.url);

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getAdminConnection: vi.fn(),
  hasPermission: vi.fn(),
  tryConsume: vi.fn(),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: mocks.getAdminConnection,
}));

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: mocks.hasPermission,
}));

vi.mock('@alga-psa/core/rateLimit', () => ({
  TokenBucketRateLimiter: {
    getInstance: () => ({ tryConsumeAtomic: mocks.tryConsume }),
  },
}));

const EE_MIGRATIONS = [
  '2025080801_create_extension_registry.cjs',
  '2025080802_create_extension_version.cjs',
  '2025080803_create_extension_bundle.cjs',
  '2025080804_create_tenant_extension_install.cjs',
  '20250810140000_align_registry_v2_schema.cjs',
  '20251031130000_create_install_config_tables.cjs',
];

const repoRoot = __dirname.split(`${require('node:path').sep}server${require('node:path').sep}src`)[0];

type AccessModule = typeof import('@/lib/extensions/gateway/access');
type InstallConfigModule = typeof import('@ee/lib/extensions/installConfig');

let db: Knex;
let assertAccess: AccessModule['assertAccess'];
let getInstallConfig: InstallConfigModule['getInstallConfig'];
let getInstallConfigByInstallId: InstallConfigModule['getInstallConfigByInstallId'];

let tenantA: string;
let tenantB: string;
let registryId: string;
let versionV1: string;
let versionV2: string;
let installA: string;
let installB: string;
let registryExclusive: string;
let versionExclusive: string;
let installExclusive: string;

describe('extension gateway access policy (DB-backed)', () => {
  const HOOK_TIMEOUT = 180_000;

  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection();

    for (const name of EE_MIGRATIONS) {
      const mod = require(`${repoRoot}${require('node:path').sep}ee${require('node:path').sep}server${require('node:path').sep}migrations${require('node:path').sep}${name}`);
      await mod.up(db);
    }

    tenantA = randomUUID();
    tenantB = randomUUID();
    registryId = randomUUID();
    versionV1 = randomUUID();
    versionV2 = randomUUID();
    installA = randomUUID();
    installB = randomUUID();
    registryExclusive = randomUUID();
    versionExclusive = randomUUID();
    installExclusive = randomUUID();

    await seedTenant(db, tenantA, 'Tenant A');
    await seedTenant(db, tenantB, 'Tenant B');

    await seedRegistry(db, registryId);
    await seedVersion(db, versionV1, registryId, [
      { method: 'GET', path: '/items', handler: 'handlers.list' },
      { method: 'GET', path: '/items/:id', handler: 'handlers.get' },
      { method: 'POST', path: '/items', handler: 'handlers.create' },
    ], '1.0.0');
    await seedVersion(db, versionV2, registryId, [
      { method: 'GET', path: '/other', handler: 'handlers.other' },
    ], '2.0.0');
    await seedBundle(db, versionV1, 'sha256:version-v1');
    await seedBundle(db, versionV2, 'sha256:version-v2');

    await seedInstall(db, installA, tenantA, registryId, versionV1);
    await seedInstall(db, installB, tenantB, registryId, versionV1);

    // A registry only tenant A has installed, to prove B cannot resolve it by
    // install ID, registry ID, or slug.
    await seedRegistry(db, registryExclusive, 'acme', 'exclusive');
    await seedVersion(db, versionExclusive, registryExclusive, [
      { method: 'GET', path: '/exclusive', handler: 'handlers.exclusive' },
    ], '1.0.0');
    await seedBundle(db, versionExclusive, 'sha256:version-exclusive');
    await seedInstall(db, installExclusive, tenantA, registryExclusive, versionExclusive);

    await seedConfig(db, installA, tenantA);
    await seedSecrets(db, installA, tenantA, 'SUPERSECRET-CIPHERTEXT');

    mocks.getAdminConnection.mockResolvedValue(db);
    mocks.hasPermission.mockResolvedValue(true);
    mocks.tryConsume.mockResolvedValue({ allowed: true, remaining: 10 });

    ({ assertAccess } = await import('@/lib/extensions/gateway/access'));
    ({ getInstallConfig, getInstallConfigByInstallId } = await import('@ee/lib/extensions/installConfig'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  it('resolves an active install by install ID, registry ID, and slug for the owning tenant only', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      user_id: 'user-a',
      tenant: tenantA,
      user_type: 'internal',
    } as any);

    for (const extensionId of [installA, registryId, 'acme.inventory']) {
      const access = await assertAccess({ tenantId: tenantA, extensionId, method: 'GET', path: '/items' });
      expect(access.installId).toBe(installA);
      expect(access.registryId).toBe(registryId);
      expect(access.versionId).toBe(versionV1);
    }

    // Tenant B cannot resolve tenant A's exclusive install/registry/slug via
    // its own tenant-scoped query, and cannot read A's secret-bearing config.
    mocks.getCurrentUser.mockResolvedValue({
      user_id: 'user-b',
      tenant: tenantB,
      user_type: 'internal',
    } as any);

    for (const extensionId of [installExclusive, registryExclusive, 'acme.exclusive']) {
      await expect(
        assertAccess({ tenantId: tenantB, extensionId, method: 'GET', path: '/exclusive' })
      ).rejects.toMatchObject({ code: 'extension_not_available', status: 404 });
    }

    expect(await getInstallConfig({ tenantId: tenantB, extensionId: installExclusive })).toBeNull();
    expect(await getInstallConfig({ tenantId: tenantB, extensionId: registryExclusive })).toBeNull();
    expect(await getInstallConfig({ tenantId: tenantB, extensionId: 'acme.exclusive' })).toBeNull();
    expect(await getInstallConfig({ tenantId: tenantB, extensionId: installA })).toBeNull();
  });

  it('only active (is_enabled=true and status=enabled) installs authorize access and hydrate secrets', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      user_id: 'user-a',
      tenant: tenantA,
      user_type: 'internal',
    } as any);

    const active = await assertAccess({ tenantId: tenantA, extensionId: installA, method: 'GET', path: '/items' });
    expect(active.installId).toBe(installA);

    const config = await getInstallConfig({ tenantId: tenantA, extensionId: installA });
    expect(config?.installId).toBe(installA);
    expect(config?.versionId).toBe(versionV1);
    expect(config?.secretEnvelope?.ciphertext_b64).toBe('SUPERSECRET-CIPHERTEXT');

    await db('tenant_extension_install').where({ id: installA }).update({ is_enabled: false });
    await expect(
      assertAccess({ tenantId: tenantA, extensionId: installA, method: 'GET', path: '/items' })
    ).rejects.toMatchObject({ code: 'extension_not_available', status: 404 });
    expect(await getInstallConfig({ tenantId: tenantA, extensionId: installA })).toBeNull();

    await db('tenant_extension_install').where({ id: installA }).update({ is_enabled: true, status: 'pending' });
    await expect(
      assertAccess({ tenantId: tenantA, extensionId: installA, method: 'GET', path: '/items' })
    ).rejects.toMatchObject({ code: 'extension_not_available', status: 404 });
    expect(await getInstallConfig({ tenantId: tenantA, extensionId: installA })).toBeNull();

    await db('tenant_extension_install').where({ id: installA }).update({ status: 'disabled' });
    await expect(
      assertAccess({ tenantId: tenantA, extensionId: installA, method: 'GET', path: '/items' })
    ).rejects.toMatchObject({ code: 'extension_not_available', status: 404 });
    expect(await getInstallConfig({ tenantId: tenantA, extensionId: installA })).toBeNull();
    expect(await getInstallConfigByInstallId(installA)).toBeNull();

    await db('tenant_extension_install').where({ id: installA }).update({ status: 'enabled' });
  });

  it('the direct-install fallback resolver also denies status-disabled/pending installs, not just is_enabled=false', async () => {
    const { getTenantInstall } = await import('@/lib/extensions/gateway/registry');

    // is_enabled stays true throughout: only `status` changes.
    await db('tenant_extension_install').where({ id: installA }).update({ is_enabled: true, status: 'disabled' });
    expect(await getTenantInstall(tenantA, registryId)).toBeNull();

    await db('tenant_extension_install').where({ id: installA }).update({ is_enabled: true, status: 'pending' });
    expect(await getTenantInstall(tenantA, registryId)).toBeNull();

    await db('tenant_extension_install').where({ id: installA }).update({ is_enabled: true, status: 'enabled' });
    const resolved = await getTenantInstall(tenantA, registryId);
    expect(resolved?.install_id).toBe(installA);
    expect(resolved?.version_id).toBe(versionV1);
  });

  it('the installed version controls endpoint access; switching versions invalidates the old path', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      user_id: 'user-a',
      tenant: tenantA,
      user_type: 'internal',
    } as any);

    const before = await assertAccess({ tenantId: tenantA, extensionId: installA, method: 'GET', path: '/items' });
    expect(before.versionId).toBe(versionV1);

    await db('tenant_extension_install').where({ id: installA }).update({ version_id: versionV2 });
    await db('tenant_extension_install_config').where({ install_id: installA }).update({ version: randomUUID() });

    await expect(
      assertAccess({ tenantId: tenantA, extensionId: installA, method: 'GET', path: '/items' })
    ).rejects.toMatchObject({ code: 'endpoint_not_found', status: 404 });

    const after = await assertAccess({ tenantId: tenantA, extensionId: installA, method: 'GET', path: '/other' });
    expect(after.versionId).toBe(versionV2);
    expect(after.endpoint).toEqual({ method: 'GET', path: '/other', handler: 'handlers.other' });

    const config = await getInstallConfig({ tenantId: tenantA, extensionId: installA });
    expect(config?.versionId).toBe(versionV2);
    expect(config?.contentHash).toBe('sha256:version-v2');

    await db('tenant_extension_install').where({ id: installA }).update({ version_id: versionV1 });
  });
});

async function seedTenant(db: Knex, tenant: string, companyName: string): Promise<void> {
  const unscopedTenants = () =>
    tenantDb(db, '__test_tenant_fixture__').unscoped('tenants', 'integration fixture creates tenant rows');
  const existing = await unscopedTenants().where({ tenant }).first();
  if (existing) return;
  await unscopedTenants().insert({
    tenant,
    client_name: companyName,
    email: `${tenant.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

async function seedRegistry(db: Knex, id: string, publisher = 'acme', name = 'inventory'): Promise<void> {
  await tenantDb(db, '__test_registry__').unscoped('extension_registry', 'integration fixture creates global registry row').insert({
    id,
    publisher,
    name,
    display_name: name,
    description: 'Integration fixture',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

async function seedVersion(
  db: Knex,
  id: string,
  registryId: string,
  endpoints: Array<{ method: string; path: string; handler: string }>,
  version: string,
): Promise<void> {
  await tenantDb(db, '__test_registry__').unscoped('extension_version', 'integration fixture creates global version row').insert({
    id,
    registry_id: registryId,
    version,
    runtime: 'node',
    main_entry: 'index.js',
    api: JSON.stringify({}),
    ui: JSON.stringify({ hooks: { clientPortalMenu: { label: 'Items' } } }),
    capabilities: JSON.stringify([]),
    api_endpoints: JSON.stringify(endpoints),
    created_at: db.fn.now(),
  });
}

async function seedBundle(db: Knex, versionId: string, contentHash: string): Promise<void> {
  await tenantDb(db, '__test_registry__').unscoped('extension_bundle', 'integration fixture creates global bundle row').insert({
    id: randomUUID(),
    version_id: versionId,
    content_hash: contentHash,
    created_at: db.fn.now(),
  });
}

async function seedInstall(
  db: Knex,
  installId: string,
  tenant: string,
  registryId: string,
  versionId: string,
): Promise<void> {
  await tenantDb(db, tenant).table('tenant_extension_install').insert({
    id: installId,
    tenant_id: tenant,
    registry_id: registryId,
    version_id: versionId,
    granted_caps: JSON.stringify([]),
    config: JSON.stringify({}),
    is_enabled: true,
    status: 'enabled',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

async function seedConfig(db: Knex, installId: string, tenant: string): Promise<void> {
  await tenantDb(db, tenant).table('tenant_extension_install_config').insert({
    id: randomUUID(),
    install_id: installId,
    tenant_id: tenant,
    config: JSON.stringify({ apiKey: 'config-value' }),
    providers: JSON.stringify(['http']),
    version: randomUUID(),
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

async function seedSecrets(db: Knex, installId: string, tenant: string, ciphertext: string): Promise<void> {
  await tenantDb(db, tenant).table('tenant_extension_install_secrets').insert({
    id: randomUUID(),
    install_id: installId,
    tenant_id: tenant,
    ciphertext,
    algorithm: 'inline/base64',
    version: randomUUID(),
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}
