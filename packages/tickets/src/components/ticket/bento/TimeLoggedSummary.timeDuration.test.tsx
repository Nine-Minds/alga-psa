/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TimeLoggedSummary } from './TimeLoggedSummary';
import type { TicketTimeEntriesSummary, TicketTimeEntrySummaryEntry } from '@alga-psa/types';

const fetchTimeEntriesForTicket = vi.fn();

vi.mock('@alga-psa/ui/context', () => ({
  useSchedulingCallbacks: () => ({ fetchTimeEntriesForTicket }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useFormatters: () => ({ locale: 'en' }),
  useTranslation: () => ({
    t: (
      key: string,
      fallbackOrOptions?: string | Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => {
      const fallback = typeof fallbackOrOptions === 'string' ? fallbackOrOptions : undefined;
      const values = typeof fallbackOrOptions === 'object' ? fallbackOrOptions : options;
      let result = fallback ?? key;
      for (const [name, value] of Object.entries(values ?? {})) {
        result = result.replace(`{{${name}}}`, String(value));
      }
      return result;
    },
  }),
}));

function entry(overrides: Partial<TicketTimeEntrySummaryEntry> & { entry_id: string }): TicketTimeEntrySummaryEntry {
  return {
    user_id: 'user-me',
    user_name: 'Me',
    start_time: '2026-09-19T10:00:00.000Z',
    end_time: '2026-09-19T10:00:00.000Z',
    work_date: '2026-09-19',
    billable_duration: 0,
    notes: null,
    approval_status: 'DRAFT',
    service_id: null,
    service_name: null,
    is_own: true,
    ...overrides,
  };
}

function summaryWith(entries: TicketTimeEntrySummaryEntry[]): TicketTimeEntriesSummary {
  const total = entries.reduce((sum, item) => sum + (item.billable_duration ?? 0), 0);
  return {
    entries,
    ownTotalMinutes: total,
    ownEntryCount: entries.length,
    othersTotalMinutes: 0,
    othersEntryCount: 0,
    othersVisibleMinutes: 0,
    othersVisibleCount: 0,
    othersHiddenMinutes: 0,
    othersHiddenCount: 0,
    totalMinutes: total,
  };
}

describe('TimeLoggedSummary worked duration', () => {
  beforeEach(() => {
    fetchTimeEntriesForTicket.mockReset();
  });

  it('uses worked minutes for the headline and daily buckets, not billable_duration', async () => {
    fetchTimeEntriesForTicket.mockResolvedValue(
      summaryWith([
        entry({
          entry_id: 'non-billable-5',
          work_date: '2026-09-19',
          start_time: '2026-09-19T23:54:00.000Z',
          end_time: '2026-09-19T23:59:00.000Z',
          billable_duration: 0,
        }),
        entry({
          entry_id: 'billable-30',
          work_date: '2026-09-20',
          start_time: '2026-09-20T10:00:00.000Z',
          end_time: '2026-09-20T10:30:00.000Z',
          billable_duration: 45,
          approval_status: 'APPROVED',
        }),
      ]),
    );

    render(<TimeLoggedSummary id="time-logged" ticketId="ticket-1" />);

    // Worked 5 + 30 = 35; the billed 45 must not surface.
    expect(await screen.findByText('0 hrs 35 min')).toBeInTheDocument();
    expect(screen.getByTitle('Sep 19: 0 hrs 5 min')).toBeInTheDocument();
    expect(screen.getByTitle('Sep 20: 0 hrs 30 min')).toBeInTheDocument();
    expect(screen.queryByText(/45/)).not.toBeInTheDocument();
  });

  it('aggregates the day bucket from worked minutes across entries', async () => {
    fetchTimeEntriesForTicket.mockResolvedValue(
      summaryWith([
        entry({
          entry_id: 'day-1-a',
          work_date: '2026-09-19',
          start_time: '2026-09-19T09:00:00.000Z',
          end_time: '2026-09-19T09:05:00.000Z',
          billable_duration: 0,
        }),
        entry({
          entry_id: 'day-1-b',
          work_date: '2026-09-19',
          start_time: '2026-09-19T11:00:00.000Z',
          end_time: '2026-09-19T11:10:00.000Z',
          billable_duration: 0,
        }),
        entry({
          entry_id: 'day-2-a',
          work_date: '2026-09-20',
          start_time: '2026-09-20T09:00:00.000Z',
          end_time: '2026-09-20T09:20:00.000Z',
          billable_duration: 0,
        }),
      ]),
    );

    render(<TimeLoggedSummary id="time-logged" ticketId="ticket-1" />);

    expect(await screen.findByText('0 hrs 35 min')).toBeInTheDocument();
    expect(screen.getByTitle('Sep 19: 0 hrs 15 min')).toBeInTheDocument();
    expect(screen.getByTitle('Sep 20: 0 hrs 20 min')).toBeInTheDocument();
  });
});
