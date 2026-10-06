/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const SQL_ERROR_MESSAGE = 'select "pm".* from "payment_methods" as "pm" - invalid input syntax for type uuid: "x"';

const actions = vi.hoisted(() => ({
  getPortalBillingProfiles: vi.fn(), getPaymentMethods: vi.fn(), getClientPortalAutopayProfile: vi.fn(),
  enrollClientPortalAutopay: vi.fn(), disableClientPortalAutopay: vi.fn(), removePaymentMethod: vi.fn(),
  setDefaultPaymentMethod: vi.fn(), startClientPortalCardSetup: vi.fn(),
}));

vi.mock('../../actions/client-portal-actions/client-billing-segments', () => ({ getPortalBillingProfiles: actions.getPortalBillingProfiles }));
vi.mock('../../actions', () => actions);
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (_key: string, options: any) => options?.defaultValue ?? _key }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: (props: any) => <button {...props} /> }));
vi.mock('@alga-psa/ui/components/Card', () => ({ Card: ({ children }: any) => <section>{children}</section> }));
vi.mock('@alga-psa/ui/components/Checkbox', () => ({ Checkbox: ({ id, label, checked, onChange }: any) => <label>{label}<input id={id} type="checkbox" checked={checked} onChange={onChange} /></label> }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: ({ id, value, onValueChange, options }: any) => <select id={id} value={value} onChange={(event) => onValueChange(event.target.value)}>{options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> }));

import PaymentMethodsTab from './PaymentMethodsTab';

const overview = (enrolled: boolean) => ({
  enabled: true, consentText: 'Recurring charges are authorized.', consentTextVersion: 'v1',
  enrollment: enrolled ? { is_enabled: true, payment_method_id: 'card-a', authorized_at: '' } : null, methods: [],
  chargeableMethods: [{ payment_method_id: 'card-a', brand: 'Visa', last4: '4242', exp_month: '12', exp_year: '2030', status: 'active' }],
});

const renderLoaded = async (enrolled = false) => {
  actions.getPortalBillingProfiles.mockResolvedValue([{ billingProfileId: 'profile-1', name: 'Main', isDefault: true }]);
  actions.getPaymentMethods.mockResolvedValue([
    { id: 'pm-1', billingProfileId: 'profile-1', type: 'credit_card', last4: '4242', expMonth: '12', expYear: '2030', isDefault: false },
  ]);
  actions.getClientPortalAutopayProfile.mockResolvedValue(overview(enrolled));
  render(<PaymentMethodsTab />);
  await screen.findByRole('button', { name: 'Add card' });
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('PaymentMethodsTab error messages', () => {
  it('shows the generic load message, not the raw message, when loading throws', async () => {
    actions.getPortalBillingProfiles.mockRejectedValue(new Error(SQL_ERROR_MESSAGE));
    actions.getPaymentMethods.mockResolvedValue([]);

    render(<PaymentMethodsTab />);

    expect(await screen.findByRole('status')).toHaveTextContent('Failed to load billing data');
    expect(screen.queryByText(/select|payment_methods|uuid/)).toBeNull();
  });

  it('shows the text of a returned action error when loading is refused', async () => {
    actions.getPortalBillingProfiles.mockResolvedValue({ actionError: 'Billing is not available for your account' });
    actions.getPaymentMethods.mockResolvedValue([]);

    render(<PaymentMethodsTab />);

    expect(await screen.findByRole('status')).toHaveTextContent('Billing is not available for your account');
  });

  it('shows the generic add-card message when starting card setup throws', async () => {
    await renderLoaded();
    actions.startClientPortalCardSetup.mockRejectedValue(new Error(SQL_ERROR_MESSAGE));

    fireEvent.click(screen.getByRole('button', { name: 'Add card' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Failed to add payment method'));
    expect(screen.queryByText(/select|payment_methods|uuid/)).toBeNull();
  });

  it('shows the text of a returned action error when starting card setup is refused', async () => {
    await renderLoaded();
    actions.startClientPortalCardSetup.mockResolvedValue({ actionError: 'Card setup is disabled for this profile' });

    fireEvent.click(screen.getByRole('button', { name: 'Add card' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Card setup is disabled for this profile'));
  });

  it('shows the generic update message when changing a payment method throws', async () => {
    await renderLoaded();
    actions.removePaymentMethod.mockRejectedValue(new Error(SQL_ERROR_MESSAGE));

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not update this payment method. Please try again.'));
    expect(screen.queryByText(/select|payment_methods|uuid/)).toBeNull();
  });

  it('shows the text of a returned action error when changing a payment method is refused', async () => {
    await renderLoaded();
    actions.setDefaultPaymentMethod.mockResolvedValue({ permissionError: 'You cannot change payment methods' });

    fireEvent.click(screen.getByRole('button', { name: 'Set default' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('You cannot change payment methods'));
  });

  it('shows the generic auto-pay message when turning auto-pay off throws', async () => {
    await renderLoaded(true);
    actions.disableClientPortalAutopay.mockRejectedValue(new Error(SQL_ERROR_MESSAGE));

    fireEvent.click(screen.getByRole('button', { name: 'Turn off auto-pay' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not update auto-pay. Please try again.'));
    expect(screen.queryByText(/select|payment_methods|uuid/)).toBeNull();
  });
});
