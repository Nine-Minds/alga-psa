/**
 * @vitest-environment jsdom
 *
 * Ticket alga-2026-0003385: the wizard's "Import from Standard" dialogs used to
 * render a bare table header when getAvailableReferenceData returned nothing,
 * so a board that already had every standard status looked broken.
 */
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TicketingConfigStep } from '../../../../../packages/onboarding/src/components/steps/TicketingConfigStep';
import type { WizardData } from '@alga-psa/types';

const interpolate = (template: string, values: Record<string, unknown> = {}) =>
  template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key) => String(values[key] ?? ''));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      interpolate(String(options?.defaultValue ?? key), options),
  }),
  useI18n: () => ({
    locale: 'en',
    setLocale: vi.fn(),
  }),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'user-1' } }, status: 'authenticated' }),
}));

// Every server action the step imports is mocked: left real they open a tenant
// DB pool whose late rejection outlives the test file.
const mocks = vi.hoisted(() => ({
  getTenantTicketingData: vi.fn(),
  getAvailableReferenceData: vi.fn(),
  importReferenceData: vi.fn(),
}));

vi.mock('@alga-psa/onboarding/actions', () => ({
  getTenantTicketingData: mocks.getTenantTicketingData,
}));

vi.mock('@alga-psa/reference-data/actions', () => ({
  getAvailableReferenceData: mocks.getAvailableReferenceData,
  importReferenceData: mocks.importReferenceData,
  deleteReferenceDataItem: vi.fn(),
  deletePriority: vi.fn(),
  validatePriorityDeletion: vi.fn(),
  createPriority: vi.fn(),
}));

vi.mock('@alga-psa/tickets/actions/board-actions/boardActions', () => ({
  createBoard: vi.fn(),
  updateBoard: vi.fn(),
  deleteBoard: vi.fn(),
}));

vi.mock('@alga-psa/tickets/actions/board-actions/boardTicketStatusActions', () => ({
  createBoardTicketStatus: vi.fn(),
  updateBoardTicketStatus: vi.fn(),
}));

vi.mock('@alga-psa/tickets/actions/ticketCategoryActions', () => ({
  createCategory: vi.fn(),
}));

vi.mock('@alga-psa/auth/lib/preCheckDeletion', () => ({
  preCheckDeletion: vi.fn(),
}));

vi.mock('@alga-psa/ui', () => ({
  DeleteEntityDialog: () => null,
}));

const BOARD = {
  board_id: 'board-1',
  board_name: 'Support',
  is_default: true,
  display_order: 1,
};

const STANDARD_STATUS = {
  standard_status_id: 'std-status-1',
  name: 'In Progress',
  is_closed: false,
  is_default: false,
  display_order: 2,
  item_type: 'ticket' as const,
};

