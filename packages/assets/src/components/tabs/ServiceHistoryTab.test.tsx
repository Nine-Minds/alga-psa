/* @vitest-environment jsdom */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ServiceHistoryTab } from './ServiceHistoryTab';

const mockUseSWR = vi.fn();
const mockOpenTicketDetailsDrawer = vi.fn();

vi.mock('swr', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseSWR(...args),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}));

vi.mock('@alga-psa/ui/components/Table', () => ({
  Table: ({ children }: any) => <table>{children}</table>,
  TableBody: ({ children }: any) => <tbody>{children}</tbody>,
  TableCell: ({ children, ...props }: any) => <td {...props}>{children}</td>,
  TableHead: ({ children }: any) => <th>{children}</th>,
  TableHeader: ({ children }: any) => <thead>{children}</thead>,
  TableRow: ({ children }: any) => <tr>{children}</tr>,
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@alga-psa/core', () => ({
  formatDateTime: () => '2026-03-23 12:00 PM',
}));

vi.mock('../../actions/assetActions', () => ({
  getAssetLinkedTickets: vi.fn(),
}));

vi.mock('../../context/AssetCrossFeatureContext', () => ({
  useAssetCrossFeature: () => ({
    renderQuickAddTicket: () => null,
    openTicketDetailsDrawer: mockOpenTicketDetailsDrawer,
  }),
}));

describe('ServiceHistoryTab', () => {
  it('shows the ticket number instead of the raw ticket id', () => {
    mockUseSWR.mockReturnValue({
      data: [
        {
          ticket_id: '123e4567-e89b-12d3-a456-426614174000',
          ticket_number: '4821',
          title: 'Replace switch',
          status_id: 'status-1',
          status_name: 'In Progress',
          linked_at: '2026-03-23T16:00:00.000Z',
        },
      ],
      isLoading: false,
    });

    render(
      <ServiceHistoryTab
        asset={{
          asset_id: 'asset-1',
          client_id: 'client-1',
        } as any}
      />
    );

    expect(screen.getByText('#4821')).toBeTruthy();
    expect(screen.queryByText('#123e4567')).toBeNull();
  });
});
