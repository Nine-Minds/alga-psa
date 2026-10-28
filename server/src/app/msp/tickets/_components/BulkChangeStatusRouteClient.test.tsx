// @vitest-environment jsdom

import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getBoardTicketStatuses: vi.fn(),
  getBoardCloseRules: vi.fn(),
  handleError: vi.fn(),
  routeState: { selectedTicketsSharedBoardId: 'board-1' as string | null, isResolvingSelectedBoards: false },
  dialogProps: [] as any[],
}));

vi.mock('@alga-psa/tickets/actions/board-actions/boardTicketStatusActions', () => ({
  getBoardTicketStatuses: mocks.getBoardTicketStatuses,
}));
vi.mock('@alga-psa/tickets/actions/close-rules/closeRuleActions', () => ({
  getBoardCloseRules: mocks.getBoardCloseRules,
}));
vi.mock('@alga-psa/tickets/actions/ticketActions', () => ({ bulkUpdateTicketStatus: vi.fn() }));
vi.mock('@alga-psa/tickets/components/TicketsRouteProvider', () => ({
  useTicketsRouteState: () => mocks.routeState,
}));
vi.mock('@alga-psa/tickets/components/BulkChangeStatusDialog', () => ({
  default: (props: any) => {
    mocks.dialogProps.push(props);
    return (
      <div
        data-testid="dialog"
        data-required={String(props.resolutionRequired)}
        data-loading={String(props.isLoadingStatuses)}
        data-status-count={props.statuses.length}
      />
    );
  },
}));
vi.mock('./TicketBulkRouteHelpers', () => ({
  useTicketBulkRouteDialog: () => ({
    t: (_key: string, fallback?: string) => fallback ?? '',
    close: vi.fn(),
    refreshList: vi.fn(),
    refreshAndClose: vi.fn(),
    handleError: mocks.handleError,
    selectedTicketCount: 2,
    selectedTicketIdsArray: ['t1', 't2'],
    labelFailures: (f: unknown[]) => f,
    keepFailedSelection: vi.fn(),
    toastBulkResult: vi.fn(),
  }),
}));

import BulkChangeStatusRouteClient from './BulkChangeStatusRouteClient';

const STATUS_ROWS = [
  { status_id: 's-open', name: 'Open', is_closed: false },
  { status_id: 's-closed', name: 'Closed', is_closed: true },
];

const rules = (over: Record<string, unknown>) => ({
  board_id: 'board-1',
  is_enabled: true,
  require_resolution_comment: true,
  ...over,
});

const dialog = () => screen.getByTestId('dialog');

async function renderClient() {
  render(<BulkChangeStatusRouteClient closeMode="back" />);
  await waitFor(() => expect(dialog()).toHaveAttribute('data-loading', 'false'));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.routeState = { selectedTicketsSharedBoardId: 'board-1', isResolvingSelectedBoards: false };
  mocks.getBoardTicketStatuses.mockResolvedValue(STATUS_ROWS);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('BulkChangeStatusRouteClient resolutionRequired', () => {
  it('is true only for enabled rules that require a resolution comment', async () => {
    mocks.getBoardCloseRules.mockResolvedValue(rules({}));
    await renderClient();
    expect(dialog()).toHaveAttribute('data-required', 'true');
  });

  it.each([
    ['rules disabled', { is_enabled: false }],
    ['resolution not required', { require_resolution_comment: false }],
  ])('is false when %s', async (_name, over) => {
    mocks.getBoardCloseRules.mockResolvedValue(rules(over));
    await renderClient();
    expect(dialog()).toHaveAttribute('data-required', 'false');
  });

  it('falls back to false, keeps the status list and does not raise an error when close rules reject', async () => {
    mocks.getBoardCloseRules.mockRejectedValue(new Error('boom'));
    await renderClient();
    expect(dialog()).toHaveAttribute('data-required', 'false');
    expect(dialog()).toHaveAttribute('data-status-count', '2');
    expect(mocks.handleError).not.toHaveBeenCalled();
  });

  it('falls back to false when the close rules action returns an error', async () => {
    mocks.getBoardCloseRules.mockResolvedValue({ message: 'nope' });
    await renderClient();
    expect(dialog()).toHaveAttribute('data-required', 'false');
    expect(dialog()).toHaveAttribute('data-status-count', '2');
    expect(mocks.handleError).not.toHaveBeenCalled();
  });

  it('stays loading until both calls settle', async () => {
    let resolveRules!: (value: unknown) => void;
    mocks.getBoardCloseRules.mockReturnValue(new Promise((resolve) => { resolveRules = resolve; }));
    render(<BulkChangeStatusRouteClient closeMode="back" />);
    await act(() => Promise.resolve());
    expect(dialog()).toHaveAttribute('data-loading', 'true');

    await act(async () => { resolveRules(rules({})); });
    await waitFor(() => expect(dialog()).toHaveAttribute('data-loading', 'false'));
    expect(dialog()).toHaveAttribute('data-required', 'true');
  });

  it('is false and loads nothing when the board is unresolved', async () => {
    mocks.routeState = { selectedTicketsSharedBoardId: null, isResolvingSelectedBoards: false };
    render(<BulkChangeStatusRouteClient closeMode="back" />);
    expect(dialog()).toHaveAttribute('data-required', 'false');
    expect(mocks.getBoardCloseRules).not.toHaveBeenCalled();
  });
});
