/* @vitest-environment jsdom */
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import { ActivityType } from '@alga-psa/types';
import { ReferenceDataProvider, type LoadReferenceLists } from '@alga-psa/ui/lib/referenceData';
import { useActivityFilterOptions } from './useActivityFilterOptions';

const SCOPE = 'tenant-1:user-1';

function wrapper(cache: Map<unknown, unknown>, load: LoadReferenceLists, scope: string | null = SCOPE) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <SWRConfig value={{ provider: () => cache as Map<string, never> }}>
        <ReferenceDataProvider load={load} scope={scope ?? undefined}>{children}</ReferenceDataProvider>
      </SWRConfig>
    );
  };
}

const lists = {
  boards: [{ board_id: 'b1', board_name: 'Support' }],
  ticketStatuses: [{ status_id: 's1', name: 'Open' }],
  ticketTags: [{ tag_id: 't1', tag_text: 'vip' }],
  projectTaskTags: [{ tag_id: 't2', tag_text: 'bug' }],
  projectsWithPhases: [{ project_id: 'p1', project_name: 'Migration', phases: [] }],
  'priorities:ticket': [{ priority_id: 'pr1', priority_name: 'High' }],
} as const;

const loadAll: LoadReferenceLists = async (keys) =>
  Object.fromEntries(keys.map((k) => [k, (lists as any)[k] ?? []]));

describe('useActivityFilterOptions', () => {
  it('loads every list in one batched call and exposes the same shape plus a loading map', async () => {
    const load = vi.fn(loadAll);
    const { result } = renderHook(() => useActivityFilterOptions(undefined), { wrapper: wrapper(new Map(), load) });

    expect(result.current.boards).toEqual([]);
    expect(result.current.loading).toMatchObject({ boards: true, ticketStatuses: true, ticketTags: true, projectTaskTags: true, projects: true, priorities: false });

    await waitFor(() => expect(result.current.loading.boards).toBe(false));
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0][0]).not.toContain('priorities:ticket');
    expect(result.current.boards).toEqual(lists.boards);
    expect(result.current.ticketStatuses).toEqual(lists.ticketStatuses);
    expect(result.current.ticketTags).toEqual(lists.ticketTags);
    expect(result.current.projectTaskTags).toEqual(lists.projectTaskTags);
    expect(result.current.projects).toEqual(lists.projectsWithPhases);
    expect(result.current.priorities).toEqual([]);
  });

  it('returns cached lists synchronously on the first render when the cache is pre-seeded', async () => {
    const cache = new Map<unknown, unknown>();
    const warm = renderHook(() => useActivityFilterOptions(undefined), { wrapper: wrapper(cache, vi.fn(loadAll)) });
    await waitFor(() => expect(warm.result.current.loading.boards).toBe(false));
    warm.unmount();

    const load = vi.fn(loadAll);
    const second = renderHook(() => useActivityFilterOptions(undefined), { wrapper: wrapper(cache, load) });
    // No await: the very first render already has every list and nothing is loading.
    expect(second.result.current.boards).toEqual(lists.boards);
    expect(second.result.current.ticketTags).toEqual(lists.ticketTags);
    expect(second.result.current.projects).toEqual(lists.projectsWithPhases);
    expect(Object.values(second.result.current.loading).every((v) => v === false)).toBe(true);
    // Only the always-revalidated projects list goes back to the server.
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    expect(load.mock.calls[0][0]).toEqual(['projectsWithPhases']);
  });

  it('adds the priority list only for a single prioritized type', async () => {
    const load = vi.fn(loadAll);
    const { result, rerender } = renderHook(({ types }) => useActivityFilterOptions(types), {
      wrapper: wrapper(new Map(), load),
      initialProps: { types: [ActivityType.TICKET] as ActivityType[] },
    });
    await waitFor(() => expect(result.current.priorities).toEqual(lists['priorities:ticket']));
    expect(load.mock.calls[0][0]).toContain('priorities:ticket');

    rerender({ types: [ActivityType.TICKET, ActivityType.PROJECT_TASK] });
    expect(result.current.priorities).toEqual([]);
    expect(result.current.loading.priorities).toBe(false);
  });

  it('does not fetch without a scope and keeps every list loading', async () => {
    const load = vi.fn(loadAll);
    const { result } = renderHook(() => useActivityFilterOptions(undefined), { wrapper: wrapper(new Map(), load, null) });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(load).not.toHaveBeenCalled();
    expect(result.current.loading.boards).toBe(true);
  });

  it('degrades to empty, not-loading lists without a provider', () => {
    const { result } = renderHook(() => useActivityFilterOptions(undefined));
    expect(result.current.boards).toEqual([]);
    expect(Object.values(result.current.loading).every((v) => v === false)).toBe(true);
  });
});
