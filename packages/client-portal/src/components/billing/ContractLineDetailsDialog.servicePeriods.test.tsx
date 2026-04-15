/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ContractLineDetailsDialog from './ContractLineDetailsDialog';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOptions?: string | Record<string, unknown>) => {
      if (typeof fallbackOrOptions === 'string') {
        return fallbackOrOptions;
      }
      return _key;
    },
  }),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children }: any) => (isOpen ? <div>{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Skeleton', () => ({
  Skeleton: () => <div>Loading...</div>,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

describe('ContractLineDetailsDialog recurring timing metadata', () => {
  it('T122: renders cadence-owner and recurring timing context for contract lines', () => {
    render(
      <ContractLineDetailsDialog
        contractLine={{
          tenant: 'tenant-1',
          client_contract_line_id: 'client-line-1',
          client_id: 'client-1',
          contract_line_id: 'contract-line-1',
          contract_line_name: 'Managed Firewall',
          billing_frequency: 'Monthly',
          billing_timing: 'arrears',
          cadence_owner: 'contract',
          start_date: '2026-01-08',
          end_date: null,
          is_active: true,
        }}
        isOpen={true}
        onClose={() => {}}
        formatDate={(date) => String(date)}
      />
    );

    expect(screen.getByText('Cadence Owner')).toBeInTheDocument();
    expect(screen.getByText('Contract anniversary')).toBeInTheDocument();
    expect(screen.getByText('Billing Timing')).toBeInTheDocument();
    expect(screen.getByText('Arrears')).toBeInTheDocument();
    expect(
      screen.getByText('Recurring service periods follow the contract anniversary cadence for this line.')
    ).toBeInTheDocument();
  });
});
