// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The manual-invoice screen must let an operator bill a specific profile — the
 * reason a merged-in client's profile is reachable at all — while a client that
 * holds a single profile keeps a screen with no profile control on it.
 */

const mocks = vi.hoisted(() => ({
  generateManualInvoice: vi.fn(),
  getClientBillingEmailStatus: vi.fn(),
  loadProfiles: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/manualInvoiceActions', () => ({
  generateManualInvoice: mocks.generateManualInvoice,
  getClientBillingEmailStatus: mocks.getClientBillingEmailStatus,
}));
vi.mock('@alga-psa/billing/actions/salesOrderInvoicingActions', () => ({
  generateInvoiceForSalesOrder: vi.fn(),
}));
vi.mock('@alga-psa/billing/actions/invoiceModification', () => ({
  updateInvoiceManualItems: vi.fn(),
}));
vi.mock('@alga-psa/billing/actions/invoiceQueries', () => ({
  getInvoiceLineItems: vi.fn(async () => []),
}));
vi.mock('@alga-psa/billing/actions/billingProfileActions', () => ({
  getClientBillingProfilesForBilling: mocks.loadProfiles,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@alga-psa/ui/context', () => ({
  useQuickAddClient: () => ({ renderQuickAddClient: () => null }),
}));
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: ({ id, clients, onSelect }: any) => (
    <button id={id} type="button" onClick={() => onSelect(clients[0].client_id)}>
      pick client
    </button>
  ),
}));
vi.mock('./LineItem', () => ({ LineItem: () => null }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: Record<string, unknown>) => {
      const fallback = (options?.defaultValue as string) ?? _key;
      return fallback.replace(/{{(\w+)}}/g, (_match, token) => String(options?.[token] ?? ''));
    },
  }),
  useFormatters: () => ({ formatCurrency: (value: number) => `$${value.toFixed(2)}` }),
}));

const ManualInvoices = (await import('./ManualInvoices')).default;

const clients = [{ client_id: 'client-1', client_name: 'Northstar Dental Group' }] as any;
const props = {
  clients,
  services: [],
  onGenerateSuccess: vi.fn(),
};

const profile = (id: string, name: string, isDefault: boolean) => ({
  billing_profile_id: id,
  client_id: 'client-1',
  name,
  is_default: isDefault,
  is_active: true,
  is_system_managed_default: isDefault,
});

describe('ManualInvoices billing profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClientBillingEmailStatus.mockResolvedValue({ hasBillingEmail: true });
    mocks.generateManualInvoice.mockResolvedValue({ success: true, invoice: {} });
  });

  afterEach(cleanup);

  it('pre-selects the default profile and bills the one the operator picks', async () => {
    mocks.loadProfiles.mockResolvedValue([
      profile('profile-default', 'Northstar Dental Group', true),
      profile('profile-merged', '12345', false),
    ]);

    render(<ManualInvoices {...props} />);
    fireEvent.click(screen.getByText('pick client'));

    const trigger = await screen.findByRole('combobox');
    await waitFor(() => expect(trigger.textContent).toContain('Northstar Dental Group (default)'));

    fireEvent.click(screen.getByText('Generate Invoice'));
    await waitFor(() => expect(mocks.generateManualInvoice).toHaveBeenCalled());
    expect(mocks.generateManualInvoice.mock.calls[0][0]).toMatchObject({
      clientId: 'client-1',
      billingProfileId: 'profile-default',
    });
  });

  it('bills the profile the operator switches to', async () => {
    mocks.loadProfiles.mockResolvedValue([
      profile('profile-default', 'Northstar Dental Group', true),
      profile('profile-merged', '12345', false),
    ]);

    render(<ManualInvoices {...props} />);
    fireEvent.click(screen.getByText('pick client'));

    const trigger = await screen.findByRole('combobox');
    await waitFor(() => expect(trigger.textContent).toContain('(default)'));
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: '12345' }));
    await waitFor(() => expect(trigger.textContent).toContain('12345'));

    fireEvent.click(screen.getByText('Generate Invoice'));
    await waitFor(() => expect(mocks.generateManualInvoice).toHaveBeenCalled());
    expect(mocks.generateManualInvoice.mock.calls[0][0].billingProfileId).toBe('profile-merged');
  });

  it('shows no profile control for a client with a single profile', async () => {
    mocks.loadProfiles.mockResolvedValue([profile('profile-default', 'Northstar Dental Group', true)]);

    render(<ManualInvoices {...props} />);
    fireEvent.click(screen.getByText('pick client'));

    await waitFor(() => expect(mocks.loadProfiles).toHaveBeenCalledWith('client-1'));
    expect(screen.queryByRole('combobox')).toBeNull();

    fireEvent.click(screen.getByText('Generate Invoice'));
    await waitFor(() => expect(mocks.generateManualInvoice).toHaveBeenCalled());
    expect(mocks.generateManualInvoice.mock.calls[0][0].billingProfileId).toBeNull();
  });
});
