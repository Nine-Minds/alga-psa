import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../../test-utils/dbConfig.ts';
import ScheduleEntry from '@alga-psa/shared/models/scheduleEntry';
import { tenantDb } from '@alga-psa/db';

const fixture = vi.hoisted(() => ({
  db: null as Knex | null,
  tenant: '',
  userId: '',
  publishEvent: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/db')>(),
  createTenantKnex: async () => ({ knex: fixture.db, tenant: fixture.tenant }),
}));

vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/auth')>(),
  withAuth: (action: any) => (...args: any[]) => action(
    { user_id: fixture.userId, user_type: 'internal' },
    { tenant: fixture.tenant },
    ...args,
  ),
  hasPermission: async (_user: any, resource: string, action: string) =>
    resource === 'user_schedule' && (action === 'read' || action === 'update'),
}));

vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/event-bus/publishers')>(),
  publishEvent: fixture.publishEvent,
}));

import { archiveGroupCalendar, restoreGroupCalendar } from '@alga-psa/scheduling/actions/calendarSharingActions';

describe('group calendar archive actions', () => {
  const tenant = uuidv4();
  const managerId = uuidv4();
  const assigneeA = uuidv4();
  const assigneeB = uuidv4();
  const calendarId = uuidv4();
  let db: Knex;

  const scoped = (table: string) => tenantDb(db, tenant).table(table);

  async function seedUser(userId: string) {
    await scoped('users').insert({
      tenant, user_id: userId, username: `archive-${userId.slice(0, 6)}`,
      email: `${userId}@example.test`, user_type: 'internal', hashed_password: 'not-used',
      created_at: new Date(), updated_at: new Date(),
    }).onConflict(['tenant', 'user_id']).ignore();
  }

  beforeAll(async () => {
    db = await createTestDbConnection({ recreate: false });
    fixture.db = db;
    fixture.tenant = tenant;
    fixture.userId = managerId;
    await db('tenants').insert({ tenant, client_name: 'Group Calendar Archive Test', email: `${tenant}@example.test`, created_at: new Date(), updated_at: new Date() }).onConflict('tenant').ignore();
    await Promise.all([seedUser(managerId), seedUser(assigneeA), seedUser(assigneeB)]);
  });

  afterAll(async () => {
    await tenantDb(db, tenant).table('schedule_entry_assignees').del();
    await tenantDb(db, tenant).table('schedule_entries').del();
    await tenantDb(db, tenant).table('calendar_shares').del();
    await tenantDb(db, tenant).table('calendars').del();
    await tenantDb(db, tenant).table('users').del();
    await tenantDb(db, tenant).unscoped('tenants', 'remove isolated group calendar archive test tenant').where({ tenant }).del();
    await db.destroy();
  });

  it('archives and restores a group calendar and publishes real assignees for every entry', async () => {
    await scoped('calendars').insert({
      tenant, calendar_id: calendarId, calendar_type: 'group', name: 'Archive action test',
      is_archived: false, created_at: new Date(), updated_at: new Date(),
    });
    await scoped('calendar_shares').insert({
      tenant, calendar_id: calendarId, grantee_type: 'user', grantee_id: managerId,
      access_level: 'manage', created_by: managerId,
    });
    const common = {
      title: 'Archive test entry', notes: null, scheduled_start: new Date('2026-09-01T10:00:00Z'),
      scheduled_end: new Date('2026-09-01T11:00:00Z'), status: 'scheduled', work_item_type: 'ad_hoc',
      calendar_id: calendarId,
    };
    const assignedEntry = await ScheduleEntry.create(db, tenant, common as any, { assignedUserIds: [assigneeA, assigneeB] });
    const unassignedEntry = await ScheduleEntry.create(db, tenant, { ...common, title: 'Unassigned entry' } as any, { assignedUserIds: [] });
    const expected = new Map([[assignedEntry.entry_id, [assigneeA, assigneeB]], [unassignedEntry.entry_id, [] as string[]]]);

    async function assertTransition(action: (id: string) => Promise<any>, archived: boolean) {
      fixture.publishEvent.mockClear();
      const result = await action(calendarId);
      expect(result).toMatchObject({ success: true });
      const calendar = await scoped('calendars').where({ calendar_id: calendarId }).first();
      expect(calendar.is_archived).toBe(archived);
      expect(fixture.publishEvent).toHaveBeenCalledTimes(expected.size);
      const events = fixture.publishEvent.mock.calls.map(([event]: any[]) => event);
      expect(events.map((event: any) => event.payload.entryId).sort()).toEqual([...expected.keys()].sort());
      for (const event of events) {
        expect(event.eventType).toBe('SCHEDULE_ENTRY_UPDATED');
        const ids = expected.get(event.payload.entryId)!;
        expect(event.payload.changes.before.assignedUserIds.slice().sort()).toEqual(ids.slice().sort());
        expect(event.payload.changes.after.assignedUserIds.slice().sort()).toEqual(ids.slice().sort());
        expect(event.payload.changes.calendarArchived).toBe(archived);
      }
    }

    await assertTransition(archiveGroupCalendar, true);
    await assertTransition(restoreGroupCalendar, false);
  });
});
