/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CoManagedUpgrade from '../../../components/co-managed/CoManagedUpgrade';
import { CoManagedFeatureBoundary } from '../../../components/co-managed/CoManagedFeatureBoundary';
const mocks = vi.hoisted(() => ({ load: vi.fn(), start: vi.fn(), purchase: vi.fn(), retryPayment: vi.fn(), manageBilling: vi.fn(), update: vi.fn(), push: vi.fn(), refresh: vi.fn(), flag: true, tenant: 'customer' }));
vi.mock('@ee/lib/actions/coManagedUpgradeActions', () => ({ getCoManagedUpgradeScreenAction: mocks.load, startCoManagedUpgradeAction: mocks.start, purchaseCoManagedUpgradeAction: mocks.purchase, retryCoManagedUpgradePaymentAction: mocks.retryPayment, manageCoManagedUpgradeBillingAction: mocks.manageBilling }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: () => ({ enabled: mocks.flag }) }));
vi.mock('../../../lib/actions/coManagedAcceptanceActions', () => ({}));
vi.mock('@/context/ProductContext', () => ({ useProduct: () => ({ productCode: 'co_managed' }) }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'admin', tenant: mocks.tenant } }, update: mocks.update }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string) => key }), useOptionalI18n: () => null }));
vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({ ConfirmationDialog: ({ isOpen, onConfirm, onClose, message }: any) => isOpen
  ? <div role="dialog"><p>{message}</p><button onClick={onConfirm}>Confirm upgrade</button><button onClick={onClose}>Cancel upgrade</button></div> : null }));
vi.mock('@enterprise/components/co-managed/CoManagedCheckout', () => ({ default: ({ onComplete }: any) => <button onClick={onComplete}>Complete fixture payment</button> }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: ({ id, label, value, disabled, options, onValueChange }: any) => <label>{label}<select id={id} value={value} disabled={disabled} onChange={e => onValueChange(e.target.value)}>{options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label> }));
const eligible = { state: 'eligible', relationshipId: 'relationship', revision: 4, departed: false, selfHosted: true,
  seatsRequired: 2, entitlementReady: true, progress: 'idle' };
const mount = () => render(<CoManagedFeatureBoundary><CoManagedUpgrade /></CoManagedFeatureBoundary>);
beforeEach(() => { vi.clearAllMocks(); mocks.flag = true; mocks.tenant = 'customer'; mocks.load.mockResolvedValue(eligible);
  mocks.start.mockResolvedValue({ completed: false, enqueued: true }); mocks.update.mockResolvedValue(undefined); });
afterEach(cleanup);

it('does not load or expose upgrade controls when the release flag is disabled', () => {
  mocks.flag = false; mount(); expect(mocks.load).not.toHaveBeenCalled(); expect(screen.queryByRole('button')).toBeNull();
});
it('requires entitlement and confirmation, then reuses the same command after a lost acknowledgement', async () => {
  mocks.load.mockResolvedValueOnce({ ...eligible, entitlementReady: false });
  mount(); expect(await screen.findByRole('button', { name: 'coManaged.upgrade.start' })).toBeDisabled();
  expect(screen.getByRole('link', { name: 'coManaged.upgrade.manageLicense' })).toHaveAttribute('href', '/msp/licenses');
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.upgrade.refresh' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'coManaged.upgrade.start' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.upgrade.start' }));
  expect(mocks.start).not.toHaveBeenCalled();
  mocks.start.mockRejectedValueOnce(new Error('Lost acknowledgement'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm upgrade' }));
  await screen.findByText('coManaged.upgrade.startError');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm upgrade' }));
  await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(2));
  expect(mocks.start.mock.calls[1]).toEqual(mocks.start.mock.calls[0]);
  expect(mocks.start.mock.calls[0][0]).toMatchObject({ relationshipId: 'relationship', expectedRevision: 4, operationId: expect.any(String) });
});
it('refreshes the session before opening the independent PSA workspace', async () => {
  mocks.load.mockResolvedValue({ state: 'completed', operationId: 'operation', progress: 'completed' });
  mount(); fireEvent.click(await screen.findByRole('button', { name: 'coManaged.upgrade.openPsa' }));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/msp/dashboard'));
  expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(mocks.push.mock.invocationCallOrder[0]);
});
it('discards an old customer response when the session switches workspaces', async () => {
  let resolve!: (value: unknown) => void;
  mocks.load.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const view = mount(); mocks.tenant = 'another-customer';
  mocks.load.mockResolvedValue({ ...eligible, entitlementReady: false });
  view.rerender(<CoManagedFeatureBoundary><CoManagedUpgrade /></CoManagedFeatureBoundary>);
  await screen.findByText('coManaged.upgrade.licenseRequired');
  await act(async () => resolve({ state: 'completed', operationId: 'old-operation', progress: 'completed' }));
  expect(screen.queryByText('coManaged.upgrade.completed')).toBeNull();
});

