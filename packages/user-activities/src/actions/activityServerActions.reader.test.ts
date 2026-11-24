import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ calls: [] as Array<{ name: string; args: unknown[] }> }));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action({ user_id: 'authenticated-reader', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args),
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: vi.fn(), tenantDb: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('./activityAggregationActions', () => {
  const record = (name: string) => (...args: unknown[]) => {
    state.calls.push({ name, args });
    return Promise.resolve(name === 'fetchUserActivitiesForApi' ? { activities: [], totalCount: 0, pageCount: 0, pageSize: 10, pageNumber: 1 } : []);
  };
  return {
    fetchUserActivitiesForApi: record('fetchUserActivitiesForApi'),
    fetchScheduleActivities: record('fetchScheduleActivities'),
    fetchProjectActivities: record('fetchProjectActivities'),
    fetchTicketActivities: record('fetchTicketActivities'),
    fetchTimeEntryActivities: record('fetchTimeEntryActivities'),
    fetchWorkflowTaskActivities: record('fetchWorkflowTaskActivities'),
    fetchNotificationActivities: record('fetchNotificationActivities'),
    fetchNotificationActivitiesPagedInternal: record('fetchNotificationActivitiesPagedInternal'),
  };
});
vi.mock('./adHocActivityCore', () => ({
  createAdHocActivityForApi: vi.fn(), getAdHocActivityForApi: vi.fn(), updateAdHocActivityForApi: vi.fn(),
  setAdHocActivityDoneForApi: vi.fn(), deleteAdHocActivityForApi: vi.fn(),
}));

import { fetchActivities, fetchProjectActivities } from './activityServerActions';
import { ActivityType } from '@alga-psa/types';

it('carries the authenticated web reader into both shared activity paths', async () => {
  state.calls = [];
  await fetchActivities({ types: [ActivityType.PROJECT_TASK] }, 1, 10);
  await fetchProjectActivities({});

  expect(state.calls.find(({ name }) => name === 'fetchUserActivitiesForApi')?.args[0]).toMatchObject({ user_id: 'authenticated-reader' });
  expect(state.calls.find(({ name }) => name === 'fetchUserActivitiesForApi')?.args[1]).toBe('tenant-1');
  const projectCall = state.calls.find(({ name }) => name === 'fetchProjectActivities');
  expect(projectCall?.args[0]).toBe('authenticated-reader');
  expect(projectCall?.args[1]).toBe('tenant-1');
  expect(projectCall?.args[3]).toMatchObject({ user_id: 'authenticated-reader' });
});
