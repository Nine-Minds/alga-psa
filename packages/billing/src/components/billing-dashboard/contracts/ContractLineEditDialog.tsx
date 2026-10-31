'use client'

import React, { useState } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { AlertCircle } from 'lucide-react';
import { getCurrencySymbol } from '@alga-psa/core';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useCurrencyFormat } from '@alga-psa/ui/lib';

interface ContractLineEditDialogProps {
  line: {
    contract_line_id: string;
    contract_line_name?: string;
    /** Stored in cents. */
    rate?: number | null;
    /** Stored in cents. */
    custom_rate?: number | null;
    billing_timing?: 'arrears' | 'advance';
    /** Bundle title on invoices (Fixed lines); blank falls back to the line name. */
    invoice_line_description?: string | null;
    /** Muted second line under the bundle title (Fixed lines). */
    invoice_line_subtitle?: string | null;
  };
  /** Show the Invoice text group (Fixed lines only). */
  showInvoiceText?: boolean;
  /**
   * Currency of the contract being edited. Omit (null) for a contract template,
   * which is currency-neutral: no symbol is shown and the rate is scaled by the
   * same fraction digits `useTemplateNeutralRate` uses to display it.
   */
  currencyCode?: string | null;
  onClose: () => void;
  onSave: (
    contractLineId: string,
    rateCents: number,
    billingTiming: 'arrears' | 'advance',
    invoiceText?: { invoice_line_description: string | null; invoice_line_subtitle: string | null },
  ) => Promise<void>;
}

