/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  StopwatchContextProvider,
  type StopwatchContextValue,
} from '@alga-psa/ui/context';
import { TicketStopwatchControls } from '../TicketStopwatchControls';

vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), closeDrawer: vi.fn(), replaceDrawer: vi.fn() }),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, variant: _variant, size: _size, ...props }: any) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));
vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ containerClassName: _c, ...props }: any) => <input {...props} />,
}));
vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));
vi.mock('@alga-psa/ui/ui-reflection/withDataAutomationId', () => ({
  withDataAutomationId: ({ id }: { id: string }) => ({ id, 'data-testid': id }),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: any, options?: Record<string, string>) => {
      const text = typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key;
      return text.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) => options?.[name] ?? '');
    },
  }),
  useFormatters: () => ({ locale: 'en' }),
}));

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    session_id: 's1',
    user_id: 'u1',
    work_item_type: 'ticket',
    work_item_id: 'ticket-1',
    service_id: null,
    notes: '',
    status: 'running',
    time_entry_id: null,
    closed_at: null,
    created_at: '2026-09-09T10:00:00Z',
    updated_at: '2026-09-09T10:00:00Z',
    segments: [{ segment_id: 'g1', started_at: '2026-09-09T10:00:00Z', ended_at: null }],
    active_ms: 0,
    server_now: '2026-09-09T10:00:00Z',
    ticket_number: '100',
    work_item_title: 'Printer',
    project_name: null,
    client_name: 'Acme',
    service_name: null,
    ...overrides,
  } as any;
}

function makeValue(session: any, overrides: Partial<StopwatchContextValue> = {}): StopwatchContextValue {
  return {
    session,
    state: session ? session.status : 'idle',
    isLoading: false,
    serverOffsetMs: 0,
    getElapsedMs: () => 65_000,
    getEntrySpan: vi.fn(),
    start: vi.fn().mockResolvedValue({ status: 'started', session }),
    pause: vi.fn().mockResolvedValue({ status: 'ok' }),
    resume: vi.fn().mockResolvedValue({ status: 'ok' }),
    requestStop: vi.fn().mockResolvedValue({ status: 'ok' }),
    requestDiscard: vi.fn().mockResolvedValue(true),
    updateNotes: vi.fn().mockResolvedValue({ status: 'ok' }),
    refresh: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as StopwatchContextValue;
}

function renderControls(value: StopwatchContextValue, props: Partial<React.ComponentProps<typeof TicketStopwatchControls>> = {}) {
  return render(
    <StopwatchContextProvider value={value}>
      <TicketStopwatchControls
        id="t"
        ticketId="ticket-1"
        enabled
        timeDescription=""
        onTimeDescriptionChange={vi.fn()}
        {...props}
      />
    </StopwatchContextProvider>,
  );
}

describe('TicketStopwatchControls', () => {
  it('offers Start when idle and starts a ticket session only on click', () => {
    const value = makeValue(null);
    renderControls(value, { timeDescription: ' fix ' });

    expect(value.start).not.toHaveBeenCalled();
    expect(document.getElementById('t-stopwatch-clock')).toHaveTextContent('00:00:00');
    fireEvent.click(screen.getByTestId('t-stopwatch-start'));

    expect(value.start).toHaveBeenCalledWith(
      { workItemType: 'ticket', workItemId: 'ticket-1', notes: 'fix' },
      expect.any(Function),
    );
  });

  it('renders the running session clock with pause, stop and discard', async () => {
    const value = makeValue(makeSession());
    renderControls(value);

    expect(document.getElementById('t-stopwatch-clock')).toHaveTextContent('00:01:05');
    expect(screen.getByTestId('t-stopwatch-pause')).toBeInTheDocument();
    expect(screen.queryByTestId('t-stopwatch-resume')).toBeNull();

    fireEvent.click(screen.getByTestId('t-stopwatch-pause'));
    expect(value.pause).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('t-stopwatch-stop')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('t-stopwatch-stop'));
    expect(value.requestStop).toHaveBeenCalledWith(expect.any(Function));
    await waitFor(() => expect(screen.getByTestId('t-stopwatch-discard')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('t-stopwatch-discard'));
    expect(value.requestDiscard).toHaveBeenCalled();
  });

  it('shows Resume and a hint when the session is paused', () => {
    renderControls(makeValue(makeSession({ status: 'paused' })));

    expect(screen.getByTestId('t-stopwatch-resume')).toBeInTheDocument();
    expect(screen.getByText(/Paused\. Resume to keep tracking/)).toBeInTheDocument();
  });

  it('is replaced by a message when the board has the stopwatch off', () => {
    renderControls(makeValue(null), { enabled: false });

    expect(screen.getByTestId('t-stopwatch-disabled-message')).toBeInTheDocument();
    expect(screen.queryByTestId('t-stopwatch-start')).toBeNull();
  });

  it('keeps this ticket stoppable even if the board turned the stopwatch off', () => {
    renderControls(makeValue(makeSession()), { enabled: false });

    expect(screen.queryByTestId('t-stopwatch-disabled-message')).toBeNull();
    expect(screen.getByTestId('t-stopwatch-stop')).toBeInTheDocument();
  });

  it('shows the other ticket by name when the session runs elsewhere, and Switch routes through start', () => {
    const other = makeSession({ work_item_id: 'ticket-2', ticket_number: '200', work_item_title: 'VPN' });
    const value = makeValue(other);
    renderControls(value);

    expect(document.getElementById('t-stopwatch-elsewhere')).toHaveTextContent('Running on another ticket: #200 VPN');
    expect(screen.queryByTestId('t-stopwatch-stop')).toBeNull();
    fireEvent.click(screen.getByTestId('t-stopwatch-switch'));

    expect(value.start).toHaveBeenCalledWith(
      expect.objectContaining({ workItemType: 'ticket', workItemId: 'ticket-1' }),
      expect.any(Function),
    );
  });

  it('persists the description on blur only for this ticket session', () => {
    const value = makeValue(makeSession());
    renderControls(value, { timeDescription: 'Replaced toner' });

    fireEvent.blur(screen.getByPlaceholderText('What are you working on?'));
    expect(value.updateNotes).toHaveBeenCalledWith('Replaced toner');
  });
});
