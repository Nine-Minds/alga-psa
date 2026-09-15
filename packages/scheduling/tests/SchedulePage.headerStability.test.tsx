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
  Button: ({ id, onClick, className, children }: any) => (
    <button data-testid={id} id={id} className={className} onClick={onClick}>{children}</button>
  ),
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ className, children }: any) => (
    <span data-testid="pending-count-badge" className={className}>{children}</span>
  ),
}));

vi.mock('../src/components/schedule/ScheduleCalendar', () => ({ default: () => null }));
vi.mock('../src/components/schedule/AppointmentRequestsPanel', () => ({ default: () => null }));
vi.mock('../src/components/schedule/AvailabilitySettings', () => ({ default: () => null }));

import SchedulePage from '../src/components/schedule/SchedulePage';

describe('SchedulePage header layout stability', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    getAvailabilitySettingsAccess.mockResolvedValue({
      success: true,
      data: { canReadSystemSettings: true, canManageUserHours: true },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('reserves the share-menu slot width so the portal cannot shift the header buttons', async () => {
    getAppointmentRequests.mockResolvedValue({ success: true, data: [] });

    const { container } = render(<SchedulePage />);
    await act(async () => {});

    const slot = container.querySelector('.min-w-9');
    expect(slot).not.toBeNull();
  });

  it('overlays the pending count badge so a late count cannot widen the button', async () => {
    getAppointmentRequests.mockResolvedValue({ success: true, data: [{}, {}] });

    render(<SchedulePage />);
    await act(async () => {});

    const badge = screen.getByTestId('pending-count-badge');
    expect(badge).toHaveTextContent('2');
    expect(badge.className).toContain('absolute');
  });
});
