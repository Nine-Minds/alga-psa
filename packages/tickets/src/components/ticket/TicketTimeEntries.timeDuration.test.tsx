/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TicketTimeEntries from './TicketTimeEntries';
import type { TicketTimeEntriesSummary } from '@alga-psa/types';

const fetchTimeEntriesForTicket = vi.fn();

vi.mock('@alga-psa/ui/context', () => ({
  useSchedulingCallbacks: () => ({ fetchTimeEntriesForTicket }),
}));

vi.mock('@alga-psa/ui/components', () => ({
  useContentCardVariant: () => 'default',
}));

vi.mock('@alga-psa/ui/ui-reflection/withDataAutomationId', () => ({
  withDataAutomationId: ({ id }: { id: string }) => ({ 'data-testid': id }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useFormatters: () => ({ locale: 'en', dateFormat: 'MM/DD/YYYY' }),
  useTranslation: () => ({
    t: (_key: string, fallback?: string, values?: Record<string, unknown>) => {
      let result = fallback ?? _key;
      for (const [name, value] of Object.entries(values ?? {})) {
        result = result.replace(`{{${name}}}`, String(value));
      }
      return result;
    },
  }),
}));

const summary: TicketTimeEntriesSummary = {
  entries: [
    {
      entry_id: 'own-non-billable',
      user_id: 'user-me',
      user_name: 'Me',
      start_time: '2026-09-20T23:54:00.000Z',
      end_time: '2026-09-20T23:59:00.000Z',
      work_date: '2026-09-20',
      billable_duration: 0,
      notes: 'Ad-hoc non-billable',
      approval_status: 'DRAFT',
      service_id: null,
      service_name: 'Remote Support',
      is_own: true,
    },
    {
      entry_id: 'other-billable',
      user_id: 'user-other',
      user_name: 'Other',
      start_time: '2026-09-21T10:00:00.000Z',
      end_time: '2026-09-21T10:30:00.000Z',
      work_date: '2026-09-21',
      billable_duration: 45,
      notes: null,
      approval_status: 'APPROVED',
      service_id: null,
      service_name: null,
      is_own: false,
    },
  ],
  ownTotalMinutes: 5,
  ownEntryCount: 1,
  othersTotalMinutes: 30,
  othersEntryCount: 1,
  othersVisibleMinutes: 30,
  othersVisibleCount: 1,
  othersHiddenMinutes: 0,
  othersHiddenCount: 0,
  totalMinutes: 35,
};

describe('TicketTimeEntries worked duration and billability', () => {
  beforeEach(() => {
    fetchTimeEntriesForTicket.mockReset();
    fetchTimeEntriesForTicket.mockResolvedValue(summary);
  });

  it('renders timestamp-derived duration with a separate billability badge', async () => {
    render(<TicketTimeEntries id="ticket-time-entries" ticketId="ticket-1" currentUserId="user-me" />);

    // Own five-minute non-billable row: worked 5m, billed 0m.
    expect((await screen.findAllByText('0 hrs 5 min')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Non-billable')).toBeInTheDocument();
    // Headline total sums worked minutes only.
    expect(screen.getByText('0 hrs 35 min')).toBeInTheDocument();

    // Expand other team members to see the billable row.
    fireEvent.click(screen.getByTestId('ticket-time-entries-time-entries-others-toggle'));

    // Other row shows worked 30m even though billable is 45.
    expect(screen.getAllByText('0 hrs 30 min').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Billable')).toBeInTheDocument();
    // The billed value must not leak into any displayed duration.
    expect(screen.queryByText(/45/)).not.toBeInTheDocument();
  });
});
