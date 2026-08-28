/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

const getAppointmentRequests = vi.fn();
const getAvailabilitySettingsAccess = vi.fn();

vi.mock('@alga-psa/scheduling/actions', () => ({
  getAppointmentRequests: (...args: unknown[]) => getAppointmentRequests(...(args as [])),
  getAvailabilitySettingsAccess: (...args: unknown[]) => getAvailabilitySettingsAccess(...(args as [])),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key,
  }),
}));

vi.mock('lucide-react', () => ({
  Calendar: () => null,
  Settings: () => null,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ id, onClick, children }: any) => (
    <button data-testid={id} id={id} onClick={onClick}>{children}</button>
  ),
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('../src/components/schedule/ScheduleCalendar', () => ({ default: () => null }));
vi.mock('../src/components/schedule/AppointmentRequestsPanel', () => ({ default: () => null }));
vi.mock('../src/components/schedule/AvailabilitySettings', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div data-testid="availability-dialog" /> : null),
}));

import SchedulePage from '../src/components/schedule/SchedulePage';
import { writeAvailabilityAccessHint, writeAvailabilityContext } from '../src/lib/availabilityContext';

function setNavigationType(type: 'reload' | 'navigate') {
  vi.spyOn(performance, 'getEntriesByType').mockImplementation((entryType: string) =>
    (entryType === 'navigation' ? [{ type } as PerformanceNavigationTiming] : []) as PerformanceEntry[],
  );
}

describe('SchedulePage availability dialog restoration', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    getAppointmentRequests.mockResolvedValue({ success: true, data: [] });
    getAvailabilitySettingsAccess.mockResolvedValue({ success: true, data: { canManageUserHours: true } });
    writeAvailabilityAccessHint(true);
    writeAvailabilityContext({ isOpen: true, activeTab: 'user-hours', selectedUserId: 'user-1' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('reopens the dialog after a refresh so the saved value can be checked in place', async () => {
    setNavigationType('reload');

    render(<SchedulePage />);
    await act(async () => {});

    expect(screen.getByTestId('availability-dialog')).toBeInTheDocument();
  });

  it('does not pop the dialog open when the reader navigates back to Schedule', async () => {
    setNavigationType('navigate');

    render(<SchedulePage />);
    await act(async () => {});

    expect(screen.queryByTestId('availability-dialog')).not.toBeInTheDocument();
    // the entry point stays clickable instead of sitting behind a modal
    expect(screen.getByTestId('configure-availability-button')).toBeInTheDocument();
  });

  it('opens on request and remembers that the dialog is open', async () => {
    setNavigationType('navigate');

    render(<SchedulePage />);
    await act(async () => {});

    await act(async () => {
      screen.getByTestId('configure-availability-button').click();
    });

    expect(screen.getByTestId('availability-dialog')).toBeInTheDocument();
  });

  it('leaves the dialog closed after a refresh when it was closed before', async () => {
    writeAvailabilityContext({ isOpen: false });
    setNavigationType('reload');

    render(<SchedulePage />);
    await act(async () => {});

    expect(screen.queryByTestId('availability-dialog')).not.toBeInTheDocument();
  });
});
