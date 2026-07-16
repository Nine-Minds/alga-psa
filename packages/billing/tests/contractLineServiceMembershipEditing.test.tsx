// @vitest-environment jsdom

import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceSelectionDialog } from '../src/components/billing-dashboard/service-config/ServiceSelectionDialog';

const actionMocks = vi.hoisted(() => ({
  addServiceToContractLine: vi.fn(),
  getServices: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/serviceActions', () => ({
  getServices: actionMocks.getServices,
}));

vi.mock('@alga-psa/billing/actions/contractLineServiceActions', () => ({
  addServiceToContractLine: actionMocks.addServiceToContractLine,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
  useFormatters: () => ({
    formatCurrency: (value: number, currency: string) => `${currency} ${value}`,
  }),
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  getErrorMessage: () => 'action error',
  isActionMessageError: () => false,
  isActionPermissionError: () => false,
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({
    isOpen,
    title,
    children,
    footer,
  }: {
    isOpen: boolean;
    title: React.ReactNode;
    children: React.ReactNode;
    footer: React.ReactNode;
  }) => isOpen ? (
    <div role="dialog">
      <h1>{title}</h1>
      {children}
      {footer}
    </div>
  ) : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Table', () => ({
  Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  TableRow: ({ children, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => (
    <tr {...props}>{children}</tr>
  ),
  TableHead: ({ children }: { children?: React.ReactNode }) => <th>{children}</th>,
  TableCell: ({ children }: { children: React.ReactNode }) => <td>{children}</td>,
}));

describe('contract line service membership editing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.addServiceToContractLine.mockResolvedValue('new-config-id');
    actionMocks.getServices.mockResolvedValue({
      services: [
        {
          service_id: 'existing-service',
          service_name: 'Existing service',
          service_type_name: 'Support',
          unit_of_measure: 'hour',
          default_rate: 12000,
          billing_method: 'hourly',
          item_kind: 'service',
          is_active: true,
          prices: [],
        },
        {
          service_id: 'new-service',
          service_name: 'New hourly service',
          service_type_name: 'Support',
          unit_of_measure: 'hour',
          default_rate: 18000,
          billing_method: 'hourly',
          item_kind: 'service',
          is_active: true,
          prices: [{ currency_code: 'USD', rate: 25000 }],
        },
      ],
      totalCount: 2,
    });
  });

  it('filters the picker for the line type, excludes existing services, and adds with contract-currency defaults', async () => {
    const onClose = vi.fn();
    const onServiceAdded = vi.fn();

    render(
      <ServiceSelectionDialog
        isOpen
        onClose={onClose}
        contractLineId="line-1"
        contractLineType="Hourly"
        currencyCode="USD"
        existingServiceIds={['existing-service']}
        onServiceAdded={onServiceAdded}
      />
    );

    expect(await screen.findByText('New hourly service')).not.toBeNull();
    expect(screen.queryByText('Existing service')).toBeNull();
    expect(screen.getByText('USD 250')).not.toBeNull();
    expect(actionMocks.getServices).toHaveBeenCalledWith(1, 999, {
      item_kind: 'service',
      is_active: true,
    });

    fireEvent.click(screen.getByText('New hourly service'));
    fireEvent.click(screen.getByRole('button', { name: 'Add Selected Services' }));

    await waitFor(() => {
      expect(actionMocks.addServiceToContractLine).toHaveBeenCalledWith(
        'line-1',
        'new-service',
        1,
        25000,
        'Hourly',
        { hourly_rate: 25000 }
      );
    });
    expect(onServiceAdded).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('exposes removal only from the active inline editor and refreshes its configuration state', () => {
    const source = readFileSync(
      resolve(__dirname, '../src/components/billing-dashboard/contracts/ContractLines.tsx'),
      'utf8'
    );

    expect(source).toContain('editingLineId === line.contract_line_id');
    expect(source).toContain('removeServiceFromContractLine(contractLineId, serviceId)');
    expect(source).toContain('await refreshServicesForEditing(contractLineId)');
    expect(source).toContain('id={`remove-service-${serviceConfig.configuration.config_id}`}');
  });

  it('preserves the selected base rate when creating a usage-service configuration', () => {
    const source = readFileSync(
      resolve(__dirname, '../src/services/contractLineServiceConfigurationService.ts'),
      'utf8'
    );

    expect(source).toContain(
      "base_rate: (typeConfig as IContractLineServiceUsageConfig)?.base_rate ?? null"
    );
  });
});
