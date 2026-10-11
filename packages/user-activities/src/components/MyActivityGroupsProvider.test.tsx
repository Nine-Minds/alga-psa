/* @vitest-environment jsdom */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  getUserActivityGroups: vi.fn(),
  moveActivityToGroup: vi.fn(),
  removeActivityFromGroups: vi.fn(),
  createActivityGroup: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@alga-psa/user-activities/actions', () => ({
  getUserActivityGroups: mocks.getUserActivityGroups,
  moveActivityToGroup: mocks.moveActivityToGroup,
  removeActivityFromGroups: mocks.removeActivityFromGroups,
  createActivityGroup: mocks.createActivityGroup,
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_k: string, o: any) => o?.defaultValue ?? _k }),
}));
vi.mock('react-hot-toast', () => ({ toast: { error: mocks.toastError } }));

import {
  MyActivityGroupsProvider,
  useMyActivityGroups,
  useOptionalMyActivityGroups,
  type MyActivityGroupsStore,
} from './MyActivityGroupsProvider';

const grp = (id: string, items: Array<[string, string]> = []) => ({
  groupId: id,
  groupName: `Group ${id}`,
  sortOrder: 0,
  isCollapsed: false,
  items: items.map(([t, i], n) => ({ itemId: `${id}-${n}`, activityType: t, activityId: i, sortOrder: n })),
});

let store: MyActivityGroupsStore;
function Probe() {
  store = useMyActivityGroups();
  return null;
}
const mount = () => render(<MyActivityGroupsProvider><Probe /></MyActivityGroupsProvider>);

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.getUserActivityGroups.mockResolvedValue([grp('a', [['ticket', 't1']]), grp('b')]);
  mocks.moveActivityToGroup.mockResolvedValue(undefined);
  mocks.removeActivityFromGroups.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('MyActivityGroupsProvider', () => {
  it('loads lazily and coalesces concurrent ensureLoaded calls', async () => {
    mount();
    expect(mocks.getUserActivityGroups).not.toHaveBeenCalled();
    expect(store.groups).toBeNull();
    await act(async () => { await Promise.all([store.ensureLoaded(), store.ensureLoaded()]); });
    await act(async () => { await store.ensureLoaded(); });
    expect(mocks.getUserActivityGroups).toHaveBeenCalledTimes(1);
    expect(store.status).toBe('ready');
    expect(store.groupOf('ticket', 't1')?.groupId).toBe('a');
    expect(store.groupOf('ticket', 'zzz')).toBeNull();
  });

  it('moveTo is optimistic, removes from the old group, and calls the action with an append position', async () => {
    mount();
    await act(async () => { await store.ensureLoaded(); });
    let ok = false;
    await act(async () => { ok = await store.moveTo('ticket', 't1', 'b'); });
    expect(ok).toBe(true);
    expect(mocks.moveActivityToGroup).toHaveBeenCalledWith('t1', 'ticket', 'b', 0);
    expect(store.groupOf('ticket', 't1')?.groupId).toBe('b');
    expect(store.groups!.find((g) => g.groupId === 'a')!.items).toHaveLength(0);
  });

  it('rolls back only that item and toasts when the move fails', async () => {
    mount();
    await act(async () => { await store.ensureLoaded(); });
    mocks.moveActivityToGroup.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let ok = true;
    await act(async () => { ok = await store.moveTo('ticket', 't1', 'b'); });
    expect(ok).toBe(false);
    expect(store.groupOf('ticket', 't1')?.groupId).toBe('a');
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
  });

  it('clear removes membership; clearing an ungrouped item is a no-op success', async () => {
    mount();
    await act(async () => { await store.ensureLoaded(); });
    await act(async () => { expect(await store.clear('ticket', 't1')).toBe(true); });
    expect(mocks.removeActivityFromGroups).toHaveBeenCalledWith('t1', 'ticket');
    expect(store.groupOf('ticket', 't1')).toBeNull();
    mocks.removeActivityFromGroups.mockClear();
    await act(async () => { expect(await store.clear('ticket', 't1')).toBe(true); });
    expect(mocks.removeActivityFromGroups).not.toHaveBeenCalled();
  });

  it('createAndMove creates the group then moves the item into it', async () => {
    mount();
    await act(async () => { await store.ensureLoaded(); });
    mocks.createActivityGroup.mockResolvedValue(grp('new'));
    await act(async () => { expect(await store.createAndMove('New', 'projectTask', 'p1')).toBe(true); });
    expect(mocks.createActivityGroup).toHaveBeenCalledWith('New');
    expect(mocks.moveActivityToGroup).toHaveBeenCalledWith('p1', 'projectTask', 'new', 0);
    expect(store.groupOf('projectTask', 'p1')?.groupId).toBe('new');
  });

  it('createAndMove reports failure and moves nothing when creation fails', async () => {
    mount();
    await act(async () => { await store.ensureLoaded(); });
    mocks.createActivityGroup.mockRejectedValue(new Error('no'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => { expect(await store.createAndMove('X', 'ticket', 't9')).toBe(false); });
    expect(mocks.moveActivityToGroup).not.toHaveBeenCalled();
  });

  it('a failed first load sets status=error and toasts once', async () => {
    mocks.getUserActivityGroups.mockRejectedValue(new Error('down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mount();
    await act(async () => { await store.ensureLoaded(); });
    expect(store.status).toBe('error');
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
  });

  it('useOptionalMyActivityGroups is null without a provider; useMyActivityGroups throws', () => {
    let optional: unknown = 'unset';
    function Opt() { optional = useOptionalMyActivityGroups(); return null; }
    render(<Opt />);
    expect(optional).toBeNull();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow();
  });
});
