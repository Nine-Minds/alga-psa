'use client'

import React, { useState } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { AlertCircle } from 'lucide-react';
import { currencyFractionDigits, getCurrencySymbol } from '@alga-psa/core';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { BillingTimingField } from './BillingTimingField';
import {
  isAdvanceTimingAllowedForLineType,
  resolveEffectiveBillingTiming,
} from '@shared/billingClients/contractLineTimingRule';

interface ContractLineEditDialogProps {
  line: {
    contract_line_id: string;
    contract_line_name?: string;
    /** Stored in cents. */
    rate?: number | null;
    /** Stored in cents. */
    custom_rate?: number | null;
    billing_timing?: 'arrears' | 'advance';
    /** Contract line type; Hourly and Usage lines always bill in arrears. */
    contract_line_type?: string | null;
    /** Verbatim invoice line text; falls back to the line name when null. */
    invoice_line_description?: string | null;
  };
  /** Currency of the contract or template being edited; shown as the input symbol. */
  currencyCode?: string | null;
  /**
   * True for a contract template: its rate is stored in the currency's own minor
   * units (0 digits for JPY), unlike contracts which keep the historical cents scale.
   */
  exactMinorUnits?: boolean;
  onClose: () => void;
  onSave: (
    contractLineId: string,
    rateCents: number,
    billingTiming: 'arrears' | 'advance',
    invoiceLineDescription: string | null,
  ) => Promise<void>;
}

export function ContractLineEditDialog({ line, currencyCode, exactMinorUnits, onClose, onSave }: ContractLineEditDialogProps) {
  const { t } = useTranslation('msp/contracts');
  const initialRateCents =
    line.rate !== undefined && line.rate !== null
      ? Math.round(Number(line.rate))
      : line.custom_rate !== undefined && line.custom_rate !== null
        ? Math.round(Number(line.custom_rate))
        : 0;

  const digits = exactMinorUnits && currencyCode ? currencyFractionDigits(currencyCode) : 2;
  const scale = 10 ** digits;

  const [rateInput, setRateInput] = useState<string>(() => (initialRateCents / scale).toFixed(digits));
  const [billingTiming, setBillingTiming] = useState<'arrears' | 'advance'>(
    resolveEffectiveBillingTiming(line.contract_line_type, line.billing_timing)
  );
  const [invoiceLineDescription, setInvoiceLineDescription] = useState<string>(
    line.invoice_line_description ?? ''
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const currencySymbol = currencyCode ? getCurrencySymbol(currencyCode) : null;

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
        resolveEffectiveBillingTiming(line.contract_line_type, billingTiming),
        invoiceLineDescription.trim() || null,
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
                  className={`${currencySymbol ? 'pl-10 ' : ''}[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="contract-line-invoice-text">
                {t('contractLineEdit.fields.invoiceText', { defaultValue: 'Invoice line text' })}
              </Label>
              <Input
                id="contract-line-invoice-text"
                type="text"
                value={invoiceLineDescription}
                onChange={(e) => setInvoiceLineDescription(e.target.value)}
                placeholder={t('contractLineEdit.fields.invoiceTextPlaceholder', {
                  defaultValue: 'Printed on the invoice; defaults to the line name',
                })}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t('contractLineEdit.fields.invoiceTextHelp', {
                  defaultValue: 'This text prints verbatim on the recurring invoice line.',
                })}
              </p>
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
              <BillingTimingField
                id="billing-timing"
                lineType={line.contract_line_type}
                value={billingTiming}
                onChange={setBillingTiming}
                hideHelp
              />
              <p className="text-xs text-muted-foreground mt-2">
                {!isAdvanceTimingAllowedForLineType(line.contract_line_type)
                  ? t('billingTimingField.nonFixedHelp', {
                    defaultValue: 'Hourly and usage lines always bill in arrears, after the work happens.',
                  })
                  : billingTiming === 'arrears'
                  ? t('contractLineEdit.timingDescriptions.arrears', {
                    defaultValue: 'Charges will be billed after the service is provided',
                  })
                  : t('contractLineEdit.timingDescriptions.advance', {
                    defaultValue: 'Charges will be billed before the service is provided',
                  })}
              </p>
            </div>
          </div>

        </form>
      </DialogContent>
    </Dialog>
  );
}
