'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { dateFromString, dateToString } from '@alga-psa/ui/lib/dateInput';
import { Label } from '@alga-psa/ui/components/Label';
import { BillingProfilePicker } from '@alga-psa/ui/components/BillingProfilePicker';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { toPlainDate } from '@alga-psa/core';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { DateValue, InvoiceViewModel as DbInvoiceViewModel } from '@alga-psa/types';
import {
  updateDraftInvoiceProperties,
  type DraftInvoicePropertiesUpdateActionResult,
  type DraftInvoicePropertiesUpdateResult,
} from '@alga-psa/billing/actions/invoiceModification';
import { getClientBillingProfilesForBilling } from '@alga-psa/billing/actions/billingProfileActions';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export interface DraftInvoiceDetailsSummary extends Pick<
  DbInvoiceViewModel,
  'invoice_id' | 'invoice_number' | 'status' | 'total_amount' | 'currencyCode' | 'client'
  | 'client_id' | 'billing_profile_id' | 'billing_profile_name' | 'client_has_multiple_billing_profiles'
> {
  invoice_date: DateValue;
  due_date: DateValue | null;
}

interface DraftInvoiceDetailsCardProps {
  invoice: DraftInvoiceDetailsSummary | null;
  onSaved?: (updated: DraftInvoicePropertiesUpdateResult) => Promise<void> | void;
}

