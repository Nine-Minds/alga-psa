import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import path from 'node:path';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../../test-utils/dbConfig.ts';

/**
 * The cleanup migration against the real schema.
 *
 * Its companion unit test checks the logic against an in-memory knex; this one
 * runs the same `up()` on a migrated database, which is the only place a wrong
 * column or an unsupported predicate (the `~` instance-id regex, the
 * tenant-scoped joins) would show up before production.
 */

const migration = require(path.resolve(
  __dirname,
  '../../../../migrations/20261105120000_cleanup_calendar_recurring_instance_imports.cjs'
));

const MASTER_ID = '2ppb6f3ftc40nggeoqtsoh743g';

let db: Knex;
const tenantId = uuidv4();
const providerId = uuidv4();
const userId = uuidv4();

type Seeded = { entryId: string; externalEventId: string; mappingId: string };

async function seedEntry(input: {
  externalEventId: string;
  isRecurring?: boolean;
  originalEntryId?: string | null;
  title?: string;
  occurrenceIndex?: Record<string, string>;
}): Promise<Seeded> {
  const entryId = uuidv4();
  const mappingId = uuidv4();
  await db('schedule_entries').insert({
    entry_id: entryId,
    tenant: tenantId,
    title: input.title ?? 'Go over advisories in Git @alga',
    scheduled_start: new Date('2026-11-05T15:15:00Z'),
    scheduled_end: new Date('2026-11-05T15:45:00Z'),
    status: 'scheduled',
    work_item_type: 'ad_hoc',
    work_item_id: null,
    is_recurring: input.isRecurring ?? false,
    original_entry_id: input.originalEntryId ?? null,
    created_at: new Date(),
    updated_at: new Date(),
  });
  await db('schedule_entry_assignees').insert({
    tenant: tenantId, entry_id: entryId, user_id: userId, created_at: new Date(), updated_at: new Date(),
  });
  await db('calendar_event_mappings').insert({
    id: mappingId,
    tenant: tenantId,
    calendar_provider_id: providerId,
    schedule_entry_id: entryId,
    external_event_id: input.externalEventId,
    sync_status: 'synced',
    sync_direction: 'from_external',
    // Written as a plain object, exactly the shape CalendarSyncService hands to
    // knex for this jsonb column, so the column accepts the production write.
    occurrence_index: input.occurrenceIndex ?? null,
    created_at: new Date(),
    updated_at: new Date(),
  });
  return { entryId, externalEventId: input.externalEventId, mappingId };
}

beforeAll(async () => {
  db = await createTestDbConnection();
  await db('tenants').insert({
    tenant: tenantId, client_name: 'Calendar cleanup tenant', email: 'cleanup@example.test',
    created_at: new Date(), updated_at: new Date(),
  }).onConflict('tenant').ignore();
  await db('users').insert({
    tenant: tenantId, user_id: userId, username: 'cleanup-tech', email: 'tech@example.test',
    hashed_password: 'x', first_name: 'Clean', last_name: 'Up', user_type: 'internal',
    created_at: new Date(), updated_at: new Date(),
  }).onConflict(['tenant', 'user_id']).ignore();
});

afterAll(async () => {
  if (!db) return;
  await db('calendar_event_mappings').where({ tenant: tenantId }).del();
  await db('time_entries').where({ tenant: tenantId }).del();
  await db('schedule_entry_assignees').where({ tenant: tenantId }).del();
  await db('schedule_entries').where({ tenant: tenantId }).del();
  await db('google_calendar_provider_config').where({ tenant: tenantId }).del();
  await db('calendar_providers').where({ tenant: tenantId }).del();
  await db('users').where({ tenant: tenantId }).del();
  await db('tenants').where({ tenant: tenantId }).del();
  await db.destroy();
});

beforeEach(async () => {
  await db('calendar_event_mappings').where({ tenant: tenantId }).del();
  await db('time_entries').where({ tenant: tenantId }).del();
  await db('schedule_entry_assignees').where({ tenant: tenantId }).del();
  await db('schedule_entries').where({ tenant: tenantId }).del();
  await db('google_calendar_provider_config').where({ tenant: tenantId }).del();
  await db('calendar_providers').where({ tenant: tenantId }).del();
  await db('calendar_providers').insert({
    id: providerId, tenant: tenantId, provider_type: 'google', provider_name: 'Google',
    calendar_id: 'primary', status: 'connected', is_active: true, vendor_config: {},
    created_at: new Date(), updated_at: new Date(),
  });
  await db('google_calendar_provider_config').insert({
    tenant: tenantId, calendar_provider_id: providerId, client_id: 'client', client_secret: 'secret',
    project_id: 'project', redirect_uri: 'http://localhost/callback', calendar_id: 'primary',
    sync_token: 'stale-sync-token', created_at: new Date(), updated_at: new Date(),
  });
});

