/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../../../actions/integrations/quickBooksDesktopActions', () => ({
  getQuickBooksDesktopSettings: (...args: unknown[]) => mocks.get(...args),
  updateQuickBooksDesktopSettings: (...args: unknown[]) => mocks.update(...args),
}));

vi.mock('./useAccountingCapabilities', () => ({
  useAccountingCapabilities: () => ({
    catalogRead: true,
    connectionsManage: true,
    mappingsManage: false,
    exportsExecute: false,
    remoteMutate: false,
    hasAny: true,
    loaded: true,
  }),
}));

vi.mock('@alga-psa/integrations/components/csv/CSVMappingManager', () => ({
  CSVMappingManager: () => <div data-testid="csv-mapping-manager" />,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, onValueChange, options, disabled }: {
    id?: string;
    value?: string | null;
    onValueChange?: (value: string) => void;
    options?: Array<{ value: string; label: React.ReactNode }>;
    disabled?: boolean;
  }) => (
    <select id={id} data-testid={id} value={value ?? ''} disabled={disabled} onChange={(event) => onValueChange?.(event.target.value)}>
      {(options ?? []).map((option) => (
        <option key={option.value} value={option.value}>
          {typeof option.label === 'string' ? option.label : option.value}
        </option>
      ))}
    </select>
  ),
}));

const SAVED = {
  arAccount: 'Accounts Receivable',
  defaultIncomeAccount: 'Services Income',
  salesTaxPayableAccount: 'Sales Tax Payable',
  defaultSalesTaxItem: '',
  newProductItemType: 'NONINVENTORY',
  inventoryAssetAccount: 'Inventory Asset',
  cogsAccount: 'Cost of Goods Sold',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(SAVED);
  mocks.update.mockImplementation(async (updates: Record<string, unknown>) => ({ ...SAVED, ...updates }));
});

afterEach(() => {
  cleanup();
});

describe('QuickBooksDesktopIntegrationSettings new-item settings', () => {
  it('defaults new products to Non-inventory Part and hides the inventory accounts', async () => {
    const { default: Settings } = await import('./QuickBooksDesktopIntegrationSettings');
    render(<Settings />);

    expect(await screen.findByTestId('qbd-setting-new-product-item-type')).toHaveValue('NONINVENTORY');
    expect(document.getElementById('qbd-setting-inventory-asset-account')).toBeNull();
    expect(document.getElementById('qbd-setting-cogs-account')).toBeNull();
  });

  it('shows the inventory accounts for Inventory Part and saves the choice', async () => {
    const { default: Settings } = await import('./QuickBooksDesktopIntegrationSettings');
    render(<Settings />);

    fireEvent.change(await screen.findByTestId('qbd-setting-new-product-item-type'), { target: { value: 'INVENTORY' } });
    expect(document.getElementById('qbd-setting-inventory-asset-account')).toHaveValue('Inventory Asset');
    expect(document.getElementById('qbd-setting-cogs-account')).toHaveValue('Cost of Goods Sold');
    expect(screen.getByText(/on-hand quantities will go negative/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => {
      expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ newProductItemType: 'INVENTORY' }));
    });
  });
});
