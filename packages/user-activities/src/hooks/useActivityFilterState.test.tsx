/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { ActivityType } from '@alga-psa/types';

const mocks = vi.hoisted(() => ({
  setSaved: vi.fn(),
  pref: { value: null as any, loaded: false },
}));

vi.mock('@alga-psa/user-composition/hooks', () => ({
  useUserPreference: (_key: string, opts: any) => ({
    value: mocks.pref.value ?? opts.defaultValue,
    setValue: mocks.setSaved,
    hasLoadedInitial: mocks.pref.loaded,
  }),
}));

import { useActivityFilterState, DEFAULT_ACTIVITY_FILTERS } from './useActivityFilterState';

const saved = { types: [ActivityType.TICKET], isClosed: true, search: 'saved' } as any;
const edit = { types: [ActivityType.SCHEDULE], isClosed: false, search: 'edit' } as any;
const override = { types: [ActivityType.PROJECT_TASK], isClosed: false } as any;

beforeEach(() => {
  mocks.setSaved.mockReset();
  mocks.pref.value = null;
  mocks.pref.loaded = false;
});

describe('useActivityFilterState', () => {
  it('mirrors late saved prefs until the first user edit, then stops', () => {
    const { result, rerender } = renderHook(() => useActivityFilterState());
    expect(result.current.filters).toEqual(DEFAULT_ACTIVITY_FILTERS);
    expect(result.current.isReady).toBe(false);

    // Stage 1 (localStorage) then stage 2 (server) resolve after mount.
    mocks.pref.loaded = true;
    mocks.pref.value = saved;
    rerender();
    expect(result.current.filters).toEqual(saved);
    expect(result.current.isReady).toBe(true);

    mocks.pref.value = { ...saved, search: 'server' };
    rerender();
    expect(result.current.filters.search).toBe('server');

    act(() => result.current.setFilters(edit));
    expect(result.current.filters).toEqual(edit);

    mocks.pref.value = { ...saved, search: 'later' };
    rerender();
    expect(result.current.filters).toEqual(edit);
  });

  it('setFilters persists', () => {
    const { result } = renderHook(() => useActivityFilterState());
    act(() => result.current.setFilters(edit));
    expect(mocks.setSaved).toHaveBeenCalledWith(edit);
  });

  it('setOverrideFilters is not persisted and blocks the mirror; clearOverride restores saved filters', () => {
    mocks.pref.loaded = true;
    mocks.pref.value = saved;
    const { result, rerender } = renderHook(() => useActivityFilterState());
    expect(result.current.filters).toEqual(saved);

    act(() => result.current.setOverrideFilters(override));
    expect(result.current.hasOverride).toBe(true);
    expect(result.current.filters).toEqual(override);
    expect(mocks.setSaved).not.toHaveBeenCalled();

    mocks.pref.value = { ...saved, search: 'server' };
    rerender();
    expect(result.current.filters).toEqual(override);

    act(() => result.current.clearOverride());
    expect(result.current.hasOverride).toBe(false);
    expect(result.current.filters).toEqual({ ...saved, search: 'server' });
  });

  it('a user edit ends an override', () => {
    const { result } = renderHook(() => useActivityFilterState({ initialOverride: override }));
    expect(result.current.hasOverride).toBe(true);
    act(() => result.current.setFilters(edit));
    expect(result.current.hasOverride).toBe(false);
    expect(result.current.filters).toEqual(edit);
  });

  it('isReady covers the override path (prefs not yet loaded) and the loaded path', () => {
    const withOverride = renderHook(() => useActivityFilterState({ initialOverride: override }));
    expect(withOverride.result.current.isReady).toBe(true);
    expect(withOverride.result.current.filters).toEqual(override);

    const plain = renderHook(() => useActivityFilterState());
    expect(plain.result.current.isReady).toBe(false);
    mocks.pref.loaded = true;
    plain.rerender();
    expect(plain.result.current.isReady).toBe(true);
  });

  it('keeps targetUserId in memory', () => {
    const { result } = renderHook(() => useActivityFilterState());
    expect(result.current.targetUserId).toBe('');
    act(() => result.current.setTargetUserId('u2'));
    expect(result.current.targetUserId).toBe('u2');
    expect(mocks.setSaved).not.toHaveBeenCalled();
  });
});
