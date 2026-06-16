/** @vitest-environment jsdom */

// Regression test for selection surviving a reload. The bulk-action modal routes are
// sibling subtrees that can't read the list page's React state, so selection is lifted to
// TicketsRouteProvider and persisted to sessionStorage. A full reload of a modal route
// renders the non-intercepted route (a fresh provider) — unmount + remount here simulates
// that reload and asserts the persisted selection is rehydrated.

import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TicketsRouteProvider, useTicketsRouteState } from '../TicketsRouteProvider';

function Consumer() {
  const {
    selectedTicketIds,
    selectedTicketDetails,
    selectionHydrated,
    setSelectedTicketIds,
    setSelectedTicketDetails,
    clearSelectedTicketIds,
  } = useTicketsRouteState();

  return (
    <div>
      <span data-testid="hydrated">{String(selectionHydrated)}</span>
      <span data-testid="ids">{Array.from(selectedTicketIds).join(',')}</span>
      <span data-testid="details">{selectedTicketDetails.map((d) => d.ticket_number).join(',')}</span>
      <button
        type="button"
        onClick={() => {
          setSelectedTicketIds(new Set(['t1', 't2']));
          setSelectedTicketDetails([
            { ticket_id: 't1', ticket_number: 'TIC-1' },
            { ticket_id: 't2', ticket_number: 'TIC-2' },
          ]);
        }}
      >
        select
      </button>
      <button type="button" onClick={() => clearSelectedTicketIds()}>
        clear
      </button>
    </div>
  );
}

const STORAGE_KEY = 'tickets:route-selection';

function renderProvider() {
  return render(
    <TicketsRouteProvider>
      <Consumer />
    </TicketsRouteProvider>,
  );
}

describe('TicketsRouteProvider selection persistence', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('rehydrates the selection from sessionStorage after a remount (reload)', async () => {
    const first = renderProvider();
    await waitFor(() => expect(screen.getByTestId('hydrated')).toHaveTextContent('true'));

    fireEvent.click(screen.getByText('select'));
    await waitFor(() =>
      expect(window.sessionStorage.getItem(STORAGE_KEY)).toContain('t1'),
    );

    // Simulate a full page reload: tear down and mount a brand-new provider.
    first.unmount();
    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('hydrated')).toHaveTextContent('true');
      expect(screen.getByTestId('ids')).toHaveTextContent('t1,t2');
      expect(screen.getByTestId('details')).toHaveTextContent('TIC-1,TIC-2');
    });
  });

  it('clears persisted selection so a later reload starts empty', async () => {
    const first = renderProvider();
    await waitFor(() => expect(screen.getByTestId('hydrated')).toHaveTextContent('true'));

    fireEvent.click(screen.getByText('select'));
    await waitFor(() => expect(window.sessionStorage.getItem(STORAGE_KEY)).toContain('t1'));

    fireEvent.click(screen.getByText('clear'));
    await waitFor(() => expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull());

    first.unmount();
    renderProvider();

    await waitFor(() => expect(screen.getByTestId('hydrated')).toHaveTextContent('true'));
    expect(screen.getByTestId('ids')).toHaveTextContent('');
  });
});
