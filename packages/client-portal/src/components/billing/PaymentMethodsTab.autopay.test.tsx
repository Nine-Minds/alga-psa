/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';

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

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('PaymentMethodsTab auto-pay card selection', () => {
  it('preselects the only chargeable replacement card and enrolls with it after consent', async () => {
    actions.getPortalBillingProfiles.mockResolvedValue([{ billingProfileId: 'profile-1', name: 'Main', isDefault: true }]);
    actions.getPaymentMethods.mockResolvedValue([]);
    actions.getClientPortalAutopayProfile.mockResolvedValue({
      enabled: true, consentText: 'Recurring charges are authorized.', consentTextVersion: 'v1',
      enrollment: { is_enabled: false, payment_method_id: 'removed-card', authorized_at: '' }, methods: [],
      chargeableMethods: [{ payment_method_id: 'card-b', brand: 'Visa', last4: '4242', exp_month: '12', exp_year: '2030', status: 'active' }],
    });
    actions.enrollClientPortalAutopay.mockResolvedValue({ success: true });

    render(<PaymentMethodsTab />);

    const cardPicker = await screen.findByLabelText(/Visa/).catch(() => screen.getByRole('combobox'));
    expect(cardPicker).toHaveValue('card-b');
    const enable = screen.getByRole('button', { name: 'Enable auto-pay' });
    expect(enable).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(enable).toBeEnabled();
    fireEvent.click(enable);
    await waitFor(() => expect(actions.enrollClientPortalAutopay).toHaveBeenCalledWith('profile-1', 'card-b', 'v1'));
  });
});
