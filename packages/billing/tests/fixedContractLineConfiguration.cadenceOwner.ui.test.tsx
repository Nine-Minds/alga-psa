// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getContractLineById = vi.fn();
const updateContractLine = vi.fn();
const updateContractLineFixedConfig = vi.fn();
const getContractLineFixedConfig = vi.fn();

vi.mock('@alga-psa/billing/actions', () => ({
  getServices: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/billing/actions/contractLineAction', () => ({
  getContractLineById: (...args: any[]) => getContractLineById(...args),
  updateContractLine: (...args: any[]) => updateContractLine(...args),
  updateContractLineFixedConfig: (...args: any[]) => updateContractLineFixedConfig(...args),
  getContractLineFixedConfig: (...args: any[]) => getContractLineFixedConfig(...args),
}));

vi.mock('@alga-psa/ui/components/providers/TenantProvider', () => ({
  useTenant: () => 'tenant-1',
}));

vi.mock('../src/components/billing-dashboard/FixedContractLineServicesList', () => ({
  default: () => <div data-testid="fixed-services-list" />,
}));

describe('FixedContractLineConfiguration cadence owner UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getContractLineById.mockResolvedValue({
      contract_line_id: 'line-1',
      contract_line_name: 'Managed Support',
      billing_frequency: 'monthly',
      contract_line_type: 'Fixed',
      is_custom: true,
      billing_timing: 'arrears',
      cadence_owner: 'client',
    });
    getContractLineFixedConfig.mockResolvedValue({
      base_rate: 12000,
      enable_proration: false,
      billing_cycle_alignment: 'start',
    });
    updateContractLine.mockResolvedValue(undefined);
    updateContractLineFixedConfig.mockResolvedValue(undefined);
  });

  it('T111 and T145: recurring contract line configuration uses business-language cadence owner labels and leaves contract cadence selectable', async () => {
    const { FixedPlanConfiguration } = await import('../src/components/billing-dashboard/contract-lines/FixedContractLineConfiguration');

    render(<FixedPlanConfiguration contractLineId="line-1" />);

    expect(await screen.findByText('Invoice on client billing schedule')).toBeTruthy();
    const clientOption = screen.getByLabelText('Invoice on client billing schedule') as HTMLInputElement;
    const contractOption = screen.getByLabelText('Invoice on contract anniversary') as HTMLInputElement;

    expect(clientOption.checked).toBe(true);
    expect(contractOption.disabled).toBe(false);
    expect(screen.getByText(/Contract cadence currently supports monthly, quarterly, semi-annual, and annual recurring billing/i)).toBeTruthy();

    fireEvent.change(screen.getByDisplayValue('Managed Support'), {
      target: { value: 'Managed Support Plus' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(updateContractLine).toHaveBeenCalledWith(
        'line-1',
        expect.objectContaining({
          contract_line_name: 'Managed Support Plus',
          billing_timing: 'arrears',
          cadence_owner: 'client',
          tenant: 'tenant-1',
        }),
      );
    });
  });
});