interface DraftInvoiceDetailsFormState {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  billingProfileId: string | null;
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

const EMPTY_FORM_STATE: DraftInvoiceDetailsFormState = {
  invoiceNumber: '',
  invoiceDate: '',
  dueDate: '',
  billingProfileId: null,
};

const buildFormState = (invoice: DraftInvoiceDetailsSummary): DraftInvoiceDetailsFormState => ({
  invoiceNumber: invoice.invoice_number ?? '',
  invoiceDate: normalizeDateInputValue(invoice.invoice_date),
  dueDate: normalizeDateInputValue(invoice.due_date),
  billingProfileId: invoice.billing_profile_id ?? null,
});

const isDraftInvoiceDetailsError = (
  result: DraftInvoicePropertiesUpdateActionResult
): result is Exclude<DraftInvoicePropertiesUpdateActionResult, DraftInvoicePropertiesUpdateResult> => (
  isActionMessageError(result) || isActionPermissionError(result)
);

const DraftInvoiceDetailsCard: React.FC<DraftInvoiceDetailsCardProps> = ({
  invoice,
  onSaved,
}) => {
  const { t } = useTranslation('msp/invoicing');
  const { money } = useCurrencyFormat();
  const initialState = useMemo(() => (invoice ? buildFormState(invoice) : null), [
    invoice?.invoice_id,
    invoice?.invoice_number,
    invoice?.billing_profile_id,
    invoice ? normalizeDateInputValue(invoice.invoice_date) : '',
    invoice ? normalizeDateInputValue(invoice.due_date) : '',
  ]);

  const [formState, setFormState] = useState<DraftInvoiceDetailsFormState>(EMPTY_FORM_STATE);
  const [savedState, setSavedState] = useState<DraftInvoiceDetailsFormState>(EMPTY_FORM_STATE);
  const [isSaving, setIsSaving] = useState(false);
  const [invoiceNumberError, setInvoiceNumberError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [profileAuthenticationExpired, setProfileAuthenticationExpired] = useState(false);
  const [profileRetry, setProfileRetry] = useState(0);
  const profileRequestRef = useRef(0);
  const profileInvoiceIdentityRef = useRef('');
  profileInvoiceIdentityRef.current = `${invoice?.invoice_id ?? ''}:${invoice?.client_id ?? ''}`;

  const loadBillingProfiles = useCallback(async (clientId: string) => {
    const requestId = ++profileRequestRef.current;
    const invoiceIdentity = profileInvoiceIdentityRef.current;
    const isCurrent = () => requestId === profileRequestRef.current
      && invoiceIdentity === profileInvoiceIdentityRef.current;
    setProfileAuthenticationExpired(false);
    try {
      const result = await getClientBillingProfilesForBilling(clientId);
      if (!isCurrent()) return [];
      if (isAuthenticationFailure(result)) {
        setProfileAuthenticationExpired(true);
        throw new Error('Authentication required');
      }
      if (isActionPermissionError(result)) throw new Error(getErrorMessage(result));
      return result;
    } catch (error) {
      if (isCurrent() && isAuthenticationFailure(error)) setProfileAuthenticationExpired(true);
      throw error;
    }
  }, []);

  useEffect(() => {
    if (!initialState) {
      setFormState(EMPTY_FORM_STATE);
      setSavedState(EMPTY_FORM_STATE);
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
    formState.dueDate !== savedState.dueDate ||
    formState.billingProfileId !== savedState.billingProfileId;

  const handleSave = async () => {
    const trimmedInvoiceNumber = formState.invoiceNumber.trim();

    if (!trimmedInvoiceNumber) {
      setInvoiceNumberError(t('draftInvoiceDetails.errors.invoiceNumberRequired', {
        defaultValue: 'Invoice number is required.',
      }));
      setFormError(null);
      return;
    }

    if (!formState.invoiceDate) {
      setFormError(t('draftInvoiceDetails.errors.invoiceDateRequired', {
        defaultValue: 'Invoice date is required.',
      }));
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
        // Only a segmented client may re-point; leaving the key out keeps an
        // unsegmented draft's attribution untouched (D6).
        ...(invoice.client_has_multiple_billing_profiles
          ? { billingProfileId: formState.billingProfileId }
          : {}),
      });

      if (isDraftInvoiceDetailsError(updated)) {
        const message = getErrorMessage(updated);

        if (
          message === 'Invoice number is required' ||
          message === 'Invoice number must be unique' ||
          message === 'Invoice number already exists. Choose a different number.'
        ) {
          setInvoiceNumberError(message === 'Invoice number is required'
            ? t('draftInvoiceDetails.errors.invoiceNumberRequired', { defaultValue: 'Invoice number is required.' })
            : message);
          setFormError(null);
        } else {
          setFormError(message);
        }
        return;
      }

      const nextSavedState: DraftInvoiceDetailsFormState = {
        invoiceNumber: updated.invoiceNumber,
        invoiceDate: updated.invoiceDate,
        dueDate: updated.dueDate ?? '',
        billingProfileId: updated.billingProfileId ?? null,
      };

      setFormState(nextSavedState);
      setSavedState(nextSavedState);

      try {
        await onSaved?.(updated);
      } catch (refreshError) {
        console.error('Draft invoice details saved, but refresh failed:', refreshError);
      }
    } catch (error) {
      const message = getErrorMessage(error);

      if (
        message === 'Invoice number is required' ||
        message === 'Invoice number must be unique' ||
        message === 'Invoice number already exists. Choose a different number.'
      ) {
        setInvoiceNumberError(message === 'Invoice number is required'
          ? t('draftInvoiceDetails.errors.invoiceNumberRequired', { defaultValue: 'Invoice number is required.' })
          : message);
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
        <CardTitle>{t('draftInvoiceDetails.title', { defaultValue: 'Invoice Details' })}</CardTitle>
        <CardDescription>
          {t('draftInvoiceDetails.description', { defaultValue: 'Edit draft invoice metadata before finalizing.' })}
        </CardDescription>
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
            label={t('common.labels.invoiceNumber', { defaultValue: 'Invoice Number' })}
            value={formState.invoiceNumber}
            onChange={(event) => {
              setFormState((current) => ({ ...current, invoiceNumber: event.target.value }));
              setInvoiceNumberError(null);
            }}
            error={invoiceNumberError ?? undefined}
            disabled={isSaving}
          />

          <div className="space-y-1">
            <span className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
              {t('common.labels.status', { defaultValue: 'Status' })}
            </span>
            <div className="h-10 flex items-center">
              <Badge variant="warning">
                {invoice.status === 'draft'
                  ? t('draftsTab.status.draft', { defaultValue: 'Draft' })
                  : invoice.status}
              </Badge>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="block mb-1" htmlFor="draft-invoice-date-input">
              {t('common.labels.invoiceDate', { defaultValue: 'Invoice Date' })}
            </Label>
            <DatePicker
              id="draft-invoice-date-input"
              label={t('common.labels.invoiceDate', { defaultValue: 'Invoice Date' })}
              placeholder={t('common.labels.invoiceDate', { defaultValue: 'Invoice Date' })}
              clearable
              className="w-full"
              value={dateFromString(formState.invoiceDate)}
              onChange={(date) => setFormState((current) => ({ ...current, invoiceDate: dateToString(date) }))}
              disabled={isSaving}
              required
            />
          </div>

          <div className="space-y-1">
            <Label className="block mb-1" htmlFor="draft-due-date-input">
              {t('common.labels.dueDate', { defaultValue: 'Due Date' })}
            </Label>
            <DatePicker
              id="draft-due-date-input"
              label={t('common.labels.dueDate', { defaultValue: 'Due Date' })}
              placeholder={t('common.labels.dueDate', { defaultValue: 'Due Date' })}
              clearable
              className="w-full"
              value={dateFromString(formState.dueDate)}
              onChange={(date) => setFormState((current) => ({ ...current, dueDate: dateToString(date) }))}
              disabled={isSaving}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <span className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
              {t('common.labels.client', { defaultValue: 'Client' })}
            </span>
            <div className="min-h-10 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] px-3 py-2 text-sm text-[rgb(var(--color-text-900))]">
              {invoice.client?.name || t('common.labels.unknownClient', { defaultValue: 'Unknown client' })}
            </div>
          </div>

          <div className="space-y-1">
            <span className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
              {t('common.labels.amount', { defaultValue: 'Amount' })}
            </span>
            <div className="min-h-10 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] px-3 py-2 text-sm text-[rgb(var(--color-text-900))]">
              {money(Number(invoice.total_amount ?? 0), invoice.currencyCode || undefined)}
            </div>
          </div>

          {/* Which profile the draft bills — shown only for a segmented client,
              where the pick was a real decision worth confirming (D6). The
              draft is the last place a wrong pick can still be corrected: once
              finalized the invoice, its charges and its recipient are settled. */}
          {invoice.client_has_multiple_billing_profiles ? (
            <div className="space-y-1" id="draft-invoice-billing-profile">
              <BillingProfilePicker
                id="draft-invoice-billing-profile-select"
                key={`draft-invoice-billing-profile-${profileRetry}`}
                clientId={invoice.client_id}
                loadProfiles={loadBillingProfiles}
                value={formState.billingProfileId}
                onChange={(billingProfileId) =>
                  setFormState((current) => ({ ...current, billingProfileId }))
                }
                label={t('draftInvoiceDetails.labels.billingProfile', { defaultValue: 'Billing Profile' })}
                unassignedLabel={t('draftInvoiceDetails.labels.billingProfileDefault', {
                  defaultValue: "The client's default profile",
                })}
                hint={t('draftInvoiceDetails.hints.billingProfile', {
                  defaultValue: 'The invoice, its lines and its emailed copy follow this profile.',
                })}
                disabled={isSaving}
              />
              {profileAuthenticationExpired ? (
                <Alert variant="warning" className="mt-2">
                  <AlertDescription>
                    {t('draftInvoiceDetails.sessionExpired', { defaultValue: 'Your session expired while loading invoice details. Sign in again, then retry loading.' })}
                    <span className="ml-3 inline-flex gap-3">
                      <a id="draft-invoice-details-sign-in" href="/auth/msp/signin" target="_blank" rel="noreferrer" className="underline">{t('draftInvoiceAdjustments.signIn', { defaultValue: 'Sign in' })}</a>
                      <Button id="draft-invoice-details-retry" type="button" variant="secondary" onClick={() => setProfileRetry((attempt) => attempt + 1)}>{t('draftInvoiceAdjustments.retry', { defaultValue: 'Retry loading' })}</Button>
                    </span>
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : null}
        </div>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button
          id="draft-invoice-details-cancel"
          variant="outline"
          onClick={handleCancel}
          disabled={!hasChanges || isSaving}
        >
          {t('common.actions.cancel', { defaultValue: 'Cancel' })}
        </Button>
        <Button
          id="draft-invoice-details-save"
          onClick={handleSave}
          disabled={!hasChanges || isSaving}
        >
          {isSaving
            ? t('draftInvoiceDetails.actions.saving', { defaultValue: 'Saving...' })
            : t('common.actions.save', { defaultValue: 'Save' })}
        </Button>
      </CardFooter>
    </Card>
  );
};

export default DraftInvoiceDetailsCard;

function isAuthenticationFailure(value: unknown): value is { success: false; code: 'UNAUTHENTICATED'; message?: string; error?: string; params?: Record<string, unknown> } | { name: 'AuthenticationError'; message?: string; code?: string } {
  if (!value || typeof value !== 'object') return false;
  const error = value as { name?: string; message?: string; code?: string };
  return error.name === 'AuthenticationError' || error.code === 'UNAUTHENTICATED'
    || error.message === 'User not authenticated';
}
