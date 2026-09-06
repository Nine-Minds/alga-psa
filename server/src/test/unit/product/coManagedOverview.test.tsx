/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CoManagedPage from '../../../app/msp/co-managed/page';

const mocks = vi.hoisted(() => ({ flag: vi.fn(), state: vi.fn(), preview: vi.fn(), purchase: vi.fn() }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: mocks.flag }));
vi.mock('../../../lib/actions/coManagedActions', () => ({ getCoManagedBillingState: mocks.state }));
vi.mock('@enterprise/lib/actions/coManagedBillingActions', () => ({
  previewCoManagedSeatsAction: mocks.preview, purchaseCoManagedSeatsAction: mocks.purchase,
}));
vi.mock('@enterprise/components/co-managed/CoManagedCheckout', () => ({ default: () => <div>Stripe checkout</div> }));
const translate = (key: string) => key;
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: translate }), useOptionalI18n: () => null,
  useFormatters: () => ({ formatCurrency: (value: number) => `$${value}`, formatDate: (value: Date) => value.toISOString() }),
}));

const billing = { capacity: 4, allocated: 2, available: 2, canGrow: true, isReadOnly: false,
  graceEndsAt: null, selfHosted: false, isPro: true, canPurchase: true, pending: null };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.flag.mockReturnValue({ enabled: true, loading: false, error: null });
  mocks.state.mockResolvedValue(billing);
  mocks.preview.mockResolvedValue({ unitAmount: 1149, monthlyTotal: 6894, amountDue: 1200, currency: 'usd' });
  mocks.purchase.mockResolvedValue({ kind: 'updated', subscriptionId: 'sub_co_managed', publishableKey: null });
});
afterEach(cleanup);

describe('co-managed seat purchase UI', () => {
  it('does not mount or fetch the feature on a disabled direct browser path', () => {
    mocks.flag.mockReturnValue({ enabled: false, loading: false, error: null });
    render(<CoManagedPage />);
    expect(mocks.state).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('requires charge review before submitting a purchase', async () => {
    render(<CoManagedPage />);
    const quantity = await screen.findByLabelText('coManaged.quantity');
    fireEvent.change(quantity, { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.reviewPurchase' }));
    await screen.findByRole('button', { name: 'coManaged.confirmPurchase' });
    expect(mocks.preview).toHaveBeenCalledWith(6);
    expect(mocks.purchase).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.confirmPurchase' }));
    await waitFor(() => expect(mocks.purchase).toHaveBeenCalledWith({ quantity: 6, operationId: expect.any(String) }));
  });

  it('resumes the immutable pending operation after a lost response', async () => {
    mocks.state.mockResolvedValue({ ...billing, pending: { operation_id: 'old-operation', quantity: 6, state: 'preparing' } });
    render(<CoManagedPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'coManaged.resumePurchase' }));
    await waitFor(() => expect(mocks.purchase).toHaveBeenCalledWith({ quantity: 6, operationId: 'old-operation' }));
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it('routes self-hosted capacity management to the license screen', async () => {
    mocks.state.mockResolvedValue({ ...billing, selfHosted: true, canPurchase: false });
    render(<CoManagedPage />);
    expect(await screen.findByRole('link', { name: 'coManaged.manageLicense' })).toHaveAttribute('href', '/msp/licenses');
    expect(screen.queryByRole('button', { name: 'coManaged.reviewPurchase' })).toBeNull();
  });

  it('does not offer purchases to a caller without billing update permission', async () => {
    mocks.state.mockResolvedValue({ ...billing, canPurchase: false });
    render(<CoManagedPage />);
    await screen.findByText('coManaged.seatPool');
    expect(screen.queryByRole('button', { name: 'coManaged.reviewPurchase' })).toBeNull();
  });
});
