import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createTestService } from '../../e2e/utils/timeEntryTestDataFactory';
import { TimeEntryService } from '../../../lib/api/services/TimeEntryService';
import { timeEntryResponseSchema } from '../../../lib/api/schemas/timeEntry';

let db: Knex;
let context: { tenant: string; userId: string; apiKeyId: string; user: Record<string, unknown> };
let serviceId: string;
let service: TimeEntryService;

beforeAll(async () => {
  db = await createTestDbConnection();
  const tenant = await db('tenants').first<{ tenant: string }>('tenant');
  const userId = randomUUID();
  const userRow = {
    tenant: tenant!.tenant, user_id: userId, username: `date-${userId}`,
    email: `${userId}@example.test`, first_name: 'Date', last_name: 'Test',
    hashed_password: 'api-only-test-user', user_type: 'internal', timezone: 'America/Los_Angeles',
  };
  await db('users').insert(userRow);
  // The timer paths authorize through an API-key actor (see TimeEntryService.timeActor and
  // lockCoManagedLocalAuthentication): this service is only reachable from
  // ApiTimeEntryController, whose context is built by buildAuthenticatedApiContext and
  // therefore always carries apiKeyId, the resolved user, and a live api_keys row that the
  // timer re-locks and re-checks around the write. A bare { tenant, userId } context is not
  // a shape production can produce, so the fixture supplies the real credential.
  const apiKeyId = randomUUID();
  await db('api_keys').insert({
    api_key_id: apiKeyId, api_key: `work-date-test-${apiKeyId}`, user_id: userId,
    tenant: tenant!.tenant, description: 'timeEntryWorkDateResponse fixture', active: true, expires_at: null,
  });
  // The timer admits its source against the caller's own permissions, so an MSP user with
  // no roles is denied before any date logic runs. Production API users carry a role.
  const adminRole = await db('roles').where({ tenant: tenant!.tenant, role_name: 'Admin', msp: true }).first('role_id');
  await db('user_roles').insert({ tenant: tenant!.tenant, user_id: userId, role_id: adminRole!.role_id });
  context = { tenant: tenant!.tenant, userId, apiKeyId, user: userRow };
  serviceId = (await createTestService(db, context.tenant)).service_id;
  service = new TimeEntryService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: context.tenant });
});

afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { await db?.destroy(); });

it.each(['UTC', 'Pacific/Auckland', 'America/Los_Angeles'])(
  'keeps date-only responses across reads and timer sessions when the Node timezone is %s', async (timezone) => {
    vi.stubEnv('TZ', timezone);
    const entryId = randomUUID();
    const notes = `date response ${entryId}`;
    await db('time_entries').insert({
      tenant: context.tenant, entry_id: entryId, user_id: context.userId,
      work_item_type: 'ad_hoc', work_item_id: null, service_id: serviceId,
      start_time: '2024-07-02T06:30:00Z', end_time: '2024-07-02T07:30:00Z',
      work_date: '2024-07-01', work_timezone: 'America/Los_Angeles',
      billable_duration: 60, approval_status: 'DRAFT', notes,
    });

    try {
      const get = await service.getById(entryId, context);
      const list = await service.list({ filters: { user_id: context.userId } }, context);
      const search = await service.searchTimeEntries({ query: notes }, context);
      const directSearch = await service.search({ query: notes }, context);
      const exported = await service.exportTimeEntries({ format: 'json' }, context);
      for (const [route, row] of [
        ['get', get], ['list', list.data.find((entry) => entry.entry_id === entryId)],
        ['search', search.data.find((entry) => entry.entry_id === entryId)],
        ['direct search', directSearch.find((entry) => entry.entry_id === entryId)],
        ['export', (exported as any[]).find((entry) => entry.entry_id === entryId)],
      ] as const) {
        expect.soft(row?.work_date, route).toBe('2024-07-01');
        expect.soft(row?.work_timezone, route).toBe('America/Los_Angeles');
      }

      // An `ad_hoc` work item names a schedule entry, and the timer admits the source
      // before it clocks in (admitNativeTimeAccess), so it must be a real assigned entry.
      // The bare `{ work_item_type: 'ad_hoc' }` this test used before is not a shape the
      // API accepts: startTimeTrackingSchema leaves work_item_id optional for
      // `non_billable_category`, which is how a work-item-less timer is expressed.
      const scheduleEntryId = randomUUID();
      await db('schedule_entries').insert({
        tenant: context.tenant, entry_id: scheduleEntryId, title: 'work-date timer',
        work_item_type: 'ad_hoc', status: 'scheduled',
        scheduled_start: '2024-07-02T06:30:00Z', scheduled_end: '2024-07-02T07:30:00Z',
      });
      await db('schedule_entry_assignees').insert({ tenant: context.tenant, entry_id: scheduleEntryId, user_id: context.userId });
      const started = await service.startTimeTracking({ work_item_type: 'ad_hoc', work_item_id: scheduleEntryId, service_id: serviceId }, context);
      const active = await service.getActiveSession(context.userId, context);
      const dateSchema = timeEntryResponseSchema.pick({ work_date: true });
      expect.soft(dateSchema.safeParse(started).success, 'start timer date contract').toBe(true);
      expect.soft(dateSchema.safeParse(active).success, 'active timer date contract').toBe(true);
      expect.soft(started.work_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect.soft(active?.work_date).toBe(started.work_date);
    } finally {
      await db('time_entries').where({ tenant: context.tenant, user_id: context.userId }).delete();
      await db('native_time_tracking_sessions').where({ tenant: context.tenant, user_id: context.userId }).delete();
      await db('schedule_entry_assignees').where({ tenant: context.tenant, user_id: context.userId }).delete();
      await db('schedule_entries').where({ tenant: context.tenant, work_item_type: 'ad_hoc' }).whereLike('title', 'work-date timer').delete();
    }
  },
);
