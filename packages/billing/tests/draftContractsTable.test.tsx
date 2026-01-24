/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let mockDraftContracts: any[] = [];
let mockDraftResumeData: any = {};

const mockRouter = {
  push: vi.fn(),
  replace: vi.fn(),
};

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => new URLSearchParams('tab=contracts&subtab=drafts'),
}));

vi.mock('@alga-psa/ui/components/CustomTabs', () => ({
  default: ({
    tabs,
    defaultTab,
  }: {
    tabs: Array<{ label: string; content: React.ReactNode }>;
    defaultTab: string;
  }) => {
    const tab = tabs.find((t) => t.label === defaultTab) ?? tabs[0];
    return (
      <div>
        <div>{tabs.map((t) => t.label).join(' | ')}</div>
        <div>{tab?.content}</div>
      </div>
    );
  },
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({
    isOpen,
    title,
    message,
    cancelLabel,
    confirmLabel,
    onClose,
    onConfirm,
    isConfirming,
  }: {
    isOpen: boolean;
    title: string;
    message: string;
    cancelLabel: string;
    confirmLabel: string;
    onClose: () => void;
    onConfirm: () => void;
    isConfirming?: boolean;
  }) =>
    isOpen ? (
      <div data-testid="confirmation-dialog" data-confirming={isConfirming ? 'true' : 'false'}>
        <div>{title}</div>
        <div>{message}</div>
        <button type="button" onClick={onClose}>
          {cancelLabel}
        </button>
        <button type="button" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    ) : null,
}));

vi.mock('../src/components/billing-dashboard/contracts/ContractWizard', () => ({
  ContractWizard: ({ open, editingContract }: { open: boolean; editingContract?: any }) =>
    open ? (
      <div
        data-testid="contract-wizard"
        data-contract-id={editingContract?.contract_id ?? ''}
        data-client-id={editingContract?.client_id ?? ''}
        data-contract-name={editingContract?.contract_name ?? ''}
      />
    ) : null,
}));

vi.mock('../src/components/billing-dashboard/contracts/template-wizard/TemplateWizard', () => ({
  TemplateWizard: () => null,
}));

vi.mock('../src/components/billing-dashboard/contracts/ContractDialog', () => ({
  ContractDialog: () => null,
}));

vi.mock('@alga-psa/billing/actions/contractActions', () => ({
  checkClientHasActiveContract: vi.fn(async () => false),
  deleteContract: vi.fn(async () => undefined),
  getContractTemplates: vi.fn(async () => []),
  getContractsWithClients: vi.fn(async () => []),
  getDraftContracts: vi.fn(async () => mockDraftContracts),
  updateContract: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/billing/actions/contractWizardActions', () => ({
  getDraftContractForResume: vi.fn(async () => mockDraftResumeData),
}));

