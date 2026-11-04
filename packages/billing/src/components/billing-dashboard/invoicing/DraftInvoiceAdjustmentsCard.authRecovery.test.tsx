// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ clients: vi.fn(), services: vi.fn(), capability: vi.fn() }));
vi.mock('@alga-psa/billing/actions/billingClientsActions', () => ({ getClientByIdForBillingRecoverable: mocks.clients }));
vi.mock('@alga-psa/billing/actions/serviceActions', () => ({ getServicesRecoverable: mocks.services }));
vi.mock('@alga-psa/billing/actions/invoiceModification', () => ({ getInvoiceAdjustmentCapability: mocks.capability }));
vi.mock('../ManualInvoices', () => ({ default: () => <div data-testid="manual-editor" /> }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (_key: string, options?: any) => options?.defaultValue ?? _key }) }));
import DraftInvoiceAdjustmentsCard from './DraftInvoiceAdjustmentsCard';
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); mocks.clients.mockResolvedValue(null); mocks.services.mockResolvedValue({ services: [] }); mocks.capability.mockResolvedValue({ editable: true, code: 'editable', reason: '' }); });
const invoice: any = { invoice_id: 'inv-1', client_id: 'client-1', invoice_charges: [] };
const authResult = { success: false, code: 'UNAUTHENTICATED', params: {}, message: 'Authentication required', error: 'Authentication required' };

describe('draft adjustment read auth recovery', () => {
  it('offers sign-in and explicit capability retry after auth failure', async () => {
    mocks.capability.mockResolvedValueOnce({ success: false, code: 'UNAUTHENTICATED', params: {}, message: 'Authentication required', error: 'Authentication required' });
    render(<DraftInvoiceAdjustmentsCard invoice={invoice} />);
    expect(await screen.findByText(/session expired while loading invoice adjustments/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('target')).toBe('_blank');
    expect(screen.queryByTestId('manual-editor')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
    await waitFor(() => expect(screen.getByTestId('manual-editor')).toBeTruthy());
    expect(mocks.capability).toHaveBeenCalledTimes(2);
  });
  it('recovers when all three independent initial reads return serialized auth failures', async () => {
    mocks.clients.mockResolvedValueOnce(authResult);
    mocks.services.mockResolvedValueOnce(authResult);
    mocks.capability.mockResolvedValueOnce(authResult);
    render(<DraftInvoiceAdjustmentsCard invoice={invoice} />);
    expect(await screen.findByText(/session expired while loading invoice adjustments/i)).toBeTruthy();
    expect(screen.queryByTestId('manual-editor')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
    await waitFor(() => expect(screen.getByTestId('manual-editor')).toBeTruthy());
    expect(mocks.clients).toHaveBeenCalledTimes(2);
    expect(mocks.services).toHaveBeenCalledTimes(2);
    expect(mocks.capability).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['client', () => mocks.clients.mockResolvedValueOnce(authResult)],
    ['service', () => mocks.services.mockResolvedValueOnce(authResult)],
  ])('offers recovery when only the %s read expires', async (_label, expireOneRead) => {
    expireOneRead();
    render(<DraftInvoiceAdjustmentsCard invoice={invoice} />);
    expect(await screen.findByText(/session expired while loading invoice adjustments/i)).toBeTruthy();
    expect(screen.queryByTestId('manual-editor')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
    expect(await screen.findByTestId('manual-editor')).toBeTruthy();
  });
  it.each([
    ['client', () => mocks.clients.mockResolvedValueOnce({ permissionError: 'Permission denied: client read required' }), 'Permission denied: client read required'],
    ['service', () => mocks.services.mockResolvedValueOnce({ permissionError: 'Permission denied: service read required' }), 'Permission denied: service read required'],
  ])('keeps %s permission denial distinct from auth recovery', async (_label, denyRead, message) => {
    denyRead();
    render(<DraftInvoiceAdjustmentsCard invoice={invoice} />);
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
  });
  it('keeps permission failures distinct from authentication recovery', async () => {
    mocks.capability.mockResolvedValueOnce({ permissionError: 'Permission denied: invoice update required' });
    render(<DraftInvoiceAdjustmentsCard invoice={invoice} />);
    expect(await screen.findByText('Permission denied: invoice update required')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
  });
});
