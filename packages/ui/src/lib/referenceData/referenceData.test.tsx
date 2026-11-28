// @vitest-environment jsdom
import React from 'react';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ReferenceDataProvider,
  invalidateReferenceList,
  useReferenceLists,
  referenceListError,
  type LoadReferenceLists,
  type ReferenceListKey,
} from './index';

const FIVE_MIN = 5 * 60 * 1000;

function makeLoad(
  overrides: Partial<Record<ReferenceListKey, unknown>> = {}
): ReturnType<typeof vi.fn<LoadReferenceLists>> {
  return vi.fn<LoadReferenceLists>(async (keys) => {
    const out: Partial<Record<ReferenceListKey, unknown>> = {};
    for (const key of keys) out[key] = key in overrides ? overrides[key] : [`${key}-1`];
    return out;
  });
}

function wrapperFor(cache: Map<unknown, unknown>, load: LoadReferenceLists, scope: string | undefined) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <SWRConfig value={{ provider: () => cache as Map<string, never> }}>
        <ReferenceDataProvider load={load} scope={scope}>
          {children}
        </ReferenceDataProvider>
      </SWRConfig>
    );
  };
}

const ALL: ReferenceListKey[] = ['boards', 'ticketStatuses', 'ticketTags', 'projectsWithPhases'];

