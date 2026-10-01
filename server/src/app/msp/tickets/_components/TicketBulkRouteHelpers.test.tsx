// @vitest-environment jsdom

// Regression test for "dialog stays open after page refresh". A refresh of a bulk URL is
// handled by the plain route, which now redirects to the list (see
// ticketsModalRoutes.contract.test.ts) instead of re-rendering the dialog over the
// selection rehydrated from sessionStorage. This covers the other half: completing the
// action clears the selection, which wipes the persisted copy and arms the
// empty-selection guard that performs the single close.

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TicketsRouteProvider } from '@alga-psa/tickets/components/TicketsRouteProvider';
import { useTicketBulkRouteDialog, type TicketBulkCloseMode } from './TicketBulkRouteHelpers';

const router = vi.hoisted(() => ({
  back: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), custom: vi.fn(), dismiss: vi.fn() },
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: string | { defaultValue?: string }) =>
      (typeof options === 'string' ? options : options?.defaultValue) ?? '',
  }),
}));

const STORAGE_KEY = 'tickets:route-selection';

function Harness({ closeMode }: { closeMode: TicketBulkCloseMode }) {
  const { refreshAndClose, selectedTicketCount } = useTicketBulkRouteDialog(closeMode);

  return (
    <div>
      <span data-testid="count">{selectedTicketCount}</span>
      <button type="button" onClick={() => refreshAndClose()}>
        complete
      </button>
    </div>
  );
}

function renderRoute(closeMode: TicketBulkCloseMode) {
  return render(
    <TicketsRouteProvider>
      <Harness closeMode={closeMode} />
    </TicketsRouteProvider>,
  );
}

function seedSelection() {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
    ids: ['t1', 't2'],
    details: [
      { ticket_id: 't1', ticket_number: 'TIC-1' },
      { ticket_id: 't2', ticket_number: 'TIC-2' },
    ],
    sharedBoardId: 'board-1',
  }));
}

describe('useTicketBulkRouteDialog completion', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    router.back.mockClear();
    router.replace.mockClear();
    router.refresh.mockClear();
  });

  it('clears the persisted selection and closes exactly once on full success', async () => {
    seedSelection();

    renderRoute('back');
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'));
    expect(router.back).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('complete'));

    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('bounces a fresh mount with nothing left to rehydrate', async () => {
    seedSelection();

    const first = renderRoute('replace');
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'));

    fireEvent.click(screen.getByText('complete'));
    await waitFor(() => expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull());

    // A brand-new provider with nothing left in sessionStorage to rehydrate must send the
    // user to the list rather than render a dialog over an empty selection.
    first.unmount();
    router.replace.mockClear();
    renderRoute('replace');

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/msp/tickets'));
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('count').textContent).toBe('0');
  });
});
