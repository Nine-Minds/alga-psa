/**
 * @vitest-environment jsdom
 *
 * In a co-managed workspace the provisioned board is shared with the MSP. The
 * Ticketing step showed nothing of that: deleting the board silently removed
 * the MSP's oversight, and moving the default board sent new requests where the
 * MSP cannot see them.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ticketingData: vi.fn(),
  sharedBoardIds: vi.fn(),
}));

vi.mock('@alga-psa/onboarding/actions', () => ({
  getTenantTicketingData: mocks.ticketingData,
  getCoManagedSharedBoardIds: mocks.sharedBoardIds,
}));
vi.mock('@alga-psa/reference-data/actions', () => ({
  getAvailableReferenceData: vi.fn(async () => []), importReferenceData: vi.fn(), deleteReferenceDataItem: vi.fn(),
  deletePriority: vi.fn(), validatePriorityDeletion: vi.fn(), createPriority: vi.fn(),
}));
vi.mock('@alga-psa/tickets/actions/board-actions/boardActions', () => ({ createBoard: vi.fn(), updateBoard: vi.fn() }));
vi.mock('@alga-psa/tickets/actions/board-actions/boardTicketStatusActions', () => ({
  createBoardTicketStatus: vi.fn(), updateBoardTicketStatus: vi.fn(),
}));
vi.mock('@alga-psa/tickets/actions/ticketCategoryActions', () => ({ createCategory: vi.fn() }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null, status: 'unauthenticated' }) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key) }),
}));

import { TicketingConfigStep } from '../../../../../packages/onboarding/src/components/steps/TicketingConfigStep';

const board = (board_id: string, board_name: string, is_default: boolean) =>
  ({ board_id, board_name, is_default, display_order: 0, category_type: 'custom', priority_type: 'custom' });
const data = { boardId: '', boardName: '', supportEmail: '', categories: [], priorities: [], statuses: [] } as any;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sharedBoardIds.mockResolvedValue(['service-desk']);
});
afterEach(cleanup);

async function openBoards() {
  render(<TicketingConfigStep data={data} updateData={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /^Boards/ }));
}

describe('TicketingConfigStep shared co-managed boards', () => {
  it('marks the boards shared with the MSP', async () => {
    mocks.ticketingData.mockResolvedValue({ success: true, data: { boards: [board('service-desk', 'Service Desk', true),
      board('general', 'General Support', false)], statuses: [], priorities: [], categories: [] } });
    await openBoards();
    expect(await screen.findByText('Shared with your MSP')).toBeInTheDocument();
    expect(screen.getAllByText('Shared with your MSP')).toHaveLength(1);
    expect(screen.queryByText(/not shared with your MSP/)).not.toBeInTheDocument();
  });

  it('warns when new requests would land on a board the MSP cannot see', async () => {
    mocks.ticketingData.mockResolvedValue({ success: true, data: { boards: [board('service-desk', 'Service Desk', false),
      board('general', 'General Support', true)], statuses: [], priorities: [], categories: [] } });
    await openBoards();
    expect(await screen.findByText(/New requests go to the default board, which is not shared with your MSP/)).toBeInTheDocument();
  });

  it('shows neither outside a co-managed workspace', async () => {
    mocks.sharedBoardIds.mockResolvedValue([]);
    mocks.ticketingData.mockResolvedValue({ success: true, data: { boards: [board('general', 'General Support', true)],
      statuses: [], priorities: [], categories: [] } });
    await openBoards();
    expect(await screen.findByText('General Support')).toBeInTheDocument();
    expect(screen.queryByText('Shared with your MSP')).not.toBeInTheDocument();
    expect(screen.queryByText(/not shared with your MSP/)).not.toBeInTheDocument();
  });
});
