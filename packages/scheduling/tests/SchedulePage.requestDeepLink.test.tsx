/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

const REQUEST_ID = '3f2b8c1e-6a4d-4e7b-9c1a-2d5e8f0a7b64';

const hoisted = vi.hoisted(() => ({
  search: '',
  panelProps: [] as any[],
  calendarProps: [] as any[],
  push: vi.fn(),
  replace: vi.fn(),
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
  usePathname: () => '/msp/schedule',
  useRouter: () => ({ push: hoisted.push, replace: hoisted.replace }),
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

vi.mock('../src/components/schedule/ScheduleCalendar', () => ({ default: (props: any) => { hoisted.calendarProps.push(props); return null; } }));
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
    hoisted.calendarProps.length = 0;
    hoisted.push.mockClear();
    hoisted.replace.mockClear();
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

  it('restores an ordinary schedule entry selection and its day window from URL state', async () => {
    hoisted.search = `entryId=${REQUEST_ID}&scheduleDate=2026-11-04&scheduleView=day`;
    render(<SchedulePage />);
    await act(async () => {});

    expect(hoisted.calendarProps.at(-1).entrySelection).toEqual({
      entryId: REQUEST_ID,
      date: '2026-11-04',
      view: 'day',
    });
  });

  it('restores a precise recurring occurrence while retaining appointment-request links', async () => {
    hoisted.search = `entryId=${REQUEST_ID}&occurrenceStart=2026-11-04T09%3A30%3A00.000Z&scheduleDate=2026-11-04&scheduleView=day&requestId=${REQUEST_ID}`;
    render(<SchedulePage />);
    await act(async () => {});

    expect(hoisted.calendarProps.at(-1).entrySelection).toEqual({
      entryId: REQUEST_ID,
      occurrenceStart: '2026-11-04T09:30:00.000Z',
      date: '2026-11-04',
      view: 'day',
    });
    expect(hoisted.panelProps.at(-1)).toMatchObject({ isOpen: true, highlightedRequestId: REQUEST_ID });
  });

  it('drops malformed or incomplete entry identities without passing them to the calendar', async () => {
    hoisted.search = 'entryId=not-a-uuid&occurrenceStart=bad';
    render(<SchedulePage />);
    await act(async () => {});

    expect(hoisted.calendarProps.at(-1).entrySelection).toBeNull();
    expect(hoisted.replace).toHaveBeenCalledWith('/msp/schedule', { scroll: false });
  });
});
