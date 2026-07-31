/**
 * T205 — asset_layout_type_map get/set round-trips jsonb on
 * hudu_integrations.settings against the REAL local dev DB, without clobbering
 * sibling settings keys. Setup mirrors hudu-integrations.migration test:
 * direct knex handle, single connection, and the shared advisory lock that
 * serializes the Hudu DB-integration files (the migration test DROPs the
 * table this file reads).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import knexFactory, { type Knex } from 'knex';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import {
  getHuduAssetLayoutTypeMap,
  setHuduAssetLayoutTypeMap,
} from '../../lib/integrations/hudu/assetLayoutMap';
import { upsertHuduIntegration } from '../../lib/integrations/hudu/huduIntegrationRepository';

const require = createRequire(import.meta.url);

const repoRoot = path.resolve(process.cwd(), '..', '..');
const migration = require(
  path.resolve(repoRoot, 'ee', 'server', 'migrations', '20260609120000_create_hudu_integrations.cjs')
);

const TABLE = 'hudu_integrations';

function readPostgresPassword(): string {
  try {
    return fs.readFileSync(path.join(repoRoot, 'secrets', 'postgres_password'), 'utf8').trim();
  } catch {
    return process.env.DB_PASSWORD_ADMIN || 'postpass123';
  }
}

let db: Knex;
let tenantId: string;

describe('hudu asset layout map — DB integration', () => {
  const HOOK_TIMEOUT = 60_000;

  beforeAll(async () => {
    db = knexFactory({
      client: 'pg',
      connection: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        user: process.env.DB_USER_ADMIN || 'postgres',
        password: readPostgresPassword(),
        database: process.env.HUDU_TEST_DB_NAME || 'server',
      },
      // Single connection so the advisory lock below is held for the whole file.
      pool: { min: 1, max: 1 },
    });

    await db.raw('select 1');
    // Serialize against the other Hudu DB-integration files (the migration
    // test drops/recreates hudu_integrations).
    await db.raw("select pg_advisory_lock(hashtext('hudu-db-integration-tests'))");

    const tenantRow = await db('tenants').first<{ tenant: string }>('tenant');
    if (!tenantRow) {
      throw new Error('No tenants exist in the local DB; cannot exercise hudu_integrations FKs.');
    }
    tenantId = tenantRow.tenant;

    if (!(await db.schema.hasTable(TABLE))) {
      await migration.up(db);
    }
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    if (db && tenantId) {
      await db(TABLE).where({ tenant: tenantId }).del().catch(() => undefined);
    }
    await db?.raw('select pg_advisory_unlock_all()').catch(() => undefined);
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await db(TABLE).where({ tenant: tenantId }).del();
  });

  it('T205: set/get round-trips the jsonb map and preserves sibling settings keys', async () => {
    await upsertHuduIntegration(db, tenantId, {
      base_url: 'https://docs.example.com',
      is_active: true,
      settings: {
        password_access: true,
        companies_cache: { companies: [], fetched_at: '2026-06-10T00:00:00.000Z' },
      },
    });

    const written = await setHuduAssetLayoutTypeMap(db, tenantId, {
      '7': 'workstation',
      '9': 'server',
    });
    expect(written).toEqual({ '7': 'workstation', '9': 'server' });

    expect(await getHuduAssetLayoutTypeMap(db, tenantId)).toEqual({
      '7': 'workstation',
      '9': 'server',
    });

    // Siblings survived the merge.
    const row = await db(TABLE).where({ tenant: tenantId }).first();
    expect(row.settings).toEqual({
      password_access: true,
      companies_cache: { companies: [], fetched_at: '2026-06-10T00:00:00.000Z' },
      asset_layout_type_map: { '7': 'workstation', '9': 'server' },
    });

    // Re-set replaces the map (and only the map).
    await setHuduAssetLayoutTypeMap(db, tenantId, { '7': 'printer' });
    expect(await getHuduAssetLayoutTypeMap(db, tenantId)).toEqual({ '7': 'printer' });
    const after = await db(TABLE).where({ tenant: tenantId }).first();
    expect(after.settings.password_access).toBe(true);
    expect(after.settings.companies_cache).toEqual({
      companies: [],
      fetched_at: '2026-06-10T00:00:00.000Z',
    });
  });

  it('T205: get returns an empty map when no row or no map exists; set bootstraps the row', async () => {
    expect(await getHuduAssetLayoutTypeMap(db, tenantId)).toEqual({});

    await setHuduAssetLayoutTypeMap(db, tenantId, { '11': 'mobile_device' });

    const rows = await db(TABLE).where({ tenant: tenantId });
    expect(rows).toHaveLength(1);
    expect(rows[0].settings).toEqual({ asset_layout_type_map: { '11': 'mobile_device' } });
    expect(await getHuduAssetLayoutTypeMap(db, tenantId)).toEqual({ '11': 'mobile_device' });
  });

  it('T205/T318: slug-shaped values survive the read; non-slug junk coerces to unknown', async () => {
    // F315 contract: storage keeps every slug-shaped string (custom registry
    // slugs must round-trip); registry membership is enforced at import time
    // by resolveAssetTypeForLayout. Only non-slug junk coerces on read.
    await upsertHuduIntegration(db, tenantId, {
      settings: { asset_layout_type_map: { '7': 'mainframe', '9': 'printer', '11': 'Main Frame!' } },
    });

    expect(await getHuduAssetLayoutTypeMap(db, tenantId)).toEqual({
      '7': 'mainframe',
      '9': 'printer',
      '11': 'unknown',
    });
  });
});
