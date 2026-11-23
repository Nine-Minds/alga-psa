/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

const ENTRY_ID = '3f2b8c1e-6a4d-4e7b-9c1a-2d5e8f0a7b64';

const hoisted = vi.hoisted(() => ({
  search: '',
  panelProps: [] as any[],
  calendarProps: [] as any[],
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

vi.mock('../src/components/schedule/ScheduleCalendar', () => ({
  default: (props: any) => {
    hoisted.calendarProps.push(props);
    return null;
  },
}));
vi.mock('../src/components/schedule/AvailabilitySettings', () => ({ default: () => null }));
vi.mock('../src/components/schedule/AppointmentRequestsPanel', () => ({
  default: (props: any) => {
    hoisted.panelProps.push(props);
    return null;
  },
}));

import SchedulePage from '../src/components/schedule/SchedulePage';

const lastCalendar = () => hoisted.calendarProps[hoisted.calendarProps.length - 1];

describe('SchedulePage ?entryId deep link', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    hoisted.panelProps.length = 0;
    hoisted.calendarProps.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('passes the entry to the calendar and stops passing it once handled', async () => {
    hoisted.search = `entryId=${ENTRY_ID}`;
    render(<SchedulePage />);
    await act(async () => {});

    expect(lastCalendar().deepLink).toEqual({ entryId: ENTRY_ID });
    await act(async () => {
      lastCalendar().onDeepLinkHandled();
    });
    expect(lastCalendar().deepLink).toBeNull();
  });

  it('parses the occurrence and ignores a malformed one', async () => {
    hoisted.search = `entryId=${ENTRY_ID}&occurrence=2031-03-10T09%3A00%3A00.000Z`;
    render(<SchedulePage />);
    await act(async () => {});
    expect(lastCalendar().deepLink).toEqual({ entryId: ENTRY_ID, occurrence: new Date('2031-03-10T09:00:00.000Z') });

    hoisted.calendarProps.length = 0;
    hoisted.search = `entryId=${ENTRY_ID}&occurrence=garbage`;
    render(<SchedulePage />);
    await act(async () => {});
    expect(lastCalendar().deepLink).toEqual({ entryId: ENTRY_ID });
  });

  it('passes no link without the parameter, and leaves the requests panel closed', async () => {
    hoisted.search = '';
    render(<SchedulePage />);
    await act(async () => {});
    expect(lastCalendar().deepLink).toBeNull();
    expect(hoisted.panelProps[hoisted.panelProps.length - 1].isOpen).toBe(false);
  });
});
