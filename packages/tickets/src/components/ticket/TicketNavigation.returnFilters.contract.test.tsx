/* @vitest-environment jsdom */
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ITicketListFilters } from '@alga-psa/types';

/**
 * Contract guard for the "paging to the next ticket forgets the list's sort"
 * defect.
 *
 * `returnFilters` carries the list's state through the ticket detail URL as a
 * nested query string, so it must be percent-encoded every time it is written
 * into a URL. `useSearchParams().get()` hands back the *decoded* value, and
 * re-interpolating that raw made each `&`-separated pair after the first a
 * top-level param of the ticket URL — so only the first filter survived a
 * prev/next hop. The pager then recomputed position under the default sort and
 * Back to Tickets returned to an unsorted list.
 */

const getAdjacentTicketIds = vi.fn(async (_ticketId: string, _filters: ITicketListFilters) => ({
  prevTicketId: 'ticket-1',
  nextTicketId: 'ticket-3',
  prevTicketNumber: 'TIC001',
  nextTicketNumber: 'TIC003',
  currentPosition: 2,
  totalCount: 44,
}));

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
import { parseReturnFilters } from '../../lib/ticketFilterUtils';

const CONTACT_A = '44444444-5555-4666-8777-888888888888';

// Exactly what getCurrentFiltersQuery() emits for "status filter + contact
// filter + sort by Last Activity", i.e. more than one pair.
const LIST_STATE =
  `statusId=status-open&contactId=${CONTACT_A}&sortBy=latest_activity_at&sortDirection=asc`;

describe('TicketNavigation returnFilters round-trip', () => {
  const originalLocation = window.location;
  let assignedHref: string | null;

  beforeEach(() => {
    assignedHref = null;
    getAdjacentTicketIds.mockClear();
    // useSearchParams() returns decoded values, which is what the component reads.
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

  it('re-encodes the whole list state into the next ticket URL', async () => {
    const { getByLabelText } = render(<TicketNavigation currentTicketId="ticket-2" />);

    await waitFor(() => expect(getByLabelText('Next ticket')).toBeTruthy());
    (getByLabelText('Next ticket') as HTMLButtonElement).click();

    expect(assignedHref).not.toBeNull();
    const nextUrl = new URL(assignedHref!, 'https://example.test');
    expect(nextUrl.pathname).toBe('/msp/tickets/ticket-3');

    // The nested query string must arrive whole: one param, nothing orphaned.
    expect([...nextUrl.searchParams.keys()]).toEqual(['returnFilters']);
    expect(nextUrl.searchParams.get('returnFilters')).toBe(LIST_STATE);

    // ...and it must still parse back to the sort the list was using.
    const restored = parseReturnFilters(nextUrl.searchParams.get('returnFilters')!);
    expect(restored.sortBy).toBe('latest_activity_at');
    expect(restored.sortDirection).toBe('asc');
    expect(restored.statusId).toBe('status-open');
    // The contact filter is list state like any other: it has to survive the
    // hop so Back to Tickets returns to the same narrowed list.
    expect(restored.contactId).toBe(CONTACT_A);
  });

  it('uses the same list state for the pager it hands to the next URL', async () => {
    render(<TicketNavigation currentTicketId="ticket-2" />);

    await waitFor(() => expect(getAdjacentTicketIds).toHaveBeenCalled());
    const [, filters] = getAdjacentTicketIds.mock.calls[0]!;
    expect(filters.sortBy).toBe('latest_activity_at');
    expect(filters.sortDirection).toBe('asc');
    expect(filters.statusId).toBe('status-open');
    expect(filters.contactId).toBe(CONTACT_A);
  });

  it('omits returnFilters entirely when the URL carries none', async () => {
    searchParams = new URLSearchParams();
    const { getByLabelText } = render(<TicketNavigation currentTicketId="ticket-2" />);

    await waitFor(() => expect(getByLabelText('Next ticket')).toBeTruthy());
    (getByLabelText('Next ticket') as HTMLButtonElement).click();

    expect(assignedHref).toBe('/msp/tickets/ticket-3');
  });
});
