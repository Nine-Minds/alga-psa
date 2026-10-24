/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { InvoiceViewModel } from '@alga-psa/types';

const actions = vi.hoisted(() => ({ clients: vi.fn(), services: vi.fn(), capability: vi.fn() }));
// The card prefetches through the session-recoverable wrappers, so the mocks
// must expose those names and not the raw loaders.
vi.mock('@alga-psa/billing/actions/billingClientsActions', () => ({ getClientByIdForBillingRecoverable: actions.clients }));
vi.mock('@alga-psa/billing/actions/serviceActions', () => ({ getServicesRecoverable: actions.services }));
vi.mock('@alga-psa/billing/actions/invoiceModification', () => ({ getInvoiceAdjustmentCapability: actions.capability }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key }),
}));
vi.mock('../src/components/billing-dashboard/ManualInvoices', () => ({
  default: ({ invoice }: { invoice: InvoiceViewModel }) => <div data-testid="manual-editor">{invoice.invoice_id}</div>,
}));

import DraftInvoiceAdjustmentsCard from '../src/components/billing-dashboard/invoicing/DraftInvoiceAdjustmentsCard';

const invoice = (id: string) => ({ invoice_id: id, client_id: 'client-1', status: 'draft' }) as InvoiceViewModel;
const editable = { editable: true, code: null, reason: null, isManualOrigin: false, currencyCode: 'USD' };

describe('draft invoice adjustment access', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    actions.clients.mockResolvedValue(null);
    actions.services.mockResolvedValue({ services: [] });
    actions.capability.mockResolvedValue(editable);
  });
  afterEach(cleanup);

  it('opens the shared manual editor for an editable contract draft', async () => {
    render(<DraftInvoiceAdjustmentsCard invoice={invoice('draft-1')} />);
    expect(await screen.findByTestId('manual-editor')).toHaveTextContent('draft-1');
    expect(actions.capability).toHaveBeenCalledWith('draft-1');
    // Only the invoice's own client is read, never the client list.
    expect(actions.clients).toHaveBeenCalledWith('client-1');
  });

  it('shows a returned permission denial instead of opening the editor', async () => {
    actions.capability.mockResolvedValue({ permissionError: 'Invoice update permission is required.' });
    render(<DraftInvoiceAdjustmentsCard invoice={invoice('draft-1')} />);
    expect(await screen.findByText('Invoice update permission is required.')).toBeInTheDocument();
    expect(screen.queryByTestId('manual-editor')).not.toBeInTheDocument();
  });

  it('replaces a previous invoice block with the new invoice permission denial', async () => {
    actions.capability.mockResolvedValueOnce({ ...editable, editable: false, code: 'exported', reason: 'Already exported; issue a credit.' });
    const { rerender } = render(<DraftInvoiceAdjustmentsCard invoice={invoice('exported')} />);
    expect(await screen.findByText('Already exported; issue a credit.')).toBeInTheDocument();
    actions.capability.mockResolvedValueOnce({ permissionError: 'Invoice update permission is required.' });
    rerender(<DraftInvoiceAdjustmentsCard invoice={invoice('denied')} />);
    expect(await screen.findByText('Invoice update permission is required.')).toBeInTheDocument();
    expect(screen.queryByText('Already exported; issue a credit.')).not.toBeInTheDocument();
    expect(screen.queryByTestId('manual-editor')).not.toBeInTheDocument();
  });

  it('ignores an earlier invoice capability response after selection changes', async () => {
    let resolveOld!: (value: typeof editable) => void;
    actions.capability.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
    const { rerender } = render(<DraftInvoiceAdjustmentsCard invoice={invoice('old')} />);
    actions.capability.mockResolvedValueOnce({ ...editable, editable: false, code: 'exported', reason: 'Already exported; issue a credit.' });
    rerender(<DraftInvoiceAdjustmentsCard invoice={invoice('current')} />);
    expect(await screen.findByText('Already exported; issue a credit.')).toBeInTheDocument();
    resolveOld(editable);
    await waitFor(() => expect(screen.queryByTestId('manual-editor')).not.toBeInTheDocument());
    expect(screen.getByText('Already exported; issue a credit.')).toBeInTheDocument();
  });
});
