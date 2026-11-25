/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClientAccount from './ClientAccount';

const clientMock = vi.hoisted(() => vi.fn());
const planMock = vi.hoisted(() => vi.fn());
const invMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/client-portal/actions', () => ({
  getClientClient: (...a: unknown[]) => clientMock(...a),
  getClientContractLine: (...a: unknown[]) => planMock(...a),
  getClientInvoices: (...a: unknown[]) => invMock(...a),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useFormatters: () => ({ formatDate: (d: Date) => d.toISOString() }),
  useTranslation: () => ({ t: (k: string, f?: string) => (typeof f === 'string' ? f : k) }),
}));
vi.mock('@alga-psa/ui/lib', () => ({ useCurrencyFormat: () => ({ money: (n: number) => String(n) }) }));
vi.mock('@alga-psa/ui/components/LoadingIndicator', () => ({ default: () => <div>loading</div> }));
vi.mock('@alga-psa/ui/components/Table', () => ({ Table: ({ children }: any) => <table>{children}</table> }));
vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, ...p }: any) => <div {...p}>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <h3>{children}</h3>,
  CardContent: ({ children }: any) => <div>{children}</div>,
}));

describe('ClientAccount', () => {
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    clientMock.mockResolvedValue({ client_name: 'Acme', properties: {} });
    planMock.mockResolvedValue({ contract_line_name: 'Gold Plan' });
    invMock.mockResolvedValue([]);
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('renders no error text when the contract line is permission-denied', async () => {
    planMock.mockResolvedValue({ permissionError: 'Permission denied: unauthorized' });
    const { container } = render(<ClientAccount />);
    await waitFor(() => expect(planMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('loading')).toBeNull());
    expect(container.textContent).not.toMatch(/unauthorized|denied/i);
    expect(screen.queryByText('Gold Plan')).toBeNull();
  });

  it('renders no error text when invoices are permission-denied', async () => {
    invMock.mockResolvedValue({ permissionError: 'Permission denied: unauthorized' });
    const { container } = render(<ClientAccount />);
    await waitFor(() => expect(invMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('loading')).toBeNull());
    expect(container.textContent).not.toMatch(/unauthorized|denied/i);
    expect(screen.getByText('Gold Plan')).toBeTruthy();
    expect(container.querySelector('#invoices-table')).toBeNull();
  });

  it('still renders an operational error', async () => {
    planMock.mockResolvedValue({ actionError: 'Billing service is down' });
    render(<ClientAccount />);
    await waitFor(() => expect(screen.getByText('Billing service is down')).toBeTruthy());
  });

  it('does not call actions of hidden cards', async () => {
    render(<ClientAccount showPlanCard={false} showInvoicesCard />);
    await waitFor(() => expect(invMock).toHaveBeenCalled());
    expect(planMock).not.toHaveBeenCalled();
    cleanup();
    invMock.mockClear();
    render(<ClientAccount showPlanCard showInvoicesCard={false} />);
    await waitFor(() => expect(screen.getByText('Gold Plan')).toBeTruthy());
    expect(invMock).not.toHaveBeenCalled();
  });

  it('renders nothing when every card is hidden', async () => {
    const { container } = render(<ClientAccount showPlanCard={false} showInvoicesCard={false} />);
    await waitFor(() => expect(screen.queryByText('loading')).toBeNull());
    expect(container.textContent).toBe('');
    expect(planMock).not.toHaveBeenCalled();
    expect(invMock).not.toHaveBeenCalled();
  });
});
