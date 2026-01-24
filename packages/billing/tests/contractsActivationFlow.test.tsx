/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let mockDraftContracts: any[] = [];
let mockClientContracts: any[] = [];
let mockDraftResumeData: any = null;
let mockSearchParams = new URLSearchParams('tab=contracts&subtab=drafts');

const mockRouter = {
  push: vi.fn(),
  replace: vi.fn(),
};

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => mockSearchParams,
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

vi.mock('../src/components/billing-dashboard/contracts/template-wizard/TemplateWizard', () => ({
  TemplateWizard: () => null,
}));

vi.mock('../src/components/billing-dashboard/contracts/ContractDialog', () => ({
  ContractDialog: () => null,
}));

vi.mock('../src/components/billing-dashboard/contracts/ContractWizard', () => ({
  ContractWizard: ({ open, onComplete }: { open: boolean; onComplete?: () => void }) =>
    open ? (
      <button
        type="button"
        onClick={() => {
          // Simulate wizard completion converting draft -> active.
          mockDraftContracts = [];
          mockClientContracts = [
            {
              contract_id: 'contract-1',
              contract_name: 'Draft Alpha',
              client_name: 'Acme Co',
              status: 'active',
              client_id: 'client-1',
              client_contract_id: 'client-contract-1',
            },
          ];
          onComplete?.();
        }}
      >
        Complete Wizard
      </button>
    ) : null,
}));

vi.mock('@alga-psa/billing/actions/contractActions', () => ({
  checkClientHasActiveContract: vi.fn(async () => false),
  deleteContract: vi.fn(async () => undefined),
  getContractTemplates: vi.fn(async () => []),
  getContractsWithClients: vi.fn(async () => mockClientContracts),
  getDraftContracts: vi.fn(async () => mockDraftContracts),
  updateContract: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/billing/actions/contractWizardActions', () => ({
  getDraftContractForResume: vi.fn(async () => mockDraftResumeData),
}));

describe('Contracts activation flow (draft -> active)', () => {
  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return 1200;
      },
    });
  });

  it('activated contract no longer appears in Drafts tab (T047)', async () => {
    mockSearchParams = new URLSearchParams('tab=contracts&subtab=drafts');
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
    mockClientContracts = [];

    const Contracts = (await import('../src/components/billing-dashboard/contracts/Contracts')).default;
    render(<Contracts />);

    expect(await screen.findByText('Draft Alpha')).toBeInTheDocument();

    const user = userEvent.setup();
    await act(async () => {
      await user.click(await screen.findByRole('button', { name: /open menu/i }));
    });
    await act(async () => {
      await user.click(await screen.findByText('Resume'));
    });
    await act(async () => {
      await user.click(await screen.findByText('Complete Wizard'));
    });

    await waitFor(() => {
      expect(screen.queryByText('Draft Alpha')).not.toBeInTheDocument();
    });

    expect(
      screen.getByText('No draft contracts. Start creating a new contract to save as draft.'),
    ).toBeInTheDocument();
  });

  it('activated contract appears in Client Contracts tab (T048)', async () => {
    mockSearchParams = new URLSearchParams('tab=contracts&subtab=drafts');
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
    mockClientContracts = [];

    const Contracts = (await import('../src/components/billing-dashboard/contracts/Contracts')).default;
    const ui = render(<Contracts />);

    const user = userEvent.setup();
    expect(await screen.findByText('Draft Alpha')).toBeInTheDocument();
    await act(async () => {
      await user.click(await screen.findByRole('button', { name: /open menu/i }));
    });
    await act(async () => {
      await user.click(await screen.findByText('Resume'));
    });
    await act(async () => {
      await user.click(await screen.findByText('Complete Wizard'));
    });

    // Switch to the Client Contracts tab after activation + refresh.
    mockSearchParams = new URLSearchParams('tab=contracts&subtab=client-contracts');
    ui.rerender(<Contracts />);

    await waitFor(() => {
      expect(screen.getByText('Draft Alpha')).toBeInTheDocument();
    });
  });
});
