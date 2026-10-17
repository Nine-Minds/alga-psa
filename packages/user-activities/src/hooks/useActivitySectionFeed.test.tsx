/* @vitest-environment jsdom */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { ActivityType } from '@alga-psa/types';

const mocks = vi.hoisted(() => ({ fetchActivities: vi.fn() }));
vi.mock('../actions/activityServerActions', () => ({ fetchActivities: mocks.fetchActivities }));

import { ActivitiesCacheProvider, useActivitiesInvalidationSignal } from './ActivitiesCacheProvider';
import { useActivitySectionFeed } from './useActivitySectionFeed';

const ticket = (id: string) => ({ type: 'ticket', id, title: id, status: 'open', priority: 'low' }) as any;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ActivitiesCacheProvider>{children}</ActivitiesCacheProvider>
);

const everyBarKey = {
  types: [ActivityType.TICKET, ActivityType.SCHEDULE],
  isClosed: true,
  search: 'printer',
  clientId: 'c1',
  priorityIds: ['p1'],
  opportunityScope: 'all',
  dueDateStart: '2026-01-01T00:00:00.000Z',
  dueDateEnd: '2026-02-01T00:00:00.000Z',
  createdAtStart: '2025-01-01T00:00:00.000Z',
  createdAtEnd: '2025-02-01T00:00:00.000Z',
  ticketBoardIds: ['b1'],
  ticketExcludeBoardIds: ['b2'],
  ticketStatusIds: ['s1'],
  ticketExcludeStatusIds: ['s2'],
  ticketTagIds: ['tag1'],
  projectIds: ['pr1'],
  phaseIds: ['ph1'],
  projectStatusMappingIds: ['m1'],
  excludeProjectIds: ['pr2'],
  excludePhaseIds: ['ph2'],
  excludeProjectStatusMappingIds: ['m2'],
  projectTaskTagIds: ['ptag1'],
} as any;

beforeEach(() => {
  mocks.fetchActivities.mockReset().mockResolvedValue({ activities: [ticket('t1')], totalCount: 1 });
});
afterEach(cleanup);

describe('useActivitySectionFeed', () => {
  it('queries the table path for one type with every filter key, target user and page 1', async () => {
    const { result } = renderHook(
      () => useActivitySectionFeed(ActivityType.TICKET, everyBarKey, 'u2', 5),
      { wrapper }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mocks.fetchActivities).toHaveBeenCalledTimes(1);
    expect(mocks.fetchActivities).toHaveBeenCalledWith(
      { ...everyBarKey, types: [ActivityType.TICKET], targetUserId: 'u2' },
      1,
      5
    );
    expect(result.current.activities.map((a) => a.id)).toEqual(['t1']);
    expect(result.current.totalCount).toBe(1);
    expect(mocks.fetchActivities.mock.calls[0][0]).not.toHaveProperty('sortBy');
  });

  it('passes collapseRecurringSeries through and omits an empty target user', async () => {
    const { result } = renderHook(
      () => useActivitySectionFeed(ActivityType.SCHEDULE, { isClosed: false }, '', 5, { collapseRecurringSeries: true }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    const sent = mocks.fetchActivities.mock.calls[0][0];
    expect(sent.collapseRecurringSeries).toBe(true);
    expect(sent.targetUserId).toBeUndefined();
    expect(sent.types).toEqual([ActivityType.SCHEDULE]);
  });

  it('refetches on a filter change', async () => {
    const { result, rerender } = renderHook(
      ({ search }: { search: string }) => useActivitySectionFeed(ActivityType.TICKET, { search }, '', 5),
      { wrapper, initialProps: { search: '' } }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ search: 'abc' });
    await waitFor(() => expect(mocks.fetchActivities).toHaveBeenCalledTimes(2));
    expect(mocks.fetchActivities.mock.calls[1][0].search).toBe('abc');
  });

  it('refetches on an invalidation-version bump, not on mount', async () => {
    const { result } = renderHook(
      () => ({ feed: useActivitySectionFeed(ActivityType.TICKET, {}, '', 5), signal: useActivitiesInvalidationSignal() }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.feed.loading).toBe(false));
    await new Promise((r) => setTimeout(r, 30));
    expect(mocks.fetchActivities).toHaveBeenCalledTimes(1);

    act(() => result.current.signal.notifyInvalidated());
    await waitFor(() => expect(mocks.fetchActivities).toHaveBeenCalledTimes(2));
  });

  it('refresh() invalidates the cache and reloads', async () => {
    const { result } = renderHook(() => useActivitySectionFeed(ActivityType.TICKET, {}, '', 5), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.refresh());
    await waitFor(() => expect(mocks.fetchActivities).toHaveBeenCalledTimes(2));
  });

  it('ignores a stale out-of-order response', async () => {
    const resolvers: Record<string, (v: any) => void> = {};
    mocks.fetchActivities.mockImplementation(
      (filters: any) => new Promise((resolve) => { resolvers[filters.search ?? ''] = resolve; })
    );
    const { result, rerender } = renderHook(
      ({ search }: { search: string }) => useActivitySectionFeed(ActivityType.TICKET, { search }, '', 5),
      { wrapper, initialProps: { search: 'a' } }
    );
    await waitFor(() => expect(resolvers.a).toBeDefined());
    rerender({ search: 'ab' });
    await waitFor(() => expect(resolvers.ab).toBeDefined());

    await act(async () => { resolvers.ab({ activities: [ticket('new')], totalCount: 1 }); });
    await act(async () => { resolvers.a({ activities: [ticket('stale')], totalCount: 1 }); });

    expect(result.current.activities.map((x) => x.id)).toEqual(['new']);
    expect(result.current.loading).toBe(false);
  });

  it('surfaces an error from the latest request', async () => {
    mocks.fetchActivities.mockRejectedValue(new Error('boom'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useActivitySectionFeed(ActivityType.TICKET, {}, '', 5), { wrapper });
    await waitFor(() => expect(result.current.error).toBe('boom'));
    expect(result.current.loading).toBe(false);
    spy.mockRestore();
  });
});
