import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useSchedulingCallbacks } from '@alga-psa/ui/context';

// Wiring coverage: the provider passes launch params straight through to the
// launcher (a plain async function outside the React tree).

const { launchTimeEntryForWorkItem } = vi.hoisted(() => ({
  launchTimeEntryForWorkItem: vi.fn(),
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

describe('SchedulingProviderWithCallbacks launch wiring', () => {
  it('passes the launch params through to the launcher', async () => {
    const callbacks = captureCallbacks();
    const openDrawer = () => {};
    const closeDrawer = () => {};
    await callbacks.launchTimeEntry({
      openDrawer,
      closeDrawer,
      context: { workItemId: 't2', workItemType: 'ticket', workItemName: 'T2' },
      existingEntryId: 'entry-1',
    });

    expect(launchTimeEntryForWorkItem).toHaveBeenCalledTimes(1);
    const params = launchTimeEntryForWorkItem.mock.calls[0][0];
    expect(params.openDrawer).toBe(openDrawer);
    expect(params.closeDrawer).toBe(closeDrawer);
    expect(params.existingEntryId).toBe('entry-1');
    expect(params.context.workItemId).toBe('t2');
  });
});
