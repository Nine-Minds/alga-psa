/**
 * Migration 20261009140000: time_entries.end_time is NOT NULL again (plan D8).
 * NOTE: plain Postgres only. The Citus branch (run_command_on_shards + pg_attribute sync) is not exercised.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createTenant } from '../../../../test-utils/testDataFactory';
import { createStopwatchUser, seedBucketClient, type BucketSeed } from './stopwatchTestSeed';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const migration = require('../../../../migrations/20261009140000_time_entries_end_time_not_null.cjs');

let db: Knex;
let tenant: string;
let user: string;
let bucket: BucketSeed;

async function endTimeIsNotNull(): Promise<boolean> {
  const r = await db.raw(
    `SELECT attnotnull FROM pg_attribute WHERE attrelid = 'time_entries'::regclass AND attname = 'end_time'`,
  );
  return r.rows[0].attnotnull === true;
}

async function insertOpenEntry(): Promise<string> {
  const entryId = uuidv4();
  await db('time_entries').insert({
    tenant, entry_id: entryId, user_id: user, work_item_type: 'ticket', work_item_id: bucket.ticketId,
    service_id: bucket.serviceId, start_time: '2026-10-01T08:00:00.000Z', end_time: null, billable_duration: 0,
    notes: 'open', approval_status: 'DRAFT', work_date: '2026-10-01', work_timezone: 'UTC',
    created_at: '2026-10-01T08:00:00.000Z', updated_at: '2026-10-01T08:00:00.000Z',
  });
  return entryId;
}

describe('time_entries end_time NOT NULL migration', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    tenant = await createTenant(db, 'EndTime tenant');
    user = await createStopwatchUser(db, tenant, 'endtime');
    bucket = await seedBucketClient(db, tenant);
  }, 180_000);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  it('is already applied on a migrated database and is idempotent', async () => {
    expect(await endTimeIsNotNull()).toBe(true);
    await expect(migration.up(db)).resolves.not.toThrow();
    expect(await endTimeIsNotNull()).toBe(true);
  });

  it('rejects open rows once applied', async () => {
    await expect(insertOpenEntry()).rejects.toThrow(/end_time/);
  });

  it('down relaxes the column, up refuses while an open row exists, and succeeds once it is gone', async () => {
    await migration.down(db);
    expect(await endTimeIsNotNull()).toBe(false);

    const entryId = await insertOpenEntry();
    await expect(migration.up(db)).rejects.toThrow(/1 open time entry/);
    expect(await endTimeIsNotNull()).toBe(false);
    // No data was touched.
    expect(await db('time_entries').where({ tenant, entry_id: entryId }).whereNull('end_time')).toHaveLength(1);

    await db('time_entries').where({ tenant, entry_id: entryId }).del();
    await migration.up(db);
    expect(await endTimeIsNotNull()).toBe(true);
  });
});
