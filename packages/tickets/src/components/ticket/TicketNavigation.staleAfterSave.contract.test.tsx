/* @vitest-environment jsdom */
import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ITicketListFilters } from '@alga-psa/types';
import type { AdjacentTicketData } from './TicketNavigation';

/**
 * Contract guard for the "ticket navigation disappears after saving" defect.
 *
 * Saving refreshes the detail page, which recomputes the pager against the
 * list filters carried in `returnFilters`. The saved ticket may no longer match
 * them — closing a ticket opened from an open-only list drops it out — so the
 * lookup comes back with no neighbors and currentPosition 0, and the pager used
 * to unmount mid-session. The last known neighbors have to survive that refresh
 * so the user can keep paging. A deep link with no previous pager still renders
 * nothing.
 */

const PAGER: AdjacentTicketData = {
  prevTicketId: 'ticket-1',
  nextTicketId: 'ticket-3',
  prevTicketNumber: 'TIC001',
  nextTicketNumber: 'TIC003',
  currentPosition: 2,
  totalCount: 44,
};

// What the server reports once the saved ticket no longer matches the filters.
const DROPPED_OUT: AdjacentTicketData = {
  prevTicketId: null,
  nextTicketId: null,
  prevTicketNumber: null,
  nextTicketNumber: null,
  currentPosition: 0,
  totalCount: 43,
};

const getAdjacentTicketIds = vi.fn(
  async (_ticketId: string, _filters: ITicketListFilters): Promise<AdjacentTicketData | null> =>
    PAGER,
);

let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock('@alga-psa/ui/keyboard-shortcuts', () => ({
  useCatalogShortcut: () => undefined,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button type="button" {...props}>{children}</button>
  ),
}));

vi.mock('../../actions/optimizedTicketActions', () => ({
  getAdjacentTicketIds: (...args: Parameters<typeof getAdjacentTicketIds>) =>
    getAdjacentTicketIds(...args),
}));

import TicketNavigation from './TicketNavigation';

const LIST_STATE = 'statusId=status-open&sortBy=latest_activity_at&sortDirection=asc';

describe('TicketNavigation survives a post-save refresh', () => {
  const originalLocation = window.location;
  let assignedHref: string | null;

  beforeEach(() => {
    assignedHref = null;
    getAdjacentTicketIds.mockReset();
    getAdjacentTicketIds.mockImplementation(async () => PAGER);
    searchParams = new URLSearchParams(`returnFilters=${encodeURIComponent(LIST_STATE)}`);
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        set href(value: string) { assignedHref = value; },
        get href() { return assignedHref ?? ''; },
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('keeps the pager when the refreshed server lookup drops the ticket', async () => {
    const { getByLabelText, getByText, rerender } = render(
      <TicketNavigation currentTicketId="ticket-2" initialAdjacent={Promise.resolve(PAGER)} />,
    );

    await waitFor(() => expect(getByLabelText('Next ticket')).toBeTruthy());
    expect(getByText('2 / 44')).toBeTruthy();

    // The save handler refreshes the page: a new server promise arrives, and the
    // saved ticket is no longer in the filtered list.
    const refreshed = Promise.resolve(DROPPED_OUT);
    rerender(<TicketNavigation currentTicketId="ticket-2" initialAdjacent={refreshed} />);
    await act(async () => { await refreshed; });

    // Both buttons and the position label must still be there...
    expect(getByLabelText('Previous ticket')).toBeTruthy();
    expect(getByLabelText('Next ticket')).toBeTruthy();
    expect(getByText('2 / 44')).toBeTruthy();

    // ...and paging must still work, with the list state carried along.
    (getByLabelText('Next ticket') as HTMLButtonElement).click();
    expect(assignedHref).not.toBeNull();
    const nextUrl = new URL(assignedHref!, 'https://example.test');
    expect(nextUrl.pathname).toBe('/msp/tickets/ticket-3');
    expect(nextUrl.searchParams.get('returnFilters')).toBe(LIST_STATE);
  });

  it('renders no pager for a deep link outside the list context', async () => {
    const { container, queryByLabelText } = render(
      <TicketNavigation currentTicketId="ticket-2" initialAdjacent={Promise.resolve(DROPPED_OUT)} />,
    );

    await waitFor(() => expect(container.innerHTML).toBe(''));
    expect(queryByLabelText('Next ticket')).toBeNull();
    expect(queryByLabelText('Previous ticket')).toBeNull();
  });

  it('keeps the pager when the client refetch drops the ticket', async () => {
    const { getByLabelText, getByText, rerender } = render(
      <TicketNavigation currentTicketId="ticket-2" />,
    );

    await waitFor(() => expect(getByLabelText('Next ticket')).toBeTruthy());
    expect(getAdjacentTicketIds).toHaveBeenCalledTimes(1);

    // New list state re-runs the client lookup, which now excludes the ticket.
    const NARROWED_STATE = 'statusId=status-open&sortBy=ticket_number&sortDirection=desc';
    searchParams = new URLSearchParams(`returnFilters=${encodeURIComponent(NARROWED_STATE)}`);
    getAdjacentTicketIds.mockImplementation(async () => DROPPED_OUT);
    rerender(<TicketNavigation currentTicketId="ticket-2" />);

    await waitFor(() => expect(getAdjacentTicketIds).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(getByLabelText('Next ticket')).toBeTruthy());
    expect(getByText('2 / 44')).toBeTruthy();

    (getByLabelText('Next ticket') as HTMLButtonElement).click();
    const nextUrl = new URL(assignedHref!, 'https://example.test');
    expect(nextUrl.pathname).toBe('/msp/tickets/ticket-3');
    expect(nextUrl.searchParams.get('returnFilters')).toBe(NARROWED_STATE);
  });
});
