import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createTestService } from '../../e2e/utils/timeEntryTestDataFactory';
import { TimeEntryService } from '../../../lib/api/services/TimeEntryService';
import { timeEntryResponseSchema } from '../../../lib/api/schemas/timeEntry';

let db: Knex;
let context: { tenant: string; userId: string; user: { user_id: string; user_type: string; tenant: string } };
let serviceId: string;
let service: TimeEntryService;

beforeAll(async () => {
  db = await createTestDbConnection();
  const tenant = await db('tenants').first<{ tenant: string }>('tenant');
  const userId = randomUUID();
  context = {
    tenant: tenant!.tenant, userId,
    user: { user_id: userId, user_type: 'internal', tenant: tenant!.tenant },
  };
  await db('users').insert({
    tenant: context.tenant, user_id: context.userId, username: `date-${context.userId}`,
    email: `${context.userId}@example.test`, first_name: 'Date', last_name: 'Test',
    hashed_password: 'api-only-test-user', user_type: 'internal', timezone: 'America/Los_Angeles',
  });
  // The legacy active-session read enforces time_entry:read, so the caller needs a real grant.
  const roleId = randomUUID();
  const permissionId = randomUUID();
  await db('roles').insert({
    tenant: context.tenant, role_id: roleId, role_name: `Date Test ${roleId.slice(0, 8)}`, msp: true, client: false,
  });
  await db('user_roles').insert({ tenant: context.tenant, user_id: context.userId, role_id: roleId });
  await db('permissions').insert({
    tenant: context.tenant, permission_id: permissionId, resource: 'time_entry', action: 'read', msp: true, client: false,
  });
  await db('role_permissions').insert({ tenant: context.tenant, role_id: roleId, permission_id: permissionId });
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

      const started = await service.startTimeTracking({ work_item_type: 'ad_hoc', service_id: serviceId }, context);
      const active = await service.getActiveSession(context.userId, context);
      const dateSchema = timeEntryResponseSchema.pick({ work_date: true });
      expect.soft(dateSchema.safeParse(started).success, 'start timer date contract').toBe(true);
      expect.soft(dateSchema.safeParse(active).success, 'active timer date contract').toBe(true);
      expect.soft(started.work_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect.soft(active?.work_date).toBe(started.work_date);
    } finally {
      // Timer sessions live in time_tracking_sessions (segments cascade); clear them so the
      // next timezone case can start a fresh session.
      await db('time_tracking_sessions').where({ tenant: context.tenant, user_id: context.userId }).delete();
      await db('time_entries').where({ tenant: context.tenant, user_id: context.userId }).delete();
    }
  },
);
