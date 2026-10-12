/* @vitest-environment jsdom */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

const { getMyStopwatch, pauseStopwatch } = vi.hoisted(() => ({
  getMyStopwatch: vi.fn(),
  pauseStopwatch: vi.fn(),
}));

vi.mock('../src/actions/stopwatchActions', () => ({
  getMyStopwatch,
  pauseStopwatch,
  resumeStopwatch: vi.fn(),
  startStopwatch: vi.fn(),
  discardStopwatch: vi.fn(),
  updateStopwatchDraft: vi.fn(),
}));

// Poll once on mount; ticks are what this suite proves the display does NOT depend on.
vi.mock('@alga-psa/ui/hooks', async () => {
  const React = await import('react');
  return {
    useActionPolling: (action: () => Promise<unknown>) => {
      const ref = React.useRef(action);
      ref.current = action;
      React.useEffect(() => {
        void ref.current();
      }, []);
      return { runNow: () => ref.current() };
    },
  };
});

vi.mock('../src/components/stopwatch/StopwatchDiscardDialog', () => ({
  StopwatchDiscardDialog: () => null,
  StopwatchConflictDialog: () => null,
}));

vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn() } }));

import { StopwatchProvider } from '../src/providers/StopwatchProvider';
import { useStopwatch } from '@alga-psa/ui/context';

const START = new Date('2026-09-09T10:00:00.000Z');

function runningSession(serverNow: Date) {
  return {
    session_id: 's1',
    user_id: 'u1',
    work_item_type: 'ticket',
    work_item_id: 't1',
    service_id: null,
    notes: '',
    status: 'running',
    time_entry_id: null,
    closed_at: null,
    created_at: START.toISOString(),
    updated_at: START.toISOString(),
    segments: [{ segment_id: 'g1', started_at: START.toISOString(), ended_at: null }],
    active_ms: serverNow.getTime() - START.getTime(),
    server_now: serverNow.toISOString(),
    ticket_number: '100',
    work_item_title: 'Printer',
    project_name: null,
    client_name: 'Acme',
    service_name: null,
  };
}

let latest: ReturnType<typeof useStopwatch>;
function Probe() {
  latest = useStopwatch();
  return null;
}

describe('StopwatchProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(START);
    getMyStopwatch.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows 10 minutes after the clock jumps 10 minutes with no ticks in between (sleep/background)', async () => {
    getMyStopwatch.mockResolvedValue(runningSession(START));
    render(
      <StopwatchProvider>
        <Probe />
      </StopwatchProvider>,
    );
    await act(async () => {});

    expect(latest.state).toBe('running');
    expect(latest.getElapsedMs()).toBe(0);

    vi.setSystemTime(new Date(START.getTime() + 10 * 60_000));
    expect(latest.getElapsedMs()).toBe(10 * 60_000);
  });

  it('applies the server clock offset so a skewed local clock still shows server time', async () => {
    // Local clock is 5 minutes behind the server when the session arrives.
    getMyStopwatch.mockResolvedValue(runningSession(new Date(START.getTime() + 5 * 60_000)));
    render(
      <StopwatchProvider>
        <Probe />
      </StopwatchProvider>,
    );
    await act(async () => {});

    expect(latest.getElapsedMs()).toBe(5 * 60_000);
  });

  it('is idle when the user has no open session', async () => {
    getMyStopwatch.mockResolvedValue(null);
    render(
      <StopwatchProvider>
        <Probe />
      </StopwatchProvider>,
    );
    await act(async () => {});

    expect(latest.state).toBe('idle');
    expect(latest.session).toBeNull();
    expect(latest.getElapsedMs()).toBe(0);
  });
});
