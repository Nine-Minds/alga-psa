/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let mockDraftContracts: any[] = [];

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

vi.mock('../src/components/billing-dashboard/contracts/ContractWizard', () => ({
  ContractWizard: () => null,
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
  getDraftContractForResume: vi.fn(async () => ({})),
}));

describe('Drafts tab DataTable', () => {
  beforeAll(() => {
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
});
