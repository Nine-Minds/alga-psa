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
vi.mock('../src/components/schedule/AvailabilitySettings', () => ({ default: () => null }));

import SchedulePage from '../src/components/schedule/SchedulePage';
import { readAvailabilityAccessHint, writeAvailabilityAccessHint } from '../src/lib/availabilityContext';

describe('SchedulePage availability access retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.sessionStorage.clear();
    getAppointmentRequests.mockResolvedValue({ success: true, data: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('retries a transient access failure and shows Configure Availability', async () => {
    getAvailabilitySettingsAccess
      .mockResolvedValueOnce({ success: false, error: 'Failed to load availability access' })
      .mockResolvedValueOnce({ success: true, data: { canManageUserHours: true } });

    render(<SchedulePage />);
    await act(async () => {});

    expect(screen.queryByTestId('configure-availability-button')).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(getAvailabilitySettingsAccess).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('configure-availability-button')).toBeInTheDocument();
  });

  it('does not retry a clean denial and keeps the button hidden', async () => {
    getAvailabilitySettingsAccess.mockResolvedValue({
      success: true,
      data: { canReadSystemSettings: false, canManageUserHours: false },
    });

    render(<SchedulePage />);
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });

    expect(getAvailabilitySettingsAccess).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('configure-availability-button')).not.toBeInTheDocument();
  });

  it('gives up after exhausting retries', async () => {
    getAvailabilitySettingsAccess.mockRejectedValue(new Error('network'));

    render(<SchedulePage />);
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });

    expect(getAvailabilitySettingsAccess).toHaveBeenCalledTimes(3);
    expect(screen.queryByTestId('configure-availability-button')).not.toBeInTheDocument();
  });

  it('paints the button from this tab\'s remembered access before the check resolves', async () => {
    writeAvailabilityAccessHint(true);
    // Never settles: proves the button does not wait on the bootstrap read.
    getAvailabilitySettingsAccess.mockReturnValue(new Promise(() => {}));

    render(<SchedulePage />);
    await act(async () => {});

    expect(screen.getByTestId('configure-availability-button')).toBeInTheDocument();
  });

  it('records access so the next visit paints without waiting', async () => {
    getAvailabilitySettingsAccess.mockResolvedValue({
      success: true,
      data: { canManageUserHours: true },
    });

    render(<SchedulePage />);
    await act(async () => {});

    expect(readAvailabilityAccessHint()).toBe(true);
  });

  it('keeps a permitted user\'s button when the check only fails transiently', async () => {
    writeAvailabilityAccessHint(true);
    getAvailabilitySettingsAccess.mockRejectedValue(new Error('network'));

    render(<SchedulePage />);
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    expect(screen.getByTestId('configure-availability-button')).toBeInTheDocument();
  });

  it('drops the remembered access once the server denies it', async () => {
    writeAvailabilityAccessHint(true);
    getAvailabilitySettingsAccess.mockResolvedValue({
      success: true,
      data: { canReadSystemSettings: false, canManageUserHours: false },
    });

    render(<SchedulePage />);
    await act(async () => {});

    expect(readAvailabilityAccessHint()).toBe(false);
    expect(screen.queryByTestId('configure-availability-button')).not.toBeInTheDocument();
  });
});
