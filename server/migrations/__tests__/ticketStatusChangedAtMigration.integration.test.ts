import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../test-utils/dbConfig';

const require = createRequire(import.meta.url);
const MIGRATIONS_DIR = path.resolve(__dirname, '..');
const MIGRATION_FILE = '20261005120000_add_status_changed_at_to_tickets.cjs';
const MIGRATION = require(path.join(MIGRATIONS_DIR, MIGRATION_FILE));
const DB_NAME = 'test_db_status_changed_at_migration';

const tenant = randomUUID();
const status = randomUUID();
const otherStatus = randomUUID();
const ids = { audit: randomUUID(), auditOld: randomUUID(), fallback: randomUUID(), wrongStatus: randomUUID() };
let db: Knex;
let scratchMigrationsDir: string;
let scratchSeedsDir: string;

beforeAll(async () => {
  wireLocalTestDbEnv();
  scratchMigrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-changed-at-migrations-'));
  scratchSeedsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-changed-at-seeds-'));
  // Minimal pre-migration shape: tickets has entered_at but no created_at and no status_changed_at.
  fs.writeFileSync(path.join(scratchMigrationsDir, '20261005110000_status_changed_at_fixture.cjs'), `exports.up = async (knex) => {
    await knex.schema.createTable('tenants', t => { t.uuid('tenant').primary(); });
    await knex.schema.createTable('tickets', t => {
      t.uuid('tenant').notNullable(); t.uuid('ticket_id').notNullable(); t.uuid('status_id');
      t.timestamp('entered_at', { useTz: true }); t.primary(['tenant', 'ticket_id']);
    });
    await knex.schema.createTable('ticket_audit_logs', t => {
      t.uuid('tenant').notNullable(); t.uuid('log_id').defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('ticket_id').notNullable(); t.timestamp('occurred_at', { useTz: true }).notNullable(); t.jsonb('changes');
    });
    const tenant = ${JSON.stringify(tenant)}, status = ${JSON.stringify(status)}, other = ${JSON.stringify(otherStatus)};
    await knex('tenants').insert({ tenant });
    await knex('tickets').insert([
      { tenant, ticket_id: ${JSON.stringify(ids.audit)}, status_id: status, entered_at: '2026-01-01T00:00:00Z' },
      { tenant, ticket_id: ${JSON.stringify(ids.auditOld)}, status_id: status, entered_at: '2026-01-01T00:00:00Z' },
      { tenant, ticket_id: ${JSON.stringify(ids.fallback)}, status_id: status, entered_at: '2026-02-03T04:05:06Z' },
      { tenant, ticket_id: ${JSON.stringify(ids.wrongStatus)}, status_id: status, entered_at: '2026-03-03T00:00:00Z' },
    ]);
    const log = (ticket_id, occurred_at, changes) => ({ tenant, ticket_id, occurred_at, changes: JSON.stringify(changes) });
    await knex('ticket_audit_logs').insert([
      // Two moves into the current status: the latest one is the current stay.
      log(${JSON.stringify(ids.audit)}, '2026-06-01T10:00:00Z', { status_id: { old: other, new: status } }),
      log(${JSON.stringify(ids.audit)}, '2026-04-01T10:00:00Z', { status_id: { old: status, new: other } }),
      log(${JSON.stringify(ids.audit)}, '2026-05-01T10:00:00Z', { status_id: { old: other, new: status } }),
      log(${JSON.stringify(ids.auditOld)}, '2026-05-01T10:00:00Z', { status_id: { old: status, new: other } }), // moved away, not into
      log(${JSON.stringify(ids.wrongStatus)}, '2026-05-02T10:00:00Z', { title: { old: 'a', new: 'b' } }),   // no status diff
    ]);
  };
  exports.down = async (knex) => { for (const t of ['ticket_audit_logs', 'tickets', 'tenants']) await knex.schema.dropTableIfExists(t); };
`);
  fs.writeFileSync(path.join(scratchMigrationsDir, MIGRATION_FILE), `module.exports = require(${JSON.stringify(path.join(MIGRATIONS_DIR, MIGRATION_FILE))});\n`);
  db = await createTestDbConnection({ databaseName: DB_NAME, migrationsDir: scratchMigrationsDir, seedsDir: scratchSeedsDir, runSeeds: false });
}, 300_000);

afterAll(async () => {
  await db?.destroy().catch(() => undefined);
  if (scratchMigrationsDir) fs.rmSync(scratchMigrationsDir, { recursive: true, force: true });
  if (scratchSeedsDir) fs.rmSync(scratchSeedsDir, { recursive: true, force: true });
});

const iso = (value: Date | string | null) => (value ? new Date(value).toISOString() : null);
const changedAt = async (ticketId: string) => iso((await db('tickets').where({ tenant, ticket_id: ticketId }).first('status_changed_at')).status_changed_at);

describe('tickets.status_changed_at migration', () => {
  it('backfills from the latest audit-log move into the current status', async () => {
    expect(await changedAt(ids.audit)).toBe('2026-06-01T10:00:00.000Z');
  });

  it('falls back to entered_at when the audit log has no move into the current status', async () => {
    expect(await changedAt(ids.fallback)).toBe('2026-02-03T04:05:06.000Z');
    expect(await changedAt(ids.auditOld)).toBe('2026-01-01T00:00:00.000Z');
    expect(await changedAt(ids.wrongStatus)).toBe('2026-03-03T00:00:00.000Z');
  });

  it('uses the supplied timestamp when neither source has a value, and leaves set values alone on re-run', async () => {
    const orphan = randomUUID();
    await db('tickets').insert({ tenant, ticket_id: orphan, status_id: status, entered_at: null, status_changed_at: null });
    const updated = await MIGRATION.backfillTicketStatusChangedAt(db, '2026-10-01T00:00:00.000Z');
    expect(updated).toBe(1);
    expect(await changedAt(orphan)).toBe('2026-10-01T00:00:00.000Z');
    expect(await changedAt(ids.audit)).toBe('2026-06-01T10:00:00.000Z');
  });

  it('stamps new inserts through the column default and creates the scan index', async () => {
    const fresh = randomUUID();
    await db('tickets').insert({ tenant, ticket_id: fresh, status_id: status });
    expect(await changedAt(fresh)).not.toBeNull();
    const idx = await db.raw("SELECT 1 FROM pg_indexes WHERE tablename = 'tickets' AND indexname = 'idx_tickets_tenant_status_status_changed_at'");
    expect(idx.rows).toHaveLength(1);
  });

  it('down removes the column and the index, and up can run again', async () => {
    await MIGRATION.down(db);
    expect(await db.schema.hasColumn('tickets', 'status_changed_at')).toBe(false);
    const idx = await db.raw("SELECT 1 FROM pg_indexes WHERE indexname = 'idx_tickets_tenant_status_status_changed_at'");
    expect(idx.rows).toHaveLength(0);
    await MIGRATION.up(db);
    expect(await db.schema.hasColumn('tickets', 'status_changed_at')).toBe(true);
    expect(await changedAt(ids.audit)).toBe('2026-06-01T10:00:00.000Z');
  });
});
