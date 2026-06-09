/**
 * T020/T021/T022 — hudu_integrations migration + repository, real local DB.
 *
 * Re-apply pattern: requires the single EE migration file directly and runs its
 * up()/down() against a direct knex handle (local dev DB on 5432), instead of
 * the whole migration chain. The table is created and dropped by this test.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import knexFactory, { type Knex } from 'knex';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import {
  getHuduIntegration,
  setHuduIntegrationActive,
  touchHuduIntegrationLastSynced,
  upsertHuduIntegration,
} from '../../lib/integrations/hudu/huduIntegrationRepository';

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

describe('hudu_integrations migration + repository — DB integration', () => {
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
    });

    // Fail fast (clear message) when the local DB is unreachable.
    await db.raw('select 1');

    const tenantRow = await db('tenants').first<{ tenant: string }>('tenant');
    if (!tenantRow) {
      throw new Error('No tenants exist in the local DB; cannot exercise hudu_integrations FKs.');
    }
    tenantId = tenantRow.tenant;

    await db.schema.dropTableIfExists(TABLE);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.schema.dropTableIfExists(TABLE).catch(() => undefined);
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  // Tests run shuffled (vitest sequence.shuffle); each one is self-contained.
  beforeEach(async () => {
    await db.schema.dropTableIfExists(TABLE);
  });

  it('T020: up() creates the expected schema and down() drops it', async () => {
    await migration.up(db);

    expect(await db.schema.hasTable(TABLE)).toBe(true);

    const columns = await db('information_schema.columns')
      .where({ table_schema: 'public', table_name: TABLE })
      .select('column_name', 'data_type', 'is_nullable', 'column_default');
    const byName = new Map(columns.map((c: any) => [c.column_name, c]));

    expect([...byName.keys()].sort()).toEqual(
      [
        'tenant',
        'integration_id',
        'base_url',
        'is_active',
        'connected_at',
        'last_synced_at',
        'settings',
        'created_at',
        'updated_at',
      ].sort()
    );

    expect(byName.get('tenant')).toMatchObject({ data_type: 'uuid', is_nullable: 'NO' });
    expect(byName.get('integration_id').data_type).toBe('uuid');
    expect(byName.get('integration_id').column_default).toContain('gen_random_uuid');
    expect(byName.get('base_url').data_type).toBe('text');
    expect(byName.get('is_active')).toMatchObject({ data_type: 'boolean', is_nullable: 'NO' });
    expect(byName.get('connected_at').data_type).toBe('timestamp with time zone');
    expect(byName.get('last_synced_at').data_type).toBe('timestamp with time zone');
    expect(byName.get('settings').data_type).toBe('jsonb');
    expect(byName.get('created_at').data_type).toBe('timestamp with time zone');
    expect(byName.get('updated_at').data_type).toBe('timestamp with time zone');

    // PK (tenant, integration_id).
    const pk = await db.raw(
      `
        SELECT a.attname
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = ?::regclass AND i.indisprimary
        ORDER BY array_position(i.indkey, a.attnum)
      `,
      [TABLE]
    );
    expect(pk.rows.map((r: any) => r.attname)).toEqual(['tenant', 'integration_id']);

    // Unique (tenant) — one connection per tenant (F022).
    const uniques = await db.raw(
      `
        SELECT i.indexrelid::regclass::text AS index_name, array_agg(a.attname::text) AS cols
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = ?::regclass AND i.indisunique AND NOT i.indisprimary
        GROUP BY i.indexrelid
      `,
      [TABLE]
    );
    const uniqueCols = uniques.rows.map((r: any) => r.cols);
    expect(uniqueCols).toContainEqual(['tenant']);

    // FK to tenants.
    const fks = await db.raw(
      `
        SELECT confrelid::regclass::text AS ref_table
        FROM pg_constraint
        WHERE conrelid = ?::regclass AND contype = 'f'
      `,
      [TABLE]
    );
    expect(fks.rows.map((r: any) => r.ref_table)).toContain('tenants');

    // updated_at trigger exists and fires on UPDATE.
    const triggers = await db.raw(
      `SELECT tgname FROM pg_trigger WHERE tgrelid = ?::regclass AND NOT tgisinternal`,
      [TABLE]
    );
    expect(triggers.rows.map((r: any) => r.tgname)).toContain(`update_${TABLE}_updated_at`);

    const [inserted] = await db(TABLE)
      .insert({ tenant: tenantId, base_url: 'https://docs.example.com' })
      .returning('*');
    await new Promise((resolve) => setTimeout(resolve, 10));
    await db(TABLE).where({ tenant: tenantId }).update({ base_url: 'https://docs2.example.com' });
    const updated = await db(TABLE).where({ tenant: tenantId }).first();
    expect(new Date(updated.updated_at).getTime()).toBeGreaterThan(
      new Date(inserted.updated_at).getTime()
    );

    await migration.down(db);
    expect(await db.schema.hasTable(TABLE)).toBe(false);
  });

  it('T021: with citus absent, up() skips distribution safely (guard path warns, no throw)', async () => {
    const citus = await db.raw(
      `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS enabled`
    );
    const citusEnabled = Boolean(citus.rows?.[0]?.enabled);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await expect(migration.up(db)).resolves.not.toThrow();
      expect(await db.schema.hasTable(TABLE)).toBe(true);

      if (citusEnabled) {
        const dist = await db.raw(
          `SELECT EXISTS (SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass) AS distributed`,
          [TABLE]
        );
        expect(Boolean(dist.rows?.[0]?.distributed)).toBe(true);
      } else {
        // Guard path exercised: warn + skip, table stays local.
        expect(
          warnSpy.mock.calls.some((call) => String(call[0]).includes('Skipping create_distributed_table'))
        ).toBe(true);
      }
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('T022: upserting twice for the same tenant yields one row; a second INSERT violates unique(tenant)', async () => {
    await migration.up(db);

    const first = await upsertHuduIntegration(db, tenantId, {
      base_url: 'https://one.example.com',
      is_active: true,
      connected_at: new Date().toISOString(),
      settings: { password_access: true },
    });
    const second = await upsertHuduIntegration(db, tenantId, {
      base_url: 'https://two.example.com',
      is_active: false,
    });

    const rows = await db(TABLE).where({ tenant: tenantId });
    expect(rows).toHaveLength(1);
    expect(second.integration_id).toBe(first.integration_id);
    expect(rows[0].base_url).toBe('https://two.example.com');
    expect(rows[0].is_active).toBe(false);
    // Untouched fields survive the merge.
    expect(rows[0].settings).toEqual({ password_access: true });

    const fetched = await getHuduIntegration(db, tenantId);
    expect(fetched?.integration_id).toBe(first.integration_id);

    await setHuduIntegrationActive(db, tenantId, true);
    expect((await getHuduIntegration(db, tenantId))?.is_active).toBe(true);

    expect(fetched?.last_synced_at).toBeNull();
    await touchHuduIntegrationLastSynced(db, tenantId);
    expect((await getHuduIntegration(db, tenantId))?.last_synced_at).not.toBeNull();

    // Raw duplicate insert (bypassing the upsert) hits unique(tenant): 23505.
    await expect(
      db(TABLE).insert({ tenant: tenantId, base_url: 'https://three.example.com' })
    ).rejects.toMatchObject({ code: '23505' });

    await db(TABLE).where({ tenant: tenantId }).del();
    await migration.down(db);
    expect(await db.schema.hasTable(TABLE)).toBe(false);
  });
});
