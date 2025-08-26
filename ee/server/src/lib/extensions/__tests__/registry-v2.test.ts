/**
 * Registry v2 service tests (EE)
 *
 * NOTE:
 * - These tests require Postgres and EE migrations to be applied.
 * - The current test DB utils (createTestDbConnection) point to CE migrations by default.
 * - Until the EE test harness runs EE migrations (ee/server/migrations), we keep these tests skipped.
 *
 * TODO:
 * - Wire a Knex test connection that runs ee/server/migrations and seeds.
 * - Or switch db-test-utils to allow overriding the migrations directory for EE tests.
 */

import { describe, it, expect } from 'vitest';
import type { Knex } from 'knex';
import { knex as createKnex } from 'knex';
import { ExtensionRegistryServiceV2 } from '../registry-v2';

function makeTestKnex(): Knex {
  // This helper constructs a local Knex pointing at Postgres using env vars,
  // but does NOT run migrations here. Intended for future enablement when the
  // test harness is ready to run EE migrations.
  // WARNING: Do not run in CI unless DB is configured.
  return createKnex({
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'alga_test',
      user: process.env.DB_USER || 'postgres',
      password: String(process.env.DB_PASSWORD || ''),
      ssl: process.env.DB_SSL === 'true',
    },
    pool: { min: 0, max: 5 },
    migrations: {
      directory: '../../../../migrations', // ee/server/migrations relative to this file
    },
  });
}

describe.skip('ExtensionRegistryServiceV2 (EE, Postgres-backed)', () => {
  // Skipped pending EE migrations wiring in test harness. See file header.
  let db: Knex;
  let svc: ExtensionRegistryServiceV2;

  it('setup (placeholder)', () => {
    expect(true).toBe(true);
  });

  // Example end-to-end happy path once EE migrations are applied in test DB.
  // Unskip when test harness is ready.
  it('createRegistryEntry enforces unique(publisher,name)', async () => {
    db = makeTestKnex();
    svc = new ExtensionRegistryServiceV2(db);

    const created = await svc.createRegistryEntry({
      publisher: 'acme',
      name: 'demo',
      displayName: 'Acme Demo',
      description: 'Demo extension',
    });

    expect(created.id).toBeTruthy();
    expect(created.publisher).toBe('acme');
    expect(created.name).toBe('demo');

    // Duplicate insert should throw friendly error
    await expect(
      svc.createRegistryEntry({
        publisher: 'acme',
        name: 'demo',
        displayName: 'Acme Demo 2',
        description: 'Duplicate',
      })
    ).rejects.toThrow(/already exists/i);
  });

  it('addVersion enforces unique(registry_id, version)', async () => {
    db = makeTestKnex();
    svc = new ExtensionRegistryServiceV2(db);

    const { id: regId } = await svc.createRegistryEntry({
      publisher: 'acme',
      name: 'demo2',
      displayName: 'Acme Demo 2',
      description: 'v test',
    });

    const v1 = await svc.addVersion(regId, {
      version: '1.0.0',
      runtime: 'wasm-js@1',
      mainEntry: 'dist/main.wasm',
      capabilities: ['http', 'ui'],
      api: { endpoints: [{ method: 'GET', path: '/ping', handler: 'dist/handlers#ping' }] },
      ui: { type: 'iframe', entry: 'dist/ui/index.html' },
    });

    expect(v1.id).toBeTruthy();
    await expect(
      svc.addVersion(regId, {
        version: '1.0.0',
        runtime: 'wasm-js@1',
        mainEntry: 'dist/main2.wasm',
        capabilities: [],
        api: { endpoints: [] },
      })
    ).rejects.toThrow(/already exists/i);
  });

  it('attachBundle validates content_hash and accepts signature via seam', async () => {
    db = makeTestKnex();
    svc = new ExtensionRegistryServiceV2(db);

    const { id: regId } = await svc.createRegistryEntry({
      publisher: 'acme',
      name: 'bundle-test',
    } as any);

    const v = await svc.addVersion(regId, {
      version: '2.0.0',
      runtime: 'wasm-js@1',
      mainEntry: 'dist/main.wasm',
      capabilities: [],
      api: { endpoints: [] },
    });

    // bad hash
    await expect(
      svc.attachBundle(v.id, {
        contentHash: 'bad',
      })
    ).rejects.toThrow(/Invalid content_hash/i);

    // good hash, with signature (stubbed seam returns true)
    const b = await svc.attachBundle(v.id, {
      contentHash: 'sha256:' + 'a'.repeat(64),
      signature: 'detached-signature',
      precompiled: { 'wasm32-wasi': 'dist/main.wasm' },
    });

    expect(b.id).toBeTruthy();
    expect(b.versionId).toBe(v.id);
    expect(b.contentHash).toMatch(/^sha256:/i);
  });

  it('install and getTenantInstall returns version_id + content_hash', async () => {
    db = makeTestKnex();
    svc = new ExtensionRegistryServiceV2(db);

    const tenantId = 'tenant-1';

    const { id: regId } = await svc.createRegistryEntry({
      publisher: 'acme',
      name: 'install-test',
    } as any);

    const v = await svc.addVersion(regId, {
      version: '3.0.0',
      runtime: 'wasm-js@1',
      mainEntry: 'dist/main.wasm',
      capabilities: ['http'],
      api: { endpoints: [] },
    });

    // attach a bundle (latest by created_at)
    const b = await svc.attachBundle(v.id, {
      contentHash: 'sha256:' + 'b'.repeat(64),
      signature: 'sig',
    });

    const ok = await svc.install(tenantId, regId, '3.0.0', {
      grantedCaps: ['http'],
      config: { foo: 'bar' },
    });
    expect(ok).toBe(true);

    const resolved = await svc.getTenantInstall(tenantId, regId);
    expect(resolved).toBeTruthy();
    expect(resolved!.version_id).toBe(v.id);
    expect(resolved!.content_hash).toBe(b.contentHash);
  });
});