/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

const REQUEST_ID = '3f2b8c1e-6a4d-4e7b-9c1a-2d5e8f0a7b64';

const hoisted = vi.hoisted(() => ({
  search: '',
  panelProps: [] as any[],
}));

vi.mock('@alga-psa/scheduling/actions', () => ({
  getAppointmentRequests: vi.fn(async () => ({ success: true, data: [] })),
  getAvailabilitySettingsAccess: vi.fn(async () => ({
    success: true,
    data: { canReadSystemSettings: true, canManageUserHours: true },
  })),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(hoisted.search),
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
    <button id={id} className={className} onClick={onClick}>{children}</button>
  ),
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('../src/components/schedule/ScheduleCalendar', () => ({ default: () => null }));
vi.mock('../src/components/schedule/AvailabilitySettings', () => ({ default: () => null }));
vi.mock('../src/components/schedule/AppointmentRequestsPanel', () => ({
  default: (props: any) => {
    hoisted.panelProps.push(props);
    return null;
  },
}));

import SchedulePage from '../src/components/schedule/SchedulePage';

describe('SchedulePage ?requestId deep link', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    hoisted.panelProps.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('opens the requests panel with the request highlighted', async () => {
    hoisted.search = `requestId=${REQUEST_ID}`;
    render(<SchedulePage />);
    await act(async () => {});

    const last = hoisted.panelProps[hoisted.panelProps.length - 1];
    expect(last.isOpen).toBe(true);
    expect(last.highlightedRequestId).toBe(REQUEST_ID);
  });

  it('keeps the panel closed with nothing highlighted when there is no parameter', async () => {
    hoisted.search = '';
    render(<SchedulePage />);
    await act(async () => {});

    const last = hoisted.panelProps[hoisted.panelProps.length - 1];
    expect(last.isOpen).toBe(false);
    expect(last.highlightedRequestId).toBeNull();
  });
});
