'use client'

import React, { useEffect, useMemo, useState } from 'react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { formatCurrencyFromMinorUnits, toPlainDate } from '@alga-psa/core';
import type { InvoiceViewModel as DbInvoiceViewModel } from '@alga-psa/types';
import {
  updateDraftInvoiceProperties,
  type DraftInvoicePropertiesUpdateResult,
} from '@alga-psa/billing/actions/invoiceModification';

export type DraftInvoiceDetailsSummary = Pick<
  DbInvoiceViewModel,
  'invoice_id' | 'invoice_number' | 'invoice_date' | 'due_date' | 'status' | 'total_amount' | 'currencyCode' | 'client'
>;

interface DraftInvoiceDetailsCardProps {
  invoice: DraftInvoiceDetailsSummary | null;
  onSaved?: (updated: DraftInvoicePropertiesUpdateResult) => Promise<void> | void;
}

interface DraftInvoiceDetailsFormState {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
}

const normalizeDateInputValue = (value: DraftInvoiceDetailsSummary['invoice_date'] | DraftInvoiceDetailsSummary['due_date']) => {
  if (!value) {
    return '';
  }

  try {
    return toPlainDate(value).toString();
  } catch (error) {
    console.error('Failed to normalize invoice date for input field:', error);
    return '';
  }
};

const buildFormState = (invoice: DraftInvoiceDetailsSummary): DraftInvoiceDetailsFormState => ({
  invoiceNumber: invoice.invoice_number ?? '',
  invoiceDate: normalizeDateInputValue(invoice.invoice_date),
  dueDate: normalizeDateInputValue(invoice.due_date),
});

const DraftInvoiceDetailsCard: React.FC<DraftInvoiceDetailsCardProps> = ({
  invoice,
  onSaved,
}) => {
  const initialState = useMemo(() => (invoice ? buildFormState(invoice) : null), [
    invoice?.invoice_id,
    invoice?.invoice_number,
    invoice ? normalizeDateInputValue(invoice.invoice_date) : '',
    invoice ? normalizeDateInputValue(invoice.due_date) : '',
  ]);

  const [formState, setFormState] = useState<DraftInvoiceDetailsFormState>({
    invoiceNumber: '',
    invoiceDate: '',
    dueDate: '',
  });
  const [savedState, setSavedState] = useState<DraftInvoiceDetailsFormState>({
    invoiceNumber: '',
    invoiceDate: '',
    dueDate: '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [invoiceNumberError, setInvoiceNumberError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialState) {
      setFormState({ invoiceNumber: '', invoiceDate: '', dueDate: '' });
      setSavedState({ invoiceNumber: '', invoiceDate: '', dueDate: '' });
      setInvoiceNumberError(null);
      setFormError(null);
      return;
    }

    setFormState(initialState);
    setSavedState(initialState);
    setInvoiceNumberError(null);
    setFormError(null);
  }, [initialState]);

  if (!invoice) {
    return null;
  }

  const hasChanges =
    formState.invoiceNumber !== savedState.invoiceNumber ||
    formState.invoiceDate !== savedState.invoiceDate ||
    formState.dueDate !== savedState.dueDate;

  const handleSave = async () => {
    const trimmedInvoiceNumber = formState.invoiceNumber.trim();

    if (!trimmedInvoiceNumber) {
      setInvoiceNumberError('Invoice number is required.');
      setFormError(null);
      return;
    }

    if (!formState.invoiceDate) {
      setFormError('Invoice date is required.');
      return;
    }

    setIsSaving(true);
    setInvoiceNumberError(null);
    setFormError(null);

    try {
      const updated = await updateDraftInvoiceProperties(invoice.invoice_id, {
        invoiceNumber: trimmedInvoiceNumber,
        invoiceDate: formState.invoiceDate,
        dueDate: formState.dueDate || null,
      });

      const nextSavedState: DraftInvoiceDetailsFormState = {
        invoiceNumber: updated.invoiceNumber,
        invoiceDate: updated.invoiceDate,
        dueDate: updated.dueDate ?? '',
      };

      setFormState(nextSavedState);
      setSavedState(nextSavedState);

      try {
        await onSaved?.(updated);
      } catch (refreshError) {
        console.error('Draft invoice details saved, but refresh failed:', refreshError);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save invoice details.';

      if (
        message === 'Invoice number is required' ||
        message === 'Invoice number must be unique' ||
        message === 'Invoice number already exists. Choose a different number.'
      ) {
        setInvoiceNumberError(message === 'Invoice number is required' ? 'Invoice number is required.' : message);
        setFormError(null);
      } else {
        setFormError(message);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setFormState(savedState);
    setInvoiceNumberError(null);
    setFormError(null);
  };

  return (
    <Card className="mb-4" id="draft-invoice-details-card">
      <CardHeader className="pb-4">
        <CardTitle>Invoice Details</CardTitle>
        <CardDescription>Edit draft invoice metadata before finalizing.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {formError ? (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <Input
            id="draft-invoice-number-input"
            label="Invoice Number"
            value={formState.invoiceNumber}
            onChange={(event) => {
              setFormState((current) => ({ ...current, invoiceNumber: event.target.value }));
              setInvoiceNumberError(null);
            }}
            error={invoiceNumberError ?? undefined}
            disabled={isSaving}
          />

          <div className="space-y-1">
            <span className="block text-sm font-medium text-[rgb(var(--color-text-700))]">Status</span>
            <div className="h-10 flex items-center">
              <Badge variant="warning">{invoice.status === 'draft' ? 'Draft' : invoice.status}</Badge>
            </div>
          </div>

          <Input
            id="draft-invoice-date-input"
            label="Invoice Date"
            type="date"
            value={formState.invoiceDate}
            onChange={(event) => setFormState((current) => ({ ...current, invoiceDate: event.target.value }))}
            disabled={isSaving}
            required
          />

          <Input
            id="draft-due-date-input"
            label="Due Date"
            type="date"
            value={formState.dueDate}
            onChange={(event) => setFormState((current) => ({ ...current, dueDate: event.target.value }))}
            disabled={isSaving}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <span className="block text-sm font-medium text-[rgb(var(--color-text-700))]">Client</span>
            <div className="min-h-10 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] px-3 py-2 text-sm text-[rgb(var(--color-text-900))]">
              {invoice.client?.name || 'Unknown client'}
            </div>
          </div>

          <div className="space-y-1">
            <span className="block text-sm font-medium text-[rgb(var(--color-text-700))]">Amount</span>
            <div className="min-h-10 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] px-3 py-2 text-sm text-[rgb(var(--color-text-900))]">
              {formatCurrencyFromMinorUnits(Number(invoice.total_amount ?? 0), 'en-US', invoice.currencyCode || 'USD')}
            </div>
          </div>
        </div>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button
          id="draft-invoice-details-cancel"
          variant="outline"
          onClick={handleCancel}
          disabled={!hasChanges || isSaving}
        >
          Cancel
        </Button>
        <Button
          id="draft-invoice-details-save"
          onClick={handleSave}
          disabled={!hasChanges || isSaving}
        >
          {isSaving ? 'Saving...' : 'Save'}
        </Button>
      </CardFooter>
    </Card>
  );
};

export default DraftInvoiceDetailsCard;
