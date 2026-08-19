import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useSchedulingCallbacks } from '@alga-psa/ui/context';

// Wiring coverage for the release-v1-5-feature gate: the provider is the React
// boundary that resolves the flag (the launcher is a plain async function) and
// must thread it into every launchTimeEntry call — flag off keeps the launcher
// on the legacy path (enhancedLaunchFeedback falsy), flag on enables it.

const { useFeatureFlagMock, launchTimeEntryForWorkItem } = vi.hoisted(() => ({
  useFeatureFlagMock: vi.fn(),
  launchTimeEntryForWorkItem: vi.fn(),
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: useFeatureFlagMock,
}));

vi.mock('../src/lib/timeEntryLauncher', () => ({
  launchTimeEntryForWorkItem,
}));

vi.mock('../src/lib/scheduleEntryLauncher', () => ({
  launchScheduleEntryForWorkItem: vi.fn(async () => undefined),
}));

vi.mock('../src/components/schedule/AgentScheduleView', () => ({
  default: () => null,
}));

vi.mock('../src/actions/timeEntryTicketActions', () => ({
  fetchTimeEntriesForTicket: vi.fn(),
}));

vi.mock('../src/actions/timeEntryActions', () => ({
  deleteTimeEntry: vi.fn(),
}));

import { SchedulingProviderWithCallbacks } from '../src/providers/SchedulingProviderWithCallbacks';

function captureCallbacks(): ReturnType<typeof useSchedulingCallbacks> {
  let captured!: ReturnType<typeof useSchedulingCallbacks>;
  const Probe = () => {
    captured = useSchedulingCallbacks();
    return null;
  };
  renderToStaticMarkup(
    React.createElement(SchedulingProviderWithCallbacks, null, React.createElement(Probe)),
  );
  return captured;
}

beforeEach(() => {
  vi.clearAllMocks();
  launchTimeEntryForWorkItem.mockResolvedValue(undefined);
});

describe('SchedulingProviderWithCallbacks launch feedback flag wiring', () => {
  it('flag off: launchTimeEntry receives falsy enhancedLaunchFeedback', async () => {
    useFeatureFlagMock.mockReturnValue({ enabled: false, loading: false, error: null });

    const callbacks = captureCallbacks();
    await callbacks.launchTimeEntry({
      openDrawer: () => {},
      closeDrawer: () => {},
      context: { workItemId: 't1', workItemType: 'ticket', workItemName: 'T1' },
    });

    expect(useFeatureFlagMock).toHaveBeenCalledWith('release-v1-5-feature', { defaultValue: false });
    expect(launchTimeEntryForWorkItem).toHaveBeenCalledTimes(1);
    expect(launchTimeEntryForWorkItem.mock.calls[0][0].enhancedLaunchFeedback).toBe(false);
  });

  it('flag on: launchTimeEntry receives enhancedLaunchFeedback true', async () => {
    useFeatureFlagMock.mockReturnValue({ enabled: true, loading: false, error: null });

    const callbacks = captureCallbacks();
    await callbacks.launchTimeEntry({
      openDrawer: () => {},
      closeDrawer: () => {},
      context: { workItemId: 't1', workItemType: 'ticket', workItemName: 'T1' },
    });

    expect(launchTimeEntryForWorkItem).toHaveBeenCalledTimes(1);
    expect(launchTimeEntryForWorkItem.mock.calls[0][0].enhancedLaunchFeedback).toBe(true);
  });

  it('preserves the rest of the launch params while threading the flag', async () => {
    useFeatureFlagMock.mockReturnValue({ enabled: true, loading: false, error: null });

    const callbacks = captureCallbacks();
    const openDrawer = () => {};
    const closeDrawer = () => {};
    await callbacks.launchTimeEntry({
      openDrawer,
      closeDrawer,
      context: { workItemId: 't2', workItemType: 'ticket', workItemName: 'T2' },
      existingEntryId: 'entry-1',
    });

    const params = launchTimeEntryForWorkItem.mock.calls[0][0];
    expect(params.openDrawer).toBe(openDrawer);
    expect(params.closeDrawer).toBe(closeDrawer);
    expect(params.existingEntryId).toBe('entry-1');
    expect(params.context.workItemId).toBe('t2');
  });
});
