/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CoManagedPoolEditor from '../../../components/co-managed/CoManagedPoolEditor';

const mocks = vi.hoisted(() => ({ state: vi.fn(), preview: vi.fn(), purchase: vi.fn() }));
vi.mock('@/lib/actions/coManagedActions', () => ({ getCoManagedBillingState: mocks.state }));
vi.mock('@enterprise/lib/actions/coManagedBillingActions', () => ({
  previewCoManagedSeatsAction: mocks.preview, purchaseCoManagedSeatsAction: mocks.purchase,
}));
vi.mock('@enterprise/components/co-managed/CoManagedCheckout', () => ({ default: () => <div>Stripe checkout</div> }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string; quantity?: number }) => options?.defaultValue ?? key }),
  useFormatters: () => ({ formatCurrency: (value: number) => `$${value}`, formatDate: (value: Date) => value.toISOString() }),
}));

const billing = (over: Record<string, unknown> = {}) => ({
  capacity: 4, allocated: 2, available: 2, canGrow: true, isReadOnly: false, graceEndsAt: null,
  selfHosted: false, isPro: true, canPurchase: true, pending: null,
  purchase: { deployment: 'hosted', sponsorshipEligible: true, accountAuthority: 'purchaser', implementationAvailable: true,
    providerReady: true, pending: null, canPurchase: true, canResume: false, reason: 'available' },
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.state.mockResolvedValue(billing());
  mocks.preview.mockResolvedValue({ unitAmount: 1149, monthlyTotal: 6894, amountDue: 1200, currency: 'usd' });
  mocks.purchase.mockResolvedValue({ kind: 'updated', subscriptionId: 'sub', publishableKey: null });
});
afterEach(cleanup);

describe('hosted co-managed pool editor', () => {
  it('reviews the absolute pool total before confirming', async () => {
    render(<CoManagedPoolEditor showTotals />);
    const quantity = await screen.findByLabelText('coManaged.quantity');
    fireEvent.change(quantity, { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.reviewPurchase' }));
    await screen.findByRole('button', { name: 'coManaged.confirmPurchase' });
    expect(mocks.preview).toHaveBeenCalledWith(6);
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.confirmPurchase' }));
    await waitFor(() => expect(mocks.purchase).toHaveBeenCalledWith({ quantity: 6, operationId: expect.any(String) }));
  });

  it('keeps a pending operation when embedded checkout returns no usable key', async () => {
    mocks.purchase.mockResolvedValue({ kind: 'checkout', sessionId: 'cs', clientSecret: 'secret', publishableKey: null });
    render(<CoManagedPoolEditor />);
    fireEvent.change(await screen.findByLabelText('coManaged.quantity'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.reviewPurchase' }));
    fireEvent.click(await screen.findByRole('button', { name: 'coManaged.confirmPurchase' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Embedded checkout is unavailable. Retry after the payment setup is repaired.');
    expect(screen.queryByText('Stripe checkout')).toBeNull();
    expect(mocks.purchase).toHaveBeenCalledTimes(1);
  });

  it('routes self-host capacity changes to License Management instead of hosted checkout', async () => {
    mocks.state.mockResolvedValue(billing({ selfHosted: true, canPurchase: false,
      purchase: { ...billing().purchase, deployment: 'self_host', canPurchase: false, reason: 'self_host_license' } }));
    render(<CoManagedPoolEditor />);
    expect(await screen.findByRole('link', { name: 'coManaged.manageLicense' })).toHaveAttribute('href', '/msp/licenses');
    expect(screen.queryByRole('button', { name: 'coManaged.reviewPurchase' })).toBeNull();
  });
});
