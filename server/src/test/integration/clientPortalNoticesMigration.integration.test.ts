/**
 * Migration coverage for the Client Portal Notices tables (plan pl-737e90f8, S1):
 * client_portal_notices, client_portal_notice_targets, client_portal_notice_dismissals.
 * The test-database bootstrap applies the migration; re-running `up` must be a no-op.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createRequire } from 'node:module';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';

const describeDb = await describeWithDb();

const require = createRequire(import.meta.url);
const migration = require('../../../migrations/20261124000000_create_client_portal_notices.cjs');

const NOTICES = 'client_portal_notices';
const TARGETS = 'client_portal_notice_targets';
const DISMISSALS = 'client_portal_notice_dismissals';

const EXPECTED_COLUMNS: Record<string, string[]> = {
  [NOTICES]: [
    'tenant', 'notice_id', 'severity', 'content', 'link_url', 'starts_at', 'ends_at',
    'dismissible', 'audience_type', 'created_by', 'created_at', 'updated_at',
  ],
  [TARGETS]: ['tenant', 'notice_id', 'target_type', 'target_id'],
  [DISMISSALS]: ['tenant', 'notice_id', 'user_id', 'dismissed_at'],
};

let db: Knex;
const tenant = uuidv4();

async function columnNames(table: string): Promise<string[]> {
  const rows = await db('information_schema.columns')
    .where({ table_schema: 'public', table_name: table })
    .pluck('column_name');
  return rows as string[];
}

function noticeRow(overrides: Record<string, unknown> = {}) {
  return {
    tenant,
    notice_id: uuidv4(),
    severity: 'info',
    content: JSON.stringify({ default: { message: 'Maintenance tonight' } }),
    dismissible: true,
    audience_type: 'all',
    ...overrides,
  };
}

async function expectPgError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}

describeDb('client portal notices migration (DB-backed)', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection();
  }, 180_000);

  afterAll(async () => {
    if (db) {
      await db(DISMISSALS).where({ tenant }).delete();
      await db(TARGETS).where({ tenant }).delete();
      await db(NOTICES).where({ tenant }).delete();
      await db.destroy().catch(() => undefined);
    }
  }, 30_000);

  it('creates all three tables with the expected columns', async () => {
    for (const [table, expected] of Object.entries(EXPECTED_COLUMNS)) {
      expect(await db.schema.hasTable(table)).toBe(true);
      expect((await columnNames(table)).sort()).toEqual([...expected].sort());
    }
  });

  it('applies defaults and accepts a valid notice, target and dismissal', async () => {
    const row = noticeRow();
    await db(NOTICES).insert(row);
    const stored = await db(NOTICES).where({ tenant, notice_id: row.notice_id }).first();
    expect(stored.created_at).toBeInstanceOf(Date);
    expect(stored.updated_at).toBeInstanceOf(Date);
    expect(stored.link_url).toBeNull();

    await db(TARGETS).insert({ tenant, notice_id: row.notice_id, target_type: 'client', target_id: uuidv4() });
    await db(DISMISSALS).insert({ tenant, notice_id: row.notice_id, user_id: uuidv4() });
    const dismissal = await db(DISMISSALS).where({ tenant, notice_id: row.notice_id }).first();
    expect(dismissal.dismissed_at).toBeInstanceOf(Date);
  });

  it('rejects a duplicate (tenant, notice_id, user_id) dismissal with a unique violation', async () => {
    const noticeId = uuidv4();
    const userId = uuidv4();
    await db(DISMISSALS).insert({ tenant, notice_id: noticeId, user_id: userId });
    await expectPgError(
      db(DISMISSALS).insert({ tenant, notice_id: noticeId, user_id: userId }),
      '23505'
    );
    // A different user on the same notice is fine.
    await db(DISMISSALS).insert({ tenant, notice_id: noticeId, user_id: uuidv4() });
  });

  it('rejects a duplicate target and duplicate notice primary key', async () => {
    const row = noticeRow();
    await db(NOTICES).insert(row);
    await expectPgError(db(NOTICES).insert(row), '23505');

    const target = { tenant, notice_id: row.notice_id, target_type: 'tag', target_id: uuidv4() };
    await db(TARGETS).insert(target);
    await expectPgError(db(TARGETS).insert(target), '23505');
  });

  it('rejects out-of-range severity, audience_type and target_type values', async () => {
    await expectPgError(db(NOTICES).insert(noticeRow({ severity: 'urgent' })), '23514');
    await expectPgError(db(NOTICES).insert(noticeRow({ audience_type: 'everyone' })), '23514');
    await expectPgError(
      db(TARGETS).insert({ tenant, notice_id: uuidv4(), target_type: 'user', target_id: uuidv4() }),
      '23514'
    );
    for (const severity of ['info', 'warning', 'critical']) {
      await db(NOTICES).insert(noticeRow({ severity }));
    }
    for (const audience_type of ['all', 'clients', 'tags']) {
      await db(NOTICES).insert(noticeRow({ audience_type }));
    }
  });

  it('rejects ends_at that is not after starts_at, and allows open-ended schedules', async () => {
    const start = new Date('2026-12-01T00:00:00Z');
    await expectPgError(db(NOTICES).insert(noticeRow({ starts_at: start, ends_at: start })), '23514');
    await db(NOTICES).insert(noticeRow({ starts_at: start }));
    await db(NOTICES).insert(noticeRow({ ends_at: start }));
    await db(NOTICES).insert(noticeRow({ starts_at: start, ends_at: new Date('2026-12-02T00:00:00Z') }));
  });

  it('declares no foreign keys and leads every key and index with tenant', async () => {
    const fks = await db.raw(
      `SELECT conname FROM pg_constraint WHERE contype = 'f' AND conrelid = ANY (?::regclass[])`,
      [`{${[NOTICES, TARGETS, DISMISSALS].join(',')}}`]
    );
    expect(fks.rows).toEqual([]);

    const idx = await db.raw(
      `SELECT tablename, indexname, indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND tablename IN (?, ?, ?)`,
      [NOTICES, TARGETS, DISMISSALS]
    );
    expect(idx.rows.length).toBeGreaterThanOrEqual(5);
    for (const r of idx.rows) {
      expect(r.indexdef).toMatch(/\(tenant[,)]/);
    }
  });

  it('is idempotent: running up again does not throw or change the schema', async () => {
    const before = Object.fromEntries(
      await Promise.all(Object.keys(EXPECTED_COLUMNS).map(async (t) => [t, (await columnNames(t)).sort()] as const))
    );
    await expect(migration.up(db)).resolves.not.toThrow();
    await expect(migration.up(db)).resolves.not.toThrow();
    for (const t of Object.keys(EXPECTED_COLUMNS)) {
      expect((await columnNames(t)).sort()).toEqual(before[t]);
    }
  });

  it('exports transaction:false and a down that drops all three tables', async () => {
    expect(migration.config).toEqual({ transaction: false });
    // Exercise down/up on a scratch schema-free path: only when tables are empty-safe.
    await db(DISMISSALS).where({ tenant }).delete();
    await db(TARGETS).where({ tenant }).delete();
    await db(NOTICES).where({ tenant }).delete();
    await migration.down(db);
    for (const t of Object.keys(EXPECTED_COLUMNS)) {
      expect(await db.schema.hasTable(t)).toBe(false);
    }
    await migration.up(db);
    for (const t of Object.keys(EXPECTED_COLUMNS)) {
      expect(await db.schema.hasTable(t)).toBe(true);
    }
  });
});