describe('useReferenceLists', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('cold mount makes one load call with all keys', async () => {
    const load = makeLoad();
    const { result } = renderHook(() => useReferenceLists(ALL), { wrapper: wrapperFor(new Map(), load, 't:u1') });
    expect(result.current.loading.boards).toBe(true);
    await waitFor(() => expect(result.current.loading.boards).toBe(false));
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0][0].slice().sort()).toEqual([...ALL].sort());
    expect(result.current.data.boards).toEqual(['boards-1']);
    expect(result.current.data.projectsWithPhases).toEqual(['projectsWithPhases-1']);
  });

  it('warm remount within freshness makes zero calls for fresh keys', async () => {
    const cache = new Map();
    const load = makeLoad();
    const keys: ReferenceListKey[] = ['boards', 'ticketStatuses', 'ticketTags'];
    const first = renderHook(() => useReferenceLists(keys), { wrapper: wrapperFor(cache, load, 't:u1') });
    await waitFor(() => expect(first.result.current.loading.boards).toBe(false));
    first.unmount();
    vi.setSystemTime(Date.now() + FIVE_MIN - 1000);

    const second = renderHook(() => useReferenceLists(keys), { wrapper: wrapperFor(cache, load, 't:u1') });
    // cached values are present on the very first render
    expect(second.result.current.loading.boards).toBe(false);
    expect(second.result.current.data.boards).toEqual(['boards-1']);
    await act(async () => { await Promise.resolve(); });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('refetches a stale key alone and serves the cached value meanwhile', async () => {
    const cache = new Map();
    const load = makeLoad();
    const first = renderHook(() => useReferenceLists(['boards', 'ticketTags']), { wrapper: wrapperFor(cache, load, 't:u1') });
    await waitFor(() => expect(first.result.current.loading.boards).toBe(false));
    first.unmount();

    // Age only `boards` by re-seeding it as old: advance time, then refresh ticketTags via a 1-key mount.
    vi.setSystemTime(Date.now() + FIVE_MIN - 1000);
    const mid = renderHook(() => useReferenceLists(['ticketTags'], { freshForMs: { ticketTags: 1 } }), {
      wrapper: wrapperFor(cache, load, 't:u1'),
    });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    mid.unmount();
    vi.setSystemTime(Date.now() + 2000); // boards now older than 5 min, ticketTags fresh

    const third = renderHook(() => useReferenceLists(['boards', 'ticketTags'], { freshForMs: { ticketTags: FIVE_MIN } }), {
      wrapper: wrapperFor(cache, load, 't:u1'),
    });
    expect(third.result.current.data.boards).toEqual(['boards-1']); // stale value shown at once
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    expect(load.mock.calls[2][0]).toEqual(['boards']);
  });

  it('projectsWithPhases revalidates on every mount while other lists stay cached', async () => {
    const cache = new Map();
    const load = makeLoad();
    const keys: ReferenceListKey[] = ['boards', 'projectsWithPhases'];
    const first = renderHook(() => useReferenceLists(keys), { wrapper: wrapperFor(cache, load, 't:u1') });
    await waitFor(() => expect(first.result.current.loading.projectsWithPhases).toBe(false));
    first.unmount();

    const second = renderHook(() => useReferenceLists(keys), { wrapper: wrapperFor(cache, load, 't:u1') });
    expect(second.result.current.data.projectsWithPhases).toEqual(['projectsWithPhases-1']); // cached, instantly
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(load.mock.calls[1][0]).toEqual(['projectsWithPhases']);
    // and does not loop within the same mount
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('invalidateReferenceList refetches only the invalidated key', async () => {
    const cache = new Map();
    const load = makeLoad();
    const keys: ReferenceListKey[] = ['boards', 'ticketStatuses'];
    const { result } = renderHook(() => useReferenceLists(keys), { wrapper: wrapperFor(cache, load, 't:u1') });
    await waitFor(() => expect(result.current.loading.boards).toBe(false));
    load.mockImplementation(async (ks) => Object.fromEntries(ks.map((k) => [k, [`${k}-2`]])));

    act(() => invalidateReferenceList('boards'));
    await waitFor(() => expect(result.current.data.boards).toEqual(['boards-2']));
    expect(load).toHaveBeenCalledTimes(2);
    expect(load.mock.calls[1][0]).toEqual(['boards']);
    expect(result.current.data.ticketStatuses).toEqual(['ticketStatuses-1']);
  });

  it('isolates scopes: another scope does not see cached data and does not fetch without a scope', async () => {
    const cache = new Map();
    const load = makeLoad();
    const a = renderHook(() => useReferenceLists(['ticketTags']), { wrapper: wrapperFor(cache, load, 't:userA') });
    await waitFor(() => expect(a.result.current.loading.ticketTags).toBe(false));
    a.unmount();

    const b = renderHook(() => useReferenceLists(['ticketTags']), { wrapper: wrapperFor(cache, load, 't:userB') });
    expect(b.result.current.loading.ticketTags).toBe(true);
    expect(b.result.current.data.ticketTags).toBeUndefined();
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    b.unmount();

    load.mockClear();
    const none = renderHook(() => useReferenceLists(['ticketTags']), { wrapper: wrapperFor(cache, load, undefined) });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(load).not.toHaveBeenCalled();
    expect(none.result.current.loading.ticketTags).toBe(true);
    expect(none.result.current.data.ticketTags).toBeUndefined();
  });

  it('an error marker for one key leaves the others populated', async () => {
    const load = makeLoad({ ticketTags: referenceListError('denied') });
    const { result } = renderHook(() => useReferenceLists(['boards', 'ticketTags']), {
      wrapper: wrapperFor(new Map(), load, 't:u1'),
    });
    await waitFor(() => expect(result.current.loading.ticketTags).toBe(false));
    expect(result.current.data.boards).toEqual(['boards-1']);
    expect(result.current.data.ticketTags).toBeUndefined();
    expect(result.current.errors.ticketTags).toBe('denied');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('a failed batch marks every requested key as errored without crashing', async () => {
    const load = vi.fn<LoadReferenceLists>().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useReferenceLists(['boards']), { wrapper: wrapperFor(new Map(), load, 't:u1') });
    await waitFor(() => expect(result.current.loading.boards).toBe(false));
    expect(result.current.errors.boards).toBe('boom');
  });

  it('two consumers mounting together share one load call', async () => {
    const load = makeLoad();
    function A() { useReferenceLists(['boards']); return null; }
    function B() { useReferenceLists(['boards', 'ticketTags']); return null; }
    const Wrapper = wrapperFor(new Map(), load, 't:u1');
    render(<Wrapper><A /><B /></Wrapper>);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    expect(load.mock.calls[0][0].slice().sort()).toEqual(['boards', 'ticketTags']);
  });
});

