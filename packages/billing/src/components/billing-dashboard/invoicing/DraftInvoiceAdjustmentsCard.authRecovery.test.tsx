// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ clients: vi.fn(), services: vi.fn(), capability: vi.fn() }));
vi.mock('@alga-psa/billing/actions/billingClientsActions', () => ({ getAllClientsForBilling: mocks.clients }));
vi.mock('@alga-psa/billing/actions/serviceActions', () => ({ getServices: mocks.services }));
vi.mock('@alga-psa/billing/actions/invoiceModification', () => ({ getInvoiceAdjustmentCapability: mocks.capability }));
vi.mock('../ManualInvoices', () => ({ default: () => <div data-testid="manual-editor" /> }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (_key: string, options?: any) => options?.defaultValue ?? _key }) }));
import DraftInvoiceAdjustmentsCard from './DraftInvoiceAdjustmentsCard';
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); mocks.clients.mockResolvedValue([]); mocks.services.mockResolvedValue({ services: [] }); mocks.capability.mockResolvedValue({ editable: true, code: 'editable', reason: '' }); });
const invoice: any = { invoice_id: 'inv-1', invoice_charges: [] };
describe('draft adjustment capability auth recovery', () => {
  it('offers sign-in and explicit capability retry after auth failure', async () => {
    mocks.capability.mockRejectedValueOnce(Object.assign(new Error('User not authenticated'), { name: 'AuthenticationError' }));
    render(<DraftInvoiceAdjustmentsCard invoice={invoice} />);
    expect(await screen.findByText(/session expired while loading invoice adjustments/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('target')).toBe('_blank');
    expect(screen.queryByTestId('manual-editor')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
    await waitFor(() => expect(screen.getByTestId('manual-editor')).toBeTruthy());
    expect(mocks.capability).toHaveBeenCalledTimes(2);
  });
  it('keeps permission failures distinct from authentication recovery', async () => {
    mocks.capability.mockResolvedValueOnce({ permissionError: 'Permission denied: invoice update required' });
    render(<DraftInvoiceAdjustmentsCard invoice={invoice} />);
    expect(await screen.findByText('Permission denied: invoice update required')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
  });
});
