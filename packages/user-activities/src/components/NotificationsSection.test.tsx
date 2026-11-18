/* @vitest-environment jsdom */
/**
 * Notification filters are inline in the card (category, priority, date range, clear), in
 * preview AND full mode, and there is no filter dialog or header Filter/Reset button.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ActivityPriority } from '@alga-psa/types';

const mocks = vi.hoisted(() => ({
  fetchNotificationActivities: vi.fn(),
  fetchNotificationActivitiesPaged: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { tenant: 't', id: 'u' } } }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_k: string, o: any) => o?.defaultValue ?? _k }),
}));
vi.mock('@alga-psa/user-activities/actions', () => ({
  fetchNotificationActivities: mocks.fetchNotificationActivities,
  fetchNotificationActivitiesPaged: mocks.fetchNotificationActivitiesPaged,
}));
vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@alga-psa/notifications/hooks', () => ({
  useInternalNotifications: () => ({ unreadCount: 0, notifications: [] }),
}));
vi.mock('./ActivityDrawerProvider', () => ({ useActivityDrawer: () => ({ openActivityDrawer: vi.fn() }) }));
vi.mock('./NotificationCard', () => ({ NotificationCard: () => null }));
vi.mock('@alga-psa/ui/components/Badge', () => ({ Badge: ({ children }: any) => <span>{children}</span> }));
vi.mock('@alga-psa/ui/components/Pagination', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/Label', () => ({ Label: ({ children }: any) => <label>{children}</label> }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, ...p }: any) => <button {...p}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, id }: any) => <div id={id}>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <h2>{children}</h2>,
}));
vi.mock('@alga-psa/ui/components/CustomTabs', () => ({
  default: ({ tabs, defaultTab }: any) => <div>{tabs.find((x: any) => x.id === defaultTab)?.content}</div>,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, onValueChange, options }: any) => (
    <select id={id} value={value} onChange={(e) => onValueChange(e.target.value)}>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));
vi.mock('@alga-psa/ui/components/DateRangePicker', () => ({
  StringDateRangePicker: ({ id, onChange }: any) => (
    <button id={id} onClick={() => onChange({ from: '2026-01-02', to: '2026-01-05' })} />
  ),
}));

import { NotificationsSection } from './NotificationsSection';

const lastFilters = (fn: any) => fn.mock.calls.at(-1)![0];

beforeEach(() => {
  mocks.fetchNotificationActivities.mockReset().mockResolvedValue([]);
  mocks.fetchNotificationActivitiesPaged.mockReset().mockResolvedValue({ activities: [], total: 0 });
});
afterEach(cleanup);

describe('NotificationsSection inline filters', () => {
  it('has no dialog and no header Filter/Reset buttons', async () => {
    const { container, queryByRole } = render(<NotificationsSection />);
    await waitFor(() => expect(mocks.fetchNotificationActivities).toHaveBeenCalled());
    expect(queryByRole('dialog')).toBeNull();
    expect(container.querySelector('#filter-notifications-button')).toBeNull();
    expect(container.querySelector('#reset-notification-filters-button')).toBeNull();
  });

  it('shows the priority chips in preview mode and writes priority', async () => {
    const { container } = render(<NotificationsSection />);
    await waitFor(() => expect(mocks.fetchNotificationActivities).toHaveBeenCalled());
    fireEvent.click(container.querySelector('#notification-priority-filter-high')!);
    await waitFor(() => expect(lastFilters(mocks.fetchNotificationActivities)).toMatchObject({ priority: [ActivityPriority.HIGH], isClosed: false }));
    fireEvent.click(container.querySelector('#notification-priority-filter-all')!);
    await waitFor(() => expect(lastFilters(mocks.fetchNotificationActivities).priority).toBeUndefined());
  });

  it('writes the category into search', async () => {
    const { container } = render(<NotificationsSection />);
    await waitFor(() => expect(mocks.fetchNotificationActivities).toHaveBeenCalled());
    fireEvent.change(container.querySelector('#notification-category-select')!, { target: { value: 'invoices' } });
    await waitFor(() => expect(lastFilters(mocks.fetchNotificationActivities)).toMatchObject({ search: 'invoices' }));
  });

  it('writes the date range, and the clear control removes every inline filter but keeps the tab state', async () => {
    const { container } = render(<NotificationsSection fullMode />);
    await waitFor(() => expect(mocks.fetchNotificationActivitiesPaged).toHaveBeenCalled());
    expect(container.querySelector('#clear-notification-filters-button')).toBeNull();

    fireEvent.click(container.querySelector('#notification-date-range')!);
    await waitFor(() =>
      expect(lastFilters(mocks.fetchNotificationActivitiesPaged)).toMatchObject({
        dateRangeStart: '2026-01-02T00:00:00.000Z',
        dateRangeEnd: '2026-01-05T23:59:59.000Z',
      })
    );

    await act(async () => { fireEvent.click(container.querySelector('#clear-notification-filters-button')!); });
    await waitFor(() => {
      const f = lastFilters(mocks.fetchNotificationActivitiesPaged);
      expect(f.dateRangeStart).toBeUndefined();
      expect(f.dateRangeEnd).toBeUndefined();
      expect(f.isClosed).toBe(false);
    });
  });
});