describe('Drafts tab DataTable', () => {
  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return 1200;
      },
    });
  });

  it('renders contract name for each draft (T012)', async () => {
    mockDraftContracts = [
      {
        contract_id: 'contract-1',
        contract_name: 'Draft Alpha',
        client_name: 'Acme Co',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
      },
    ];

    const Contracts = (await import('../src/components/billing-dashboard/contracts/Contracts')).default;
    render(<Contracts />);

    expect(await screen.findByText('Draft Alpha')).toBeInTheDocument();
  });

  it('renders client name for each draft (T013)', async () => {
    mockDraftContracts = [
      {
        contract_id: 'contract-1',
        contract_name: 'Draft Alpha',
        client_name: 'Acme Co',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
      },
    ];

    const Contracts = (await import('../src/components/billing-dashboard/contracts/Contracts')).default;
    render(<Contracts />);

    expect(await screen.findByText('Acme Co')).toBeInTheDocument();
  });

  it('renders created date in localized format (T014)', async () => {
    const createdAt = new Date(2026, 0, 1);
    const updatedAt = new Date(2026, 0, 2);
    mockDraftContracts = [
      {
        contract_id: 'contract-1',
        contract_name: 'Draft Alpha',
        client_name: 'Acme Co',
        created_at: createdAt,
        updated_at: updatedAt,
      },
    ];

    const Contracts = (await import('../src/components/billing-dashboard/contracts/Contracts')).default;
    render(<Contracts />);

    expect(await screen.findByText(createdAt.toLocaleDateString())).toBeInTheDocument();
  });

  it('renders last modified date in localized format (T015)', async () => {
    const createdAt = new Date(2026, 0, 1);
    const updatedAt = new Date(2026, 0, 5);
    mockDraftContracts = [
      {
        contract_id: 'contract-1',
        contract_name: 'Draft Alpha',
        client_name: 'Acme Co',
        created_at: createdAt,
        updated_at: updatedAt,
      },
    ];

    const Contracts = (await import('../src/components/billing-dashboard/contracts/Contracts')).default;
    render(<Contracts />);

    expect(await screen.findByText(updatedAt.toLocaleDateString())).toBeInTheDocument();
  });

  it('renders actions dropdown for each row (T016)', async () => {
    mockDraftContracts = [
      {
        contract_id: 'contract-1',
        contract_name: 'Draft Alpha',
        client_name: 'Acme Co',
        created_at: new Date(2026, 0, 1),
        updated_at: new Date(2026, 0, 2),
      },
      {
        contract_id: 'contract-2',
        contract_name: 'Draft Beta',
        client_name: 'Beta LLC',
        created_at: new Date(2026, 0, 1),
        updated_at: new Date(2026, 0, 3),
      },
    ];

    const Contracts = (await import('../src/components/billing-dashboard/contracts/Contracts')).default;
    render(<Contracts />);

    const actionsButtons = await screen.findAllByRole('button', { name: /open menu/i });
    expect(actionsButtons).toHaveLength(2);
  });

  it('actions dropdown contains Resume option (T017)', async () => {
    mockDraftContracts = [
      {
        contract_id: 'contract-1',
        contract_name: 'Draft Alpha',
        client_name: 'Acme Co',
        created_at: new Date(2026, 0, 1),
        updated_at: new Date(2026, 0, 2),
      },
    ];

    const Contracts = (await import('../src/components/billing-dashboard/contracts/Contracts')).default;
    render(<Contracts />);

    const user = userEvent.setup();
    const actionsButton = await screen.findByRole('button', { name: /open menu/i });
    await act(async () => {
      await user.click(actionsButton);
    });

    expect(await screen.findByText('Resume')).toBeInTheDocument();
  });

  it('actions dropdown contains Discard option (T018)', async () => {
    mockDraftContracts = [
      {
        contract_id: 'contract-1',
        contract_name: 'Draft Alpha',
        client_name: 'Acme Co',
        created_at: new Date(2026, 0, 1),
        updated_at: new Date(2026, 0, 2),
      },
    ];

    const Contracts = (await import('../src/components/billing-dashboard/contracts/Contracts')).default;
    render(<Contracts />);

    const user = userEvent.setup();
    const actionsButton = await screen.findByRole('button', { name: /open menu/i });
    await act(async () => {
      await user.click(actionsButton);
    });

    expect(await screen.findByText('Discard')).toBeInTheDocument();
  });

  it('clicking column header sorts by that column (T019)', async () => {
    mockDraftContracts = [
      {
        contract_id: 'contract-1',
        contract_name: 'b draft',
        client_name: 'Acme Co',
        created_at: new Date(2026, 0, 1),
        updated_at: new Date(2026, 0, 10),
      },
      {
        contract_id: 'contract-2',
        contract_name: 'A draft',
        client_name: 'Beta LLC',
        created_at: new Date(2026, 0, 1),
        updated_at: new Date(2026, 0, 5),
      },
    ];

    const Contracts = (await import('../src/components/billing-dashboard/contracts/Contracts')).default;
    render(<Contracts />);

    // Initial sorting is by updated_at desc, so "b draft" should be first.
    await waitFor(async () => {
      const rows = await screen.findAllByRole('row');
      const firstDataRow = rows[1];
      expect(within(firstDataRow).getByText('b draft')).toBeInTheDocument();
    });

    const user = userEvent.setup();
    const contractNameHeader = screen.getByRole('columnheader', { name: /contract name/i });
    await act(async () => {
      await user.click(contractNameHeader);
    });

    await waitFor(() => {
      const rows = screen.getAllByRole('row');
      const firstDataRow = rows[1];
      expect(within(firstDataRow).getByText('A draft')).toBeInTheDocument();
    });
  });

  it('search input filters drafts by contract name (T020)', async () => {
    mockDraftContracts = [
      {
        contract_id: 'contract-1',
        contract_name: 'Draft Alpha',
        client_name: 'Acme Co',
        created_at: new Date(2026, 0, 1),
        updated_at: new Date(2026, 0, 2),
      },
      {
        contract_id: 'contract-2',
        contract_name: 'Draft Beta',
        client_name: 'Beta LLC',
        created_at: new Date(2026, 0, 1),
        updated_at: new Date(2026, 0, 3),
      },
    ];

    const Contracts = (await import('../src/components/billing-dashboard/contracts/Contracts')).default;
    render(<Contracts />);

    await screen.findByText('Draft Alpha');
    await screen.findByText('Draft Beta');

    const user = userEvent.setup();
    const searchInput = screen.getByLabelText('Search draft contracts');
    await act(async () => {
      await user.type(searchInput, 'Alpha');
    });

    await waitFor(() => {
      expect(screen.getByText('Draft Alpha')).toBeInTheDocument();
      expect(screen.queryByText('Draft Beta')).not.toBeInTheDocument();
    });
  });

  it('search input filters drafts by client name (T021)', async () => {
    mockDraftContracts = [
      {
        contract_id: 'contract-1',
        contract_name: 'Draft Alpha',
        client_name: 'Acme Co',
        created_at: new Date(2026, 0, 1),
        updated_at: new Date(2026, 0, 2),
      },
      {
        contract_id: 'contract-2',
        contract_name: 'Draft Beta',
        client_name: 'Beta LLC',
        created_at: new Date(2026, 0, 1),
        updated_at: new Date(2026, 0, 3),
      },
    ];

    const Contracts = (await import('../src/components/billing-dashboard/contracts/Contracts')).default;
    render(<Contracts />);

    await screen.findByText('Draft Alpha');
    await screen.findByText('Draft Beta');

    const user = userEvent.setup();
    const searchInput = screen.getByLabelText('Search draft contracts');
    await act(async () => {
      await user.type(searchInput, 'Beta');
    });

    await waitFor(() => {
      expect(screen.getByText('Draft Beta')).toBeInTheDocument();
      expect(screen.queryByText('Draft Alpha')).not.toBeInTheDocument();
    });
  });

  it('search is case-insensitive (T022)', async () => {
    mockDraftContracts = [
      {
        contract_id: 'contract-1',
        contract_name: 'Draft Alpha',
        client_name: 'Acme Co',
        created_at: new Date(2026, 0, 1),
        updated_at: new Date(2026, 0, 2),
      },
    ];

    const Contracts = (await import('../src/components/billing-dashboard/contracts/Contracts')).default;
    render(<Contracts />);

    await screen.findByText('Draft Alpha');

    const user = userEvent.setup();
    const searchInput = screen.getByLabelText('Search draft contracts');
    await act(async () => {
      await user.type(searchInput, 'acme');
    });

    expect(await screen.findByText('Draft Alpha')).toBeInTheDocument();
  });

  it('pagination controls appear when drafts exceed page size (T023)', async () => {
    mockDraftContracts = Array.from({ length: 11 }, (_v, idx) => ({
      contract_id: `contract-${idx + 1}`,
      contract_name: `Draft ${idx + 1}`,
      client_name: `Client ${idx + 1}`,
      created_at: new Date(2026, 0, 1),
      updated_at: new Date(2026, 0, idx + 1),
    }));

    const Contracts = (await import('../src/components/billing-dashboard/contracts/Contracts')).default;
    render(<Contracts />);

    expect(await screen.findByText('Draft 11')).toBeInTheDocument();
    expect(screen.getByLabelText('Pagination')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2' })).toBeInTheDocument();

    const nextButton = document.getElementById('draft-contracts-table-pagination-next-btn') as HTMLButtonElement | null;
    expect(nextButton).not.toBeNull();
    expect(nextButton?.disabled).toBe(false);
  });

  it('pagination controls navigate between pages (T024)', async () => {
    mockDraftContracts = Array.from({ length: 11 }, (_v, idx) => ({
      contract_id: `contract-${idx + 1}`,
      contract_name: `Draft ${idx + 1}`,
      client_name: `Client ${idx + 1}`,
      created_at: new Date(2026, 0, 1),
      updated_at: new Date(2026, 0, idx + 1),
    }));

    const Contracts = (await import('../src/components/billing-dashboard/contracts/Contracts')).default;
    render(<Contracts />);

    expect(await screen.findByText('Draft 11')).toBeInTheDocument();
    expect(screen.queryByText('Draft 1')).not.toBeInTheDocument();

    const user = userEvent.setup();
    const pageTwoButton = screen.getByRole('button', { name: '2' });
    await act(async () => {
      await user.click(pageTwoButton);
    });

    await waitFor(() => {
      expect(screen.getByText('Draft 1')).toBeInTheDocument();
      expect(screen.queryByText('Draft 11')).not.toBeInTheDocument();
    });
  });

  it('empty state displays when no drafts exist (T025)', async () => {
    mockDraftContracts = [];

    const Contracts = (await import('../src/components/billing-dashboard/contracts/Contracts')).default;
    render(<Contracts />);

    expect(
      await screen.findByText('No draft contracts. Start creating a new contract to save as draft.'),
    ).toBeInTheDocument();
  });

  it('empty state message mentions saving drafts (T026)', async () => {
    mockDraftContracts = [];

    const Contracts = (await import('../src/components/billing-dashboard/contracts/Contracts')).default;
    render(<Contracts />);

    expect(await screen.findByText(/start creating a new contract to save as draft/i)).toBeInTheDocument();
  });

  it('clicking Resume opens ContractWizard dialog (T031)', async () => {
    mockDraftResumeData = {
      contract_id: 'contract-1',
      is_draft: true,
      client_id: 'client-1',
      contract_name: 'Draft Alpha',
      start_date: '2026-01-01',
      currency_code: 'USD',
      enable_proration: false,
      fixed_services: [],
      product_services: [],
      hourly_services: [],
      usage_services: [],
    };
    mockDraftContracts = [
      {
        contract_id: 'contract-1',
        contract_name: 'Draft Alpha',
        client_name: 'Acme Co',
        created_at: new Date(2026, 0, 1),
        updated_at: new Date(2026, 0, 2),
      },
    ];

    const Contracts = (await import('../src/components/billing-dashboard/contracts/Contracts')).default;
    render(<Contracts />);

    const user = userEvent.setup();
    const actionsButton = await screen.findByRole('button', { name: /open menu/i });
    await act(async () => {
      await user.click(actionsButton);
    });

    const resumeItem = await screen.findByText('Resume');
    await act(async () => {
      await user.click(resumeItem);
    });

    await waitFor(() => {
      const wizard = screen.getByTestId('contract-wizard');
      expect(wizard).toHaveAttribute('data-contract-id', 'contract-1');
    });
  });

  it('resumed wizard displays with draft data loaded (T032)', async () => {
    mockDraftResumeData = {
      contract_id: 'contract-1',
      is_draft: true,
      client_id: 'client-1',
      contract_name: 'Draft Alpha',
      start_date: '2026-01-01',
      currency_code: 'USD',
      enable_proration: false,
      fixed_services: [],
      product_services: [],
      hourly_services: [],
      usage_services: [],
    };
    mockDraftContracts = [
      {
        contract_id: 'contract-1',
        contract_name: 'Draft Alpha',
        client_name: 'Acme Co',
        created_at: new Date(2026, 0, 1),
        updated_at: new Date(2026, 0, 2),
      },
    ];

    const Contracts = (await import('../src/components/billing-dashboard/contracts/Contracts')).default;
    render(<Contracts />);

    const user = userEvent.setup();
    const actionsButton = await screen.findByRole('button', { name: /open menu/i });
    await act(async () => {
      await user.click(actionsButton);
    });
    const resumeItem = await screen.findByText('Resume');
    await act(async () => {
      await user.click(resumeItem);
    });

    await waitFor(() => {
      const wizard = screen.getByTestId('contract-wizard');
      expect(wizard).toHaveAttribute('data-contract-id', 'contract-1');
      expect(wizard).toHaveAttribute('data-client-id', 'client-1');
      expect(wizard).toHaveAttribute('data-contract-name', 'Draft Alpha');
    });
  });

  it('clicking Discard opens confirmation dialog (T049)', async () => {
    mockDraftContracts = [
      {
        contract_id: 'contract-1',
        contract_name: 'Draft Alpha',
        client_name: 'Acme Co',
        created_at: new Date(2026, 0, 1),
        updated_at: new Date(2026, 0, 2),
      },
    ];

    const Contracts = (await import('../src/components/billing-dashboard/contracts/Contracts')).default;
    render(<Contracts />);

    const user = userEvent.setup();
    const actionsButton = await screen.findByRole('button', { name: /open menu/i });
    await act(async () => {
      await user.click(actionsButton);
    });
    await act(async () => {
      await user.click(await screen.findByText('Discard'));
    });

    expect(await screen.findByTestId('confirmation-dialog')).toBeInTheDocument();
  });

  it('confirmation dialog displays contract name (T050)', async () => {
    mockDraftContracts = [
      {
        contract_id: 'contract-1',
        contract_name: 'Draft Alpha',
        client_name: 'Acme Co',
        created_at: new Date(2026, 0, 1),
        updated_at: new Date(2026, 0, 2),
      },
    ];

    const Contracts = (await import('../src/components/billing-dashboard/contracts/Contracts')).default;
    render(<Contracts />);

    await screen.findByText('Draft Alpha');

    const user = userEvent.setup();
    await act(async () => {
      await user.click(await screen.findByRole('button', { name: /open menu/i }));
    });
    await act(async () => {
      await user.click(await screen.findByText('Discard'));
    });

    const dialog = await screen.findByTestId('confirmation-dialog');
    expect(within(dialog).getByText(/Draft Alpha/)).toBeInTheDocument();
  });

  it('confirmation dialog displays client name (T051)', async () => {
    mockDraftContracts = [
      {
        contract_id: 'contract-1',
        contract_name: 'Draft Alpha',
        client_name: 'Acme Co',
        created_at: new Date(2026, 0, 1),
        updated_at: new Date(2026, 0, 2),
      },
    ];

    const Contracts = (await import('../src/components/billing-dashboard/contracts/Contracts')).default;
    render(<Contracts />);

    await screen.findByText('Draft Alpha');

    const user = userEvent.setup();
    await act(async () => {
      await user.click(await screen.findByRole('button', { name: /open menu/i }));
    });
    await act(async () => {
      await user.click(await screen.findByText('Discard'));
    });

    const dialog = await screen.findByTestId('confirmation-dialog');
    expect(within(dialog).getByText(/Acme Co/)).toBeInTheDocument();
  });

  it('confirmation dialog displays warning about permanent deletion (T052)', async () => {
    mockDraftContracts = [
      {
        contract_id: 'contract-1',
        contract_name: 'Draft Alpha',
        client_name: 'Acme Co',
        created_at: new Date(2026, 0, 1),
        updated_at: new Date(2026, 0, 2),
      },
    ];

    const Contracts = (await import('../src/components/billing-dashboard/contracts/Contracts')).default;
    render(<Contracts />);

    await screen.findByText('Draft Alpha');

    const user = userEvent.setup();
    await act(async () => {
      await user.click(await screen.findByRole('button', { name: /open menu/i }));
    });
    await act(async () => {
      await user.click(await screen.findByText('Discard'));
    });

    const dialog = await screen.findByTestId('confirmation-dialog');
    expect(within(dialog).getByText(/permanently delete/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument();
  });

  it('confirmation dialog has Cancel button (T053)', async () => {
    mockDraftContracts = [
      {
        contract_id: 'contract-1',
        contract_name: 'Draft Alpha',
        client_name: 'Acme Co',
        created_at: new Date(2026, 0, 1),
        updated_at: new Date(2026, 0, 2),
      },
    ];

    const Contracts = (await import('../src/components/billing-dashboard/contracts/Contracts')).default;
    render(<Contracts />);

    await screen.findByText('Draft Alpha');

    const user = userEvent.setup();
    await act(async () => {
      await user.click(await screen.findByRole('button', { name: /open menu/i }));
    });
    await act(async () => {
      await user.click(await screen.findByText('Discard'));
    });

    const dialog = await screen.findByTestId('confirmation-dialog');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('confirmation dialog has Discard button (T054)', async () => {
    mockDraftContracts = [
      {
        contract_id: 'contract-1',
        contract_name: 'Draft Alpha',
        client_name: 'Acme Co',
        created_at: new Date(2026, 0, 1),
        updated_at: new Date(2026, 0, 2),
      },
    ];

    const Contracts = (await import('../src/components/billing-dashboard/contracts/Contracts')).default;
    render(<Contracts />);

    await screen.findByText('Draft Alpha');

    const user = userEvent.setup();
    await act(async () => {
      await user.click(await screen.findByRole('button', { name: /open menu/i }));
    });
    await act(async () => {
      await user.click(await screen.findByText('Discard'));
    });

    const dialog = await screen.findByTestId('confirmation-dialog');
    expect(within(dialog).getByRole('button', { name: 'Discard' })).toBeInTheDocument();
  });
});