describe('cleanup_calendar_recurring_instance_imports against the real schema', () => {
  it('deletes instance-style imports, keeps the rest, and clears the sync token', async () => {
    const timed = await seedEntry({ externalEventId: `${MASTER_ID}_20261105T151500Z` });
    const allDay = await seedEntry({ externalEventId: `${MASTER_ID}_20261105` });
    // A master mapping is keyed by the bare id, and a split master only looks
    // like an instance. The override is seeded exactly as the fixed code writes
    // one — ScheduleEntry.update(…, SINGLE) stores it standalone, so it has the
    // same shape as a pre-fix instance import and is told apart only by the
    // master listing its id in occurrence_index.
    const overrideExternalId = `${MASTER_ID}_20261203T151500Z`;
    const master = await seedEntry({
      externalEventId: MASTER_ID,
      isRecurring: true,
      occurrenceIndex: { [overrideExternalId]: '2026-12-03T15:15:00.000Z' },
    });
    const override = await seedEntry({
      externalEventId: overrideExternalId,
      originalEntryId: null,
    });
    const split = await seedEntry({ externalEventId: `${MASTER_ID}_R20261105T151500Z` });
    // An entry a time entry was logged against must survive, with its mapping.
    const billed = await seedEntry({ externalEventId: `${MASTER_ID}_20270107T151500Z` });
    await db('time_entries').insert({
      entry_id: uuidv4(), tenant: tenantId, user_id: userId,
      work_item_id: billed.entryId, work_item_type: 'ad_hoc',
      start_time: new Date('2027-01-07T15:15:00Z'), end_time: new Date('2027-01-07T15:45:00Z'),
      work_date: '2027-01-07', billable_duration: 30, approval_status: 'DRAFT',
      work_timezone: 'America/New_York',
      created_at: new Date(), updated_at: new Date(),
    });

    await migration.up(db);

    const remainingEntries = await db('schedule_entries').where({ tenant: tenantId }).pluck('entry_id');
    expect(remainingEntries.sort()).toEqual([master.entryId, override.entryId, split.entryId, billed.entryId].sort());
    expect(remainingEntries).not.toContain(timed.entryId);
    expect(remainingEntries).not.toContain(allDay.entryId);

    const remainingMappings = await db('calendar_event_mappings').where({ tenant: tenantId }).pluck('external_event_id');
    expect(remainingMappings.sort()).toEqual([
      MASTER_ID, override.externalEventId, split.externalEventId, billed.externalEventId,
    ].sort());

    const assignees = await db('schedule_entry_assignees').where({ tenant: tenantId }).pluck('entry_id');
    expect(assignees).not.toContain(timed.entryId);
    expect(assignees).toContain(master.entryId);

    // The occurrence index survives as an object, not a JSON string: the
    // master-delete sweep reads it back to find the children it spawned.
    const masterMapping = await db('calendar_event_mappings')
      .where({ tenant: tenantId, external_event_id: MASTER_ID }).first();
    expect(masterMapping.occurrence_index).toEqual({ [overrideExternalId]: '2026-12-03T15:15:00.000Z' });

    // The next webhook must perform a full list so the fixed code re-imports
    // the series as one recurring entry.
    const config = await db('google_calendar_provider_config')
      .where({ tenant: tenantId, calendar_provider_id: providerId }).first();
    expect(config.sync_token).toBeNull();
  });

  it('is a no-op on a second run and leaves a clean provider alone', async () => {
    const master = await seedEntry({ externalEventId: MASTER_ID, isRecurring: true });

    await migration.up(db);
    await migration.up(db);

    expect(await db('schedule_entries').where({ tenant: tenantId }).pluck('entry_id')).toEqual([master.entryId]);
    const config = await db('google_calendar_provider_config')
      .where({ tenant: tenantId, calendar_provider_id: providerId }).first();
    // Nothing was deleted for this provider, so its token is left in place.
    expect(config.sync_token).toBe('stale-sync-token');
  });
});
