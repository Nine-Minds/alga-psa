/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ getClientAutopaySettings: vi.fn(), setClientAutopay: vi.fn(), startClientAutopaySetup: vi.fn() }));

vi.mock('../../actions/clientBillingProfileActions', () => mocks);
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (_key: string, options: any) => options?.defaultValue ?? _key }) }));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({ getErrorMessage: (error: any) => error?.message ?? String(error), isActionMessageError: () => false, isActionPermissionError: () => false }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@alga-psa/ui/components/Card', () => ({ Card: ({ children }: any) => <section>{children}</section>, CardContent: ({ children }: any) => <div>{children}</div>, CardHeader: ({ children }: any) => <div>{children}</div>, CardTitle: ({ children }: any) => <h2>{children}</h2> }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: (props: any) => <button {...props} /> }));
vi.mock('@alga-psa/ui/components/Checkbox', () => ({ Checkbox: ({ id, label, checked, onChange }: any) => <label>{label}<input id={id} type="checkbox" checked={checked} onChange={onChange} /></label> }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: ({ id, value, onValueChange, options }: any) => <select id={id} value={value} onChange={(event) => onValueChange(event.target.value)}>{options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> }));
vi.mock('@alga-psa/ui/components/Dialog', () => ({ Dialog: ({ children }: any) => <>{children}</>, DialogContent: ({ children }: any) => <div>{children}</div> }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: (props: any) => <input {...props} /> }));

import { ClientAutopaySettings } from './ClientAutopaySettings';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ClientAutopaySettings auto-pay card selection', () => {
  it('preselects the only chargeable replacement card when enrollment references a removed card', async () => {
    mocks.getClientAutopaySettings.mockResolvedValue({
      enabled: true, consentText: 'Recurring charges are authorized.', consentTextVersion: 'v1',
      enrollment: { is_enabled: false, payment_method_id: 'removed-card', authorized_at: '', authorization_source: 'client', authorized_by_user_id: null },
      methods: [], chargeableMethods: [{ payment_method_id: 'card-b', brand: 'Visa', last4: '4242', exp_month: '12', exp_year: '2030', status: 'active' }], attempts: [],
    });

    render(<ClientAutopaySettings clientId="client-1" billingProfileId="profile-1" profileName="Main" />);

    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('card-b'));
    const enable = screen.getByRole('button', { name: 'Enable auto-pay' });
    expect(enable).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(enable).toBeEnabled();
    fireEvent.click(enable);
    await waitFor(() => expect(mocks.setClientAutopay).toHaveBeenCalledWith(expect.objectContaining({ paymentMethodId: 'card-b', enabled: true })));
  });

  it('switches an enrolled profile to another chargeable card without disabling auto-pay', async () => {
    mocks.getClientAutopaySettings.mockResolvedValue({
      enabled: true, consentText: 'Recurring charges are authorized.', consentTextVersion: 'v1',
      enrollment: { is_enabled: true, payment_method_id: 'card-a', authorized_at: '2026-09-01T00:00:00Z', authorization_source: 'msp', authorized_by_user_id: null },
      methods: [{ payment_method_id: 'card-a', brand: 'Visa', last4: '0341' }],
      chargeableMethods: [
        { payment_method_id: 'card-a', brand: 'Visa', last4: '0341', exp_month: '12', exp_year: '2030', status: 'active' },
        { payment_method_id: 'card-b', brand: 'Visa', last4: '4242', exp_month: '12', exp_year: '2030', status: 'active' },
      ],
      attempts: [],
    });
    mocks.setClientAutopay.mockResolvedValue(true);

    render(<ClientAutopaySettings clientId="client-1" billingProfileId="profile-1" profileName="Main" />);

    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('card-a'));
    const change = screen.getByRole('button', { name: 'Use this card for auto-pay' });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(change).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'card-b' } });
    expect(change).toBeEnabled();
    fireEvent.click(change);
    await waitFor(() => expect(mocks.setClientAutopay).toHaveBeenCalledWith(expect.objectContaining({ paymentMethodId: 'card-b', enabled: true, clientAuthorized: true })));
    expect(screen.getByRole('button', { name: 'Disable auto-pay' })).toBeInTheDocument();
  });
});
