/**
 * Migration 20261009120100: open time_entries rows become stopwatch sessions.
 * NOTE: plain Postgres only; Citus-specific behaviour is not exercised.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createTenant } from '../../../../test-utils/testDataFactory';
import { createStopwatchUser, seedBucketClient, type BucketSeed } from './stopwatchTestSeed';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const migration = require('../../../../migrations/20261009120100_convert_open_time_entries_to_sessions.cjs');

let db: Knex;
let tenant: string;
let userA: string;
let userB: string;
let bucket: BucketSeed;

async function insertOpenEntry(user: string, startIso: string, notes: string): Promise<string> {
  const entryId = uuidv4();
  await db('time_entries').insert({
    tenant,
    entry_id: entryId,
    user_id: user,
    work_item_type: 'ticket',
    work_item_id: bucket.ticketId,
    service_id: bucket.serviceId,
    start_time: startIso,
    end_time: null,
    billable_duration: 0,
    notes,
    approval_status: 'DRAFT',
    work_date: startIso.slice(0, 10),
    work_timezone: 'UTC',
    created_at: startIso,
    updated_at: startIso,
  });
  return entryId;
}

describe('open time entries -> stopwatch sessions migration', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    // The later end_time NOT NULL migration (20261009140000) has already run on a freshly migrated DB;
    // the legacy open rows this test seeds need the column nullable, as it was when the conversion shipped.
    await db.raw('ALTER TABLE time_entries ALTER COLUMN end_time DROP NOT NULL');
    tenant = await createTenant(db, 'Conversion tenant');
    userA = await createStopwatchUser(db, tenant, 'conv-a');
    userB = await createStopwatchUser(db, tenant, 'conv-b');
    bucket = await seedBucketClient(db, tenant);
  }, 180_000);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  it('is safe with nothing to convert', async () => {
    await expect(migration.up(db)).resolves.not.toThrow();
  });

  it('keeps the newest open row per user as running and discards older duplicates', async () => {
    const oldA = await insertOpenEntry(userA, '2026-10-01T08:00:00.000Z', 'older');
    const newA = await insertOpenEntry(userA, '2026-10-02T08:00:00.000Z', 'newer');
    const onlyB = await insertOpenEntry(userB, '2026-10-03T08:00:00.000Z', 'solo');
    const closed = uuidv4();
    await db('time_entries').insert({
      tenant, entry_id: closed, user_id: userB, work_item_type: 'ticket', work_item_id: bucket.ticketId,
      service_id: bucket.serviceId, start_time: '2026-10-01T08:00:00.000Z', end_time: '2026-10-01T09:00:00.000Z',
      billable_duration: 60, notes: 'closed', approval_status: 'DRAFT', work_date: '2026-10-01', work_timezone: 'UTC',
      created_at: '2026-10-01T09:00:00.000Z', updated_at: '2026-10-01T09:00:00.000Z',
    });

    await migration.up(db);

    const sessions = await db('time_tracking_sessions').where({ tenant }).whereIn('user_id', [userA, userB]).select();
    const byId = new Map(sessions.map((s: any) => [s.session_id, s]));
    expect(byId.get(newA).status).toBe('running');
    expect(byId.get(newA).notes).toBe('newer');
    expect(byId.get(oldA).status).toBe('discarded');
    expect(byId.get(oldA).closed_at).not.toBeNull();
    expect(byId.get(onlyB).status).toBe('running');

    const newSegments = await db('time_tracking_session_segments').where({ tenant, session_id: newA });
    expect(newSegments).toHaveLength(1);
    expect(newSegments[0].ended_at).toBeNull();
    expect(new Date(newSegments[0].started_at).toISOString()).toBe('2026-10-02T08:00:00.000Z');

    const oldSegments = await db('time_tracking_session_segments').where({ tenant, session_id: oldA });
    expect(oldSegments).toHaveLength(1);
    expect(new Date(oldSegments[0].ended_at).getTime()).toBe(new Date(oldSegments[0].started_at).getTime());

    expect(await db('time_entries').where({ tenant }).whereIn('user_id', [userA, userB]).whereNull('end_time')).toHaveLength(0);
    expect(await db('time_entries').where({ tenant, entry_id: closed })).toHaveLength(1);

    // Second run changes nothing.
    await migration.up(db);
    expect(await db('time_tracking_sessions').where({ tenant }).whereIn('user_id', [userA, userB])).toHaveLength(3);
  });

  it('discards a legacy row when the user already has an open session', async () => {
    const user = await createStopwatchUser(db, tenant, 'conv-c');
    const existing = uuidv4();
    await db('time_tracking_sessions').insert({
      tenant, session_id: existing, user_id: user, work_item_type: 'ticket', work_item_id: bucket.ticketId,
      notes: '', status: 'running',
    });
    const legacy = await insertOpenEntry(user, '2026-10-04T08:00:00.000Z', 'legacy');
    await migration.up(db);
    const rows = await db('time_tracking_sessions').where({ tenant, user_id: user });
    expect(rows.find((r: any) => r.session_id === existing).status).toBe('running');
    expect(rows.find((r: any) => r.session_id === legacy).status).toBe('discarded');
  });
});
