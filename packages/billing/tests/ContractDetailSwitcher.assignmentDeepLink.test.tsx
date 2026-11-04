/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
  assignment: vi.fn(),
  contract: vi.fn(),
}));
const router = { replace: (...args: unknown[]) => nav.replace(...args) };
const deferred = <T,>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => nav.params,
}));
vi.mock('@alga-psa/billing/actions/billingClientsActions', () => ({ getClientContractByIdForBilling: (...args: unknown[]) => nav.assignment(...args) }));
vi.mock('@alga-psa/billing/actions/contractActions', () => ({ getContractById: (...args: unknown[]) => nav.contract(...args) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key }) }));
vi.mock('../src/components/billing-dashboard/contracts/ContractDetail', () => ({ default: (props: Record<string, unknown>) => <div data-testid="contract-detail" data-contract-id={props.resolvedContractId} data-assignment-id={props.resolvedClientContractId} /> }));
vi.mock('../src/components/billing-dashboard/contracts/ContractTemplateDetail', () => ({ default: () => <div data-testid="contract-template-detail" /> }));

const { default: ContractDetailSwitcher } = await import('../src/components/billing-dashboard/contracts/ContractDetailSwitcher');

describe('ContractDetailSwitcher assignment deep links', () => {
  beforeEach(() => {
    nav.params = new URLSearchParams('tab=client-contracts&clientContractId=assignment-42&contractView=lines&contractLineId=line-9');
    nav.replace.mockReset();
    nav.assignment.mockReset();
    nav.contract.mockReset();
  });
  afterEach(() => cleanup());

  it('resolves the tenant-scoped assignment to its canonical contract and preserves Lines and line focus', async () => {
    nav.assignment.mockResolvedValue({ client_contract_id: 'assignment-42', contract_id: 'canonical-contract-7' });
    render(<ContractDetailSwitcher />);

    await waitFor(() => expect(screen.getByTestId('contract-detail')).toHaveAttribute('data-contract-id', 'canonical-contract-7'));
    expect(nav.assignment).toHaveBeenCalledWith('assignment-42');
    expect(nav.contract).not.toHaveBeenCalled();
    expect(nav.replace).toHaveBeenCalledWith(
      '/msp/billing?tab=client-contracts&clientContractId=assignment-42&contractView=lines&contractLineId=line-9&contractId=canonical-contract-7',
      { scroll: false },
    );
  });

  it('shows an explicit not-found error when source assignment data is unavailable', async () => {
    nav.assignment.mockResolvedValue(null);
    render(<ContractDetailSwitcher />);

    expect(await screen.findByText('Contract not found')).toBeInTheDocument();
    expect(nav.contract).not.toHaveBeenCalled();
    expect(screen.queryByTestId('contract-detail')).not.toBeInTheDocument();
  });

  it('completes a deferred lookup after query-only changes and redirects with the latest Lines focus', async () => {
    const pending = deferred<{ client_contract_id: string; contract_id: string }>();
    nav.assignment.mockReturnValue(pending.promise);
    const { rerender } = render(<ContractDetailSwitcher />);
    expect(screen.getByText('Loading contract...')).toBeInTheDocument();

    nav.params = new URLSearchParams('tab=client-contracts&clientContractId=assignment-42&contractView=lines&contractLineId=line-9&tracking=latest');
    rerender(<ContractDetailSwitcher />);
    pending.resolve({ client_contract_id: 'assignment-42', contract_id: 'canonical-contract-7' });

    await waitFor(() => expect(screen.getByTestId('contract-detail')).toHaveAttribute('data-contract-id', 'canonical-contract-7'));
    expect(nav.replace).toHaveBeenCalledWith(
      '/msp/billing?tab=client-contracts&clientContractId=assignment-42&contractView=lines&contractLineId=line-9&tracking=latest&contractId=canonical-contract-7',
      { scroll: false },
    );
    expect(screen.queryByText('Loading contract...')).not.toBeInTheDocument();
  });

  it('ignores a deferred response from an assignment identity that is no longer selected', async () => {
    const oldResponse = deferred<{ client_contract_id: string; contract_id: string }>();
    const selectedResponse = deferred<{ client_contract_id: string; contract_id: string }>();
    nav.assignment.mockImplementation((id: string) => id === 'assignment-old' ? oldResponse.promise : selectedResponse.promise);
    nav.params = new URLSearchParams('tab=client-contracts&clientContractId=assignment-old&contractView=lines&contractLineId=line-old');
    const { rerender } = render(<ContractDetailSwitcher />);
    nav.params = new URLSearchParams('tab=client-contracts&clientContractId=assignment-current&contractView=lines&contractLineId=line-current');
    rerender(<ContractDetailSwitcher />);

    selectedResponse.resolve({ client_contract_id: 'assignment-current', contract_id: 'contract-current' });
    await waitFor(() => expect(screen.getByTestId('contract-detail')).toHaveAttribute('data-contract-id', 'contract-current'));
    oldResponse.resolve({ client_contract_id: 'assignment-old', contract_id: 'contract-old' });
    await waitFor(() => expect(screen.getByTestId('contract-detail')).toHaveAttribute('data-assignment-id', 'assignment-current'));

    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith(
      '/msp/billing?tab=client-contracts&clientContractId=assignment-current&contractView=lines&contractLineId=line-current&contractId=contract-current',
      { scroll: false },
    );
  });
});
