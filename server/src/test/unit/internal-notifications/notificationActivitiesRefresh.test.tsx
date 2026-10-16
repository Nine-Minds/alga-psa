/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ActivityType } from '@alga-psa/types';
const mocks = vi.hoisted(() => ({
  fetch: vi.fn(), feed: vi.fn(), paged: vi.fn(), session: { user: { tenant: 'home', id: 'user' } },
  snapshot: { notifications: [] as any[], unreadCount: 1 },
  t: (_key: string, options: any) => options?.defaultValue ?? _key,
}));
vi.mock('../../../../../packages/user-activities/src/actions/activityServerActions', () => ({ fetchActivities: mocks.fetch }));
vi.mock('@alga-psa/user-activities/actions', () => ({ fetchNotificationActivities: mocks.feed, fetchNotificationActivitiesPaged: mocks.paged }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: mocks.session }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => null }));
vi.mock('@alga-psa/notifications/hooks', () => ({ useInternalNotifications: () => mocks.snapshot }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: vi.fn() }));
vi.mock('../../../../../packages/user-activities/src/components/ActivityDrawerProvider', () => ({ useActivityDrawer: () => ({ openActivityDrawer: vi.fn() }) }));
vi.mock('../../../../../packages/user-activities/src/components/NotificationCard', () => ({ NotificationCard: ({ activity }: any) => <div>{activity.message}</div> }));
vi.mock('../../../../../packages/user-activities/src/components/filters/NotificationSectionFiltersDialog', () => ({ NotificationSectionFiltersDialog: () => null }));
vi.mock('@alga-psa/ui/components/CustomTabs', () => ({ default: ({ tabs }: any) => tabs[0].content }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, onClick, disabled, id }: any) => <button id={id} onClick={onClick} disabled={disabled}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Badge', () => ({ Badge: ({ children }: any) => <span>{children}</span> }));
vi.mock('@alga-psa/ui/components/Card', () => ({ Card: ({ children }: any) => <div>{children}</div>, CardContent: ({ children }: any) => <div>{children}</div>, CardHeader: () => null, CardTitle: () => null }));
vi.mock('@alga-psa/ui/components/Pagination', () => ({ default: () => null }));
import { useActivitiesCache } from '../../../../../packages/user-activities/src/hooks/useActivitiesCache';
import { NotificationsSection } from '../../../../../packages/user-activities/src/components/NotificationsSection';
const activity = (message: string) => ({ id: message, message, createdAt: '2026-01-01T00:00:00Z' });
beforeEach(() => {
  mocks.fetch.mockReset(); mocks.feed.mockReset().mockResolvedValue([activity('Current shared activity')]); mocks.paged.mockReset();
  mocks.snapshot = { notifications: [{ id: 'same-notification' }], unreadCount: 1 };
  mocks.session = { user: { tenant: 'home', id: 'user' } };
});
afterEach(cleanup);

it('revalidates notification-inclusive activity queries while retaining caching for explicitly local types', async () => {
  const response = (message: string) => ({ activities: [activity(message)], totalCount: 1, pageCount: 1, pageSize: 5, pageNumber: 1 });
  mocks.fetch.mockResolvedValue(response('Before revocation'));
  const { result } = renderHook(() => useActivitiesCache());
  for (const filters of [{}, { types: [ActivityType.NOTIFICATION] }]) {
    await act(async () => { await result.current.getActivities(filters, 1, 5); });
    mocks.fetch.mockResolvedValue({ ...response(''), activities: [], totalCount: 0 });
    await act(async () => { expect((await result.current.getActivities(filters, 1, 5)).activities).toEqual([]); });
    mocks.fetch.mockResolvedValue(response('Before revocation'));
  }
  expect(mocks.fetch).toHaveBeenCalledTimes(4);
  const local = { types: [ActivityType.TIME_ENTRY] };
  await act(async () => { await result.current.getActivities(local, 1, 5); });
  await act(async () => { await result.current.getActivities(local, 1, 5); });
  expect(mocks.fetch).toHaveBeenCalledTimes(5);
});

it('refreshes notification activity text when the authorized snapshot changes but counts do not', async () => {
  const view = render(<NotificationsSection noCard />);
  await screen.findByText('Current shared activity');
  mocks.feed.mockResolvedValue([activity('Redacted activity')]);
  mocks.snapshot = { notifications: [{ id: 'same-notification' }], unreadCount: 1 };
  view.rerender(<NotificationsSection noCard />);
  await screen.findByText('Redacted activity');
  expect(screen.queryByText('Current shared activity')).toBeNull();
  mocks.feed.mockRejectedValue(new Error('Access check failed'));
  mocks.snapshot = { notifications: [{ id: 'same-notification' }], unreadCount: 1 };
  view.rerender(<NotificationsSection noCard />);
  await screen.findByText('Failed to load notification activities. Please try again later.');
  expect(screen.queryByText('Redacted activity')).toBeNull();
});

it('does not let a delayed previous-user feed restore its content after an identity change', async () => {
  let finish!: (value: any) => void;
  mocks.feed.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<NotificationsSection noCard />);
  await waitFor(() => expect(mocks.feed).toHaveBeenCalledTimes(1));
  mocks.session = { user: { tenant: 'home', id: 'other-user' } };
  mocks.feed.mockResolvedValue([activity('New user activity')]);
  view.rerender(<NotificationsSection noCard />);
  await screen.findByText('New user activity');
  await act(async () => { finish([activity('Previous user secret')]); });
  expect(screen.queryByText('Previous user secret')).toBeNull();
  expect(screen.getByText('New user activity')).toBeTruthy();
});
