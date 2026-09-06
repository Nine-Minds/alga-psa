// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import GenerateTab from './GenerateTab';

const mocks = vi.hoisted(() => ({ clients: vi.fn(), services: vi.fn(), salesOrders: vi.fn() }));
vi.mock('@alga-psa/billing/actions/billingClientsActions', () => ({ getAllClientsForBilling: mocks.clients }));
vi.mock('@alga-psa/billing/actions/serviceActions', () => ({ getServices: mocks.services }));
vi.mock('@alga-psa/billing/actions/salesOrderInvoicingActions', () => ({ listInvoiceableSalesOrdersForBilling: mocks.salesOrders }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: () => ({ enabled: true }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, options: { defaultValue: string }) => options.defaultValue }) }));
vi.mock('@alga-psa/ui/components/SuccessDialog', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div role="alert">{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock('../AutomaticInvoices', () => ({ default: () => null }));
vi.mock('../PrepaymentInvoices', () => ({ default: () => null }));
vi.mock('../ManualInvoices', () => ({ default: ({ clients, services, invoiceableSalesOrders }: any) => <>
  <select aria-label="Client">{clients.map((client: any) => <option key={client.client_id}>{client.client_name}</option>)}</select>
  <select aria-label="Service">{services.map((service: any) => <option key={service.service_id}>{service.service_name}</option>)}</select>
  <select aria-label="Sales order">{invoiceableSalesOrders.map((order: any) => <option key={order.id}>{order.name}</option>)}</select>
</> }));

const props = { initialServices: [], invoiceType: 'manual' as const, refreshTrigger: 0, onGenerateSuccess: vi.fn() };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.clients.mockResolvedValue([{ client_id: 'client-1', client_name: 'Client A' }]);
  mocks.services.mockResolvedValue({ services: [{ service_id: 'service-1', service_name: 'Support' }] });
  mocks.salesOrders.mockResolvedValue([{ id: 'order-1', name: 'Order A' }]);
});
afterEach(cleanup);

it.each(['Permission denied: sales_order read required', 'Sales order database unavailable'])(
  'keeps manual billing inputs available when optional sources fail: %s', async message => {
    mocks.salesOrders.mockRejectedValue(new Error(message));
    render(<GenerateTab {...props} />);
    expect(await screen.findByRole('option', { name: 'Client A' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Support' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Order A' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Sales order sources could not be loaded');
    expect(screen.queryByText('Failed to load data')).toBeNull();
  },
);

it('clears an optional-source warning and restores sources after a successful refresh', async () => {
  mocks.salesOrders.mockRejectedValueOnce(new Error('Permission denied'));
  const view = render(<GenerateTab {...props} />);
  await screen.findByRole('alert');
  view.rerender(<GenerateTab {...props} refreshTrigger={1} />);
  expect(await screen.findByRole('option', { name: 'Order A' })).toBeTruthy();
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});

it('does not treat a required client-loading failure as an optional-source failure', async () => {
  mocks.clients.mockRejectedValue(new Error('Client database unavailable'));
  render(<GenerateTab {...props} />);
  expect((await screen.findByRole('alert')).textContent).toBe('Failed to load data');
  expect(screen.queryByRole('option', { name: 'Client A' })).toBeNull();
});
