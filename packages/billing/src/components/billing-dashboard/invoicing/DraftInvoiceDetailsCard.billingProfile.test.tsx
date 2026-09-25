// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A manual invoice raised against a specific billing profile has to say so once
 * it is a draft, and — because the pick decides the bill-to identity and the
 * address the invoice is emailed to — it has to stay correctable while the
 * invoice is still a draft. Finalizing settles all three.
 *
 * The control obeys the same invisibility rule as every other profile surface:
 * a client with one profile had no choice to make, so it sees nothing.
 */

const mocks = vi.hoisted(() => ({
  updateDraftInvoiceProperties: vi.fn(),
  loadProfiles: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/invoiceModification', () => ({
  updateDraftInvoiceProperties: mocks.updateDraftInvoiceProperties,
}));
vi.mock('@alga-psa/billing/actions/billingProfileActions', () => ({
  getClientBillingProfilesForBilling: mocks.loadProfiles,
}));
vi.mock('@alga-psa/ui/lib', () => ({
  useCurrencyFormat: () => ({ money: (value: number) => `$${(value / 100).toFixed(2)}` }),
}));
// The date pickers reach for the app's i18n provider; this card's subject is
// the profile row, not date entry.
vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: ({ id }: { id: string }) => <input id={id} readOnly />,
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options?.defaultValue as string) ?? key,
  }),
}));

const DraftInvoiceDetailsCard = (await import('./DraftInvoiceDetailsCard')).default;

const invoice = (overrides: Record<string, unknown> = {}) => ({
  invoice_id: 'invoice-1',
  invoice_number: 'INV001012',
  status: 'draft',
  total_amount: 10000,
  currencyCode: 'USD',
  client_id: 'client-1',
  client: { name: 'Northstar Dental Group', logo: '', address: '' },
  invoice_date: '2026-09-25',
  due_date: '2026-10-25',
  ...overrides,
}) as any;

const profile = (id: string, name: string, isDefault: boolean) => ({
  billing_profile_id: id,
  client_id: 'client-1',
  name,
  is_default: isDefault,
  is_active: true,
  is_system_managed_default: isDefault,
});

const segmented = [
  profile('profile-default', 'Northstar Dental Group', true),
  profile('profile-merged', '12345', false),
];

describe('draft invoice details — the profile it bills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadProfiles.mockResolvedValue(segmented);
    mocks.updateDraftInvoiceProperties.mockResolvedValue({
      invoiceId: 'invoice-1',
      invoiceNumber: 'INV001012',
      invoiceDate: '2026-09-25',
      dueDate: '2026-10-25',
      billingProfileId: 'profile-merged',
      billingProfileName: '12345',
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('names the profile the draft was raised against', async () => {
    render(
      <DraftInvoiceDetailsCard
        invoice={invoice({
          billing_profile_id: 'profile-merged',
          billing_profile_name: '12345',
          client_has_multiple_billing_profiles: true,
        })}
      />,
    );

    expect(await screen.findByText('Billing Profile')).toBeTruthy();
    const trigger = await screen.findByRole('combobox');
    await waitFor(() => expect(trigger.textContent).toContain('12345'));
  });

  it('falls back to naming the client default when the draft carries no profile', async () => {
    render(
      <DraftInvoiceDetailsCard
        invoice={invoice({
          billing_profile_id: null,
          billing_profile_name: null,
          client_has_multiple_billing_profiles: true,
        })}
      />,
    );

    const trigger = await screen.findByRole('combobox');
    await waitFor(() => expect(trigger.textContent).toContain("The client's default profile"));
  });

  it('re-points the draft at the profile the operator switches to', async () => {
    const onSaved = vi.fn();
    render(
      <DraftInvoiceDetailsCard
        invoice={invoice({
          billing_profile_id: 'profile-default',
          billing_profile_name: 'Northstar Dental Group',
          client_has_multiple_billing_profiles: true,
        })}
        onSaved={onSaved}
      />,
    );

    const trigger = await screen.findByRole('combobox');
    await waitFor(() => expect(trigger.textContent).toContain('Northstar Dental Group'));
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: '12345' }));
    await waitFor(() => expect(trigger.textContent).toContain('12345'));

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(mocks.updateDraftInvoiceProperties).toHaveBeenCalled());
    expect(mocks.updateDraftInvoiceProperties.mock.calls[0][1]).toMatchObject({
      invoiceNumber: 'INV001012',
      billingProfileId: 'profile-merged',
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('shows no profile control for a client that holds a single profile', async () => {
    mocks.loadProfiles.mockResolvedValue([profile('profile-default', 'Northstar Dental Group', true)]);

    render(
      <DraftInvoiceDetailsCard
        invoice={invoice({
          billing_profile_id: null,
          billing_profile_name: 'Northstar Dental Group',
          client_has_multiple_billing_profiles: false,
        })}
      />,
    );

    expect(screen.queryByText('Billing Profile')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();

    // An unsegmented draft must save exactly what it saved before profiles
    // existed: the key is absent, so nothing re-points.
    fireEvent.change(screen.getByDisplayValue('INV001012'), { target: { value: 'INV001013' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(mocks.updateDraftInvoiceProperties).toHaveBeenCalled());
    expect(mocks.updateDraftInvoiceProperties.mock.calls[0][1]).not.toHaveProperty('billingProfileId');
  });
});