const makeWizardData = (overrides: Partial<WizardData> = {}): WizardData => ({
  firstName: '',
  lastName: '',
  tenantName: '',
  email: '',
  teamMembers: [],
  clientName: '',
  clientEmail: '',
  clientPhone: '',
  clientUrl: '',
  contactName: '',
  contactEmail: '',
  contactRole: '',
  serviceName: '',
  serviceDescription: '',
  servicePrice: '',
  contractLineName: 'hourly',
  currencyCode: 'USD',
  boardName: BOARD.board_name,
  boardId: BOARD.board_id,
  supportEmail: '',
  categories: [],
  priorities: [],
  ...overrides,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const renderStep = async (data: WizardData = makeWizardData()) => {
  await act(async () => {
    render(<TicketingConfigStep data={data} updateData={vi.fn()} />);
  });
};

const expandSection = async (name: 'Statuses' | 'Priorities') => {
  await userEvent.click(screen.getByRole('button', { name: new RegExp(name) }));
};

const openImportDialog = async (id: 'import-statuses-button' | 'import-priorities-button') => {
  await userEvent.click(document.getElementById(id) as HTMLElement);
};

beforeEach(() => {
  mocks.getTenantTicketingData.mockReset().mockResolvedValue({
    success: true,
    data: {
      boards: [BOARD],
      statuses: [
        {
          status_id: 'status-1',
          name: 'Open',
          board_id: BOARD.board_id,
          is_closed: false,
          is_default: true,
          order_number: 1,
        },
      ],
      priorities: [
        { priority_id: 'priority-1', priority_name: 'High', color: '#ff0000', order_number: 1 },
      ],
      categories: [],
    },
  });
  mocks.getAvailableReferenceData.mockReset().mockResolvedValue([]);
  mocks.importReferenceData.mockReset().mockResolvedValue({ success: true });
});

afterEach(cleanup);

describe('TicketingConfigStep import dialogs (alga-2026-0003385)', () => {
  it('shows loading, not the empty message, while the statuses fetch is pending', async () => {
    const pending = deferred<unknown[]>();
    mocks.getAvailableReferenceData.mockImplementation((type: string) =>
      type === 'statuses' ? pending.promise : Promise.resolve([])
    );

    await renderStep();
    await expandSection('Statuses');
    await openImportDialog('import-statuses-button');

    expect(screen.getByText('Loading available items...')).toBeInTheDocument();
    expect(
      screen.queryByText('This board already has all the standard statuses.')
    ).not.toBeInTheDocument();

    await act(async () => {
      pending.resolve([]);
    });

    await waitFor(() => {
      expect(
        screen.getByText('This board already has all the standard statuses.')
      ).toBeInTheDocument();
    });
    expect(screen.queryByText('Loading available items...')).not.toBeInTheDocument();
  });

  it('tells the user the board already has every standard status and offers no Import', async () => {
    await renderStep();
    await expandSection('Statuses');
    await openImportDialog('import-statuses-button');

    await waitFor(() => {
      expect(document.getElementById('import-statuses-empty-state')).toBeInTheDocument();
    });
    expect(document.getElementById('import-statuses-empty-state')).toHaveTextContent(
      'This board already has all the standard statuses.'
    );

    // No Import button at all (not even a disabled one), Cancel still available.
    expect(document.getElementById('confirm-import-statuses')).toBeNull();
    expect(document.getElementById('cancel-import-statuses')).toBeInTheDocument();
    expect(document.getElementById('select-all-statuses-checkbox')).toBeNull();
  });

  it('tells the user all standard priorities are imported', async () => {
    await renderStep();
    await expandSection('Priorities');
    await openImportDialog('import-priorities-button');

    await waitFor(() => {
      expect(document.getElementById('import-priorities-empty-state')).toBeInTheDocument();
    });
    expect(document.getElementById('import-priorities-empty-state')).toHaveTextContent(
      'All standard priorities are already imported.'
    );
    expect(document.getElementById('confirm-import-priorities')).toBeNull();
    expect(document.getElementById('cancel-import-priorities')).toBeInTheDocument();
  });

  it('does not strand the loading line when the fetch fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getAvailableReferenceData.mockRejectedValue(new Error('boom'));

    await renderStep();
    await expandSection('Statuses');
    await openImportDialog('import-statuses-button');

    await waitFor(() => {
      expect(screen.queryByText('Loading available items...')).not.toBeInTheDocument();
    });
    expect(document.getElementById('import-statuses-empty-state')).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it('still renders the table and an enabled Import when standards remain', async () => {
    mocks.getAvailableReferenceData.mockImplementation((type: string) =>
      Promise.resolve(type === 'statuses' ? [STANDARD_STATUS] : [])
    );

    await renderStep();
    await expandSection('Statuses');
    await openImportDialog('import-statuses-button');

    await waitFor(() => {
      expect(
        document.getElementById(`select-status-${STANDARD_STATUS.standard_status_id}-checkbox`)
      ).toBeInTheDocument();
    });
    expect(screen.getByText(STANDARD_STATUS.name)).toBeInTheDocument();
    expect(
      screen.queryByText('This board already has all the standard statuses.')
    ).not.toBeInTheDocument();

    const importButton = document.getElementById('confirm-import-statuses') as HTMLButtonElement;
    expect(importButton).toBeDisabled();

    await userEvent.click(
      document.getElementById(
        `select-status-${STANDARD_STATUS.standard_status_id}-checkbox`
      ) as HTMLElement
    );

    await waitFor(() => expect(importButton).not.toBeDisabled());
  });
});