export function ContractLineEditDialog({ line, currencyCode, showInvoiceText, onClose, onSave }: ContractLineEditDialogProps) {
  const { t } = useTranslation('msp/contracts');
  const initialRateCents =
    line.rate !== undefined && line.rate !== null
      ? Math.round(Number(line.rate))
      : line.custom_rate !== undefined && line.custom_rate !== null
        ? Math.round(Number(line.custom_rate))
        : 0;

  const neutral = !currencyCode;
  const { fractionDigits } = useCurrencyFormat();
  // Contracts keep their historical cents scale; neutral template rates use the
  // authoring currency's minor-unit scale, matching useTemplateNeutralRate.
  const digits = neutral ? fractionDigits() : 2;
  const scale = 10 ** digits;

  const [rateInput, setRateInput] = useState<string>(() => (initialRateCents / scale).toFixed(digits));
  const [billingTiming, setBillingTiming] = useState<'arrears' | 'advance'>(
    line.billing_timing || 'arrears'
  );
  const [invoiceTitle, setInvoiceTitle] = useState(line.invoice_line_description ?? '');
  const [invoiceSubtitle, setInvoiceSubtitle] = useState(line.invoice_line_subtitle ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const currencySymbol = neutral ? null : getCurrencySymbol(currencyCode as string);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const dollars = Number.parseFloat(rateInput);
    if (!Number.isFinite(dollars) || dollars < 0) {
      setError(t('contractLineEdit.validation.validRateRequired', {
        defaultValue: 'Please enter a valid rate (must be a non-negative number)',
      }));
      return;
    }

    const rateCents = Math.round(dollars * scale);

    setIsSaving(true);
    try {
      await onSave(
        line.contract_line_id,
        rateCents,
        billingTiming,
        showInvoiceText
          ? {
              invoice_line_description: invoiceTitle.trim() || null,
              invoice_line_subtitle: invoiceSubtitle.trim() || null,
            }
          : undefined,
      );
    } catch (err) {
      console.error('Failed to save contract line:', err);
      setError(err instanceof Error
        ? err.message
        : t('contractLineEdit.errors.failedToSaveChanges', {
          defaultValue: 'Failed to save changes',
        }));
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      isOpen={true}
      onClose={onClose}
      title={t('contractLineEdit.title', {
        defaultValue: 'Edit Contract Line: {{name}}',
        name: line.contract_line_name ?? t('contractLineEdit.values.unnamedLine', { defaultValue: 'Unnamed line' }),
      })}
      className="max-w-md"
      footer={(
        <div className="flex justify-end space-x-2">
          <Button
            id="cancel-edit-line-btn"
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={isSaving}
          >
            {t('contractLineEdit.actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            id="save-edit-line-btn"
            type="button"
            onClick={() => (document.getElementById('contract-line-edit-form') as HTMLFormElement | null)?.requestSubmit()}
            disabled={isSaving}
          >
            {isSaving
              ? t('contractLineEdit.actions.saving', { defaultValue: 'Saving...' })
              : t('contractLineEdit.actions.saveChanges', { defaultValue: 'Save Changes' })}
          </Button>
        </div>
      )}
    >
      <DialogContent>
        <form id="contract-line-edit-form" onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Custom Rate Section */}
          <div className="space-y-4">
            <h4 className="font-medium text-sm">{t('contractLineEdit.sections.pricing', { defaultValue: 'Pricing' })}</h4>

            <div>
              <Label htmlFor="contract-line-rate">{t('contractLineEdit.fields.rate', { defaultValue: 'Rate' })}</Label>
              <div className="relative">
                {currencySymbol && (
                  <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">
                    {currencySymbol}
                  </span>
                )}
                <Input
                  id="contract-line-rate"
                  type="text"
                  inputMode="decimal"
                  value={rateInput}
                  onChange={(e) => {
                    const value = e.target.value.replace(/[^0-9.]/g, '');
                    const decimalCount = (value.match(/\./g) || []).length;
                    if (decimalCount <= 1) {
                      setRateInput(value);
                    }
                  }}
                  onBlur={() => {
                    if (rateInput.trim() === '' || rateInput === '.') {
                      setRateInput((0).toFixed(digits));
                      return;
                    }
                    const dollars = Number.parseFloat(rateInput);
                    if (!Number.isFinite(dollars) || dollars < 0) {
                      setRateInput((0).toFixed(digits));
                      return;
                    }
                    const minor = Math.round(dollars * scale);
                    setRateInput((minor / scale).toFixed(digits));
                  }}
                  className={`${neutral ? '' : 'pl-10 '}[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                />
              </div>
            </div>
          </div>

          {/* Billing Timing Section */}
          <div className="space-y-4 border-t pt-4">
            <h4 className="font-medium text-sm">
              {t('contractLineEdit.sections.billingTiming', { defaultValue: 'Billing Timing' })}
            </h4>

            <div>
              <Label htmlFor="billing-timing">
                {t('contractLineEdit.fields.billingTimingQuestion', {
                  defaultValue: 'When should this line be billed?',
                })}
              </Label>
              <CustomSelect
                value={billingTiming}
                onValueChange={(value) => setBillingTiming(value as 'arrears' | 'advance')}
                options={[
                  {
                    label: t('contractLineEdit.timingOptions.arrears', {
                      defaultValue: 'In Arrears (at end of billing period)',
                    }),
                    value: 'arrears'
                  },
                  {
                    label: t('contractLineEdit.timingOptions.advance', {
                      defaultValue: 'In Advance (at start of billing period)',
                    }),
                    value: 'advance'
                  }
                ]}
              />
              <p className="text-xs text-muted-foreground mt-2">
                {billingTiming === 'arrears'
                  ? t('contractLineEdit.timingDescriptions.arrears', {
                    defaultValue: 'Charges will be billed after the service is provided',
                  })
                  : t('contractLineEdit.timingDescriptions.advance', {
                    defaultValue: 'Charges will be billed before the service is provided',
                  })}
              </p>
            </div>
          </div>

          {showInvoiceText && (
            <div className="space-y-4 border-t pt-4">
              <h4 className="font-medium text-sm">
                {t('contractLineEdit.sections.invoiceText', { defaultValue: 'Invoice text' })}
              </h4>
              <div>
                <Label htmlFor="contract-line-invoice-title">
                  {t('contractLineEdit.fields.invoiceTitle', { defaultValue: 'Title' })}
                </Label>
                <Input
                  id="contract-line-invoice-title"
                  value={invoiceTitle}
                  onChange={(e) => setInvoiceTitle(e.target.value)}
                  placeholder={line.contract_line_name ?? ''}
                />
              </div>
              <div>
                <Label htmlFor="contract-line-invoice-subtitle">
                  {t('contractLineEdit.fields.invoiceSubtitle', { defaultValue: 'Subtitle' })}
                </Label>
                <Input
                  id="contract-line-invoice-subtitle"
                  value={invoiceSubtitle}
                  onChange={(e) => setInvoiceSubtitle(e.target.value)}
                />
              </div>
            </div>
          )}

        </form>
      </DialogContent>
    </Dialog>
  );
}