it('resumes a hosted checkout with its original terms and requires separate conversion after payment', async () => {
  const pending = { operationId: 'paid-operation', quantity: 5, interval: 'year' };
  mocks.load.mockResolvedValue({ ...eligible, selfHosted: false, entitlementReady: false, pendingPurchase: pending });
  mocks.purchase.mockResolvedValueOnce({ kind: 'checkout', clientSecret: 'fixture', publishableKey: 'pk_fixture' }).mockResolvedValueOnce({ kind: 'paid' });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'coManaged.resumePurchase' }));
  expect(await screen.findByRole('button', { name: 'Complete fixture payment' })).toBeVisible();
  expect(mocks.purchase).toHaveBeenCalledWith(pending);
  mocks.load.mockResolvedValue({ ...eligible, selfHosted: false, entitlementReady: true, pendingPurchase: null });
  fireEvent.click(screen.getByRole('button', { name: 'Complete fixture payment' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Complete fixture payment' })).toBeNull());
  expect(mocks.start).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'coManaged.upgrade.start' })).toBeEnabled();
});

it('requires confirmation before resetting a failed payment and opens a new checkout with the original seat terms', async () => {
  const failed = { operationId: 'failed-operation', quantity: 5, interval: 'year', paymentFailed: true };
  mocks.load.mockResolvedValue({ ...eligible, selfHosted: false, entitlementReady: false, pendingPurchase: failed });
  mocks.retryPayment.mockResolvedValue({ kind: 'expired' });
  mocks.purchase.mockResolvedValue({ kind: 'checkout', clientSecret: 'new-fixture', publishableKey: 'pk_fixture' });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'coManaged.upgrade.retryPayment' }));
  expect(mocks.retryPayment).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm upgrade' }));
  await screen.findByRole('button', { name: 'Complete fixture payment' });
  expect(mocks.retryPayment).toHaveBeenCalledWith('failed-operation');
  expect(mocks.purchase.mock.calls[0][0]).toMatchObject({ quantity: 5, interval: 'year' });
  expect(mocks.purchase.mock.calls[0][0].operationId).not.toBe('failed-operation');
  expect(mocks.start).not.toHaveBeenCalled();
});
it('reviews a paid seat change separately and prevents selecting fewer seats than currently needed', async () => {
  mocks.load.mockResolvedValue({ ...eligible, selfHosted: false, hasOwnBilling: true, paidSeats: 4, pendingPurchase: null });
  mocks.manageBilling.mockRejectedValue(new Error('Provider unavailable'));
  mount();
  const input = await screen.findByLabelText('coManaged.upgrade.paidSeats');
  expect(input).toHaveValue(4);
  fireEvent.change(input, { target: { value: '1' } });
  expect(screen.getByRole('button', { name: 'coManaged.upgrade.reviewSeatChange' })).toBeDisabled();
  fireEvent.change(input, { target: { value: '6' } });
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.upgrade.reviewSeatChange' }));
  await screen.findByText('coManaged.upgrade.billingError');
  expect(mocks.manageBilling).toHaveBeenCalledWith({ kind: 'seats', quantity: 6 });
  expect(mocks.start).not.toHaveBeenCalled();
});
