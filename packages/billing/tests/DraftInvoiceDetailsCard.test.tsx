// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DraftInvoiceDetailsCard from '../src/components/billing-dashboard/invoicing/DraftInvoiceDetailsCard';

const updateDraftInvoicePropertiesMock = vi.fn();

vi.mock('@alga-psa/billing/actions/invoiceModification', () => ({
  updateDraftInvoiceProperties: (...args: unknown[]) => updateDraftInvoicePropertiesMock(...args),
}));

const draftInvoice = {
  invoice_id: 'inv-1',
  invoice_number: 'INV-1001',
  invoice_date: '2026-04-01',
  due_date: '2026-04-15',
  status: 'draft',
  total_amount: 10500,
  currencyCode: 'USD',
  client: {
    name: 'Acme Co.',
    logo: '',
    address: '',
  },
};

describe('DraftInvoiceDetailsCard', () => {
  beforeEach(() => {
    cleanup();
    updateDraftInvoicePropertiesMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('saves updated invoice properties and clears the dirty state', async () => {
    const onSaved = vi.fn();
    updateDraftInvoicePropertiesMock.mockResolvedValue({
      invoiceId: 'inv-1',
      invoiceNumber: 'INV-2001',
      invoiceDate: '2026-04-02',
      dueDate: '2026-04-20',
    });

    render(<DraftInvoiceDetailsCard invoice={draftInvoice as any} onSaved={onSaved} />);

    const saveButton = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    const cancelButton = screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement;
    const numberInput = screen.getByDisplayValue('INV-1001') as HTMLInputElement;
    const invoiceDateInput = screen.getByDisplayValue('2026-04-01') as HTMLInputElement;

    expect(saveButton.disabled).toBe(true);
    expect(cancelButton.disabled).toBe(true);

    fireEvent.change(numberInput, { target: { value: 'INV-2001' } });
    fireEvent.change(invoiceDateInput, { target: { value: '2026-04-02' } });

    expect(saveButton.disabled).toBe(false);
    expect(cancelButton.disabled).toBe(false);

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(updateDraftInvoicePropertiesMock).toHaveBeenCalledWith('inv-1', {
        invoiceNumber: 'INV-2001',
        invoiceDate: '2026-04-02',
        dueDate: '2026-04-15',
      });
    });

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith({
        invoiceId: 'inv-1',
        invoiceNumber: 'INV-2001',
        invoiceDate: '2026-04-02',
        dueDate: '2026-04-20',
      });
    });

    expect(saveButton.disabled).toBe(true);
    expect(cancelButton.disabled).toBe(true);
    expect(numberInput.value).toBe('INV-2001');
  });

  it('surfaces duplicate invoice number errors inline', async () => {
    updateDraftInvoicePropertiesMock.mockRejectedValue(
      new Error('Invoice number already exists. Choose a different number.')
    );

    render(<DraftInvoiceDetailsCard invoice={draftInvoice as any} />);

    fireEvent.change(screen.getByDisplayValue('INV-1001'), {
      target: { value: 'INV-0001' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Invoice number already exists. Choose a different number.')).toBeTruthy();
  });
});
