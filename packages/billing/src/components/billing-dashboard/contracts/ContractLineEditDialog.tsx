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

interface ContractLineEditDialogProps {
  line: {
    contract_line_id: string;
    contract_line_name?: string;
    /** Stored in cents. */
    rate?: number | null;
    /** Stored in cents. */
    custom_rate?: number | null;
    billing_timing?: 'arrears' | 'advance';
  };
  currencyCode: string;
  onClose: () => void;
  onSave: (contractLineId: string, rateCents: number, billingTiming: 'arrears' | 'advance') => Promise<void>;
}

export function ContractLineEditDialog({ line, currencyCode, onClose, onSave }: ContractLineEditDialogProps) {
  const { t } = useTranslation('msp/contracts');
  const initialRateCents =
    line.rate !== undefined && line.rate !== null
      ? Math.round(Number(line.rate))
      : line.custom_rate !== undefined && line.custom_rate !== null
        ? Math.round(Number(line.custom_rate))
        : 0;

  const [rateInput, setRateInput] = useState<string>(() => (initialRateCents / 100).toFixed(2));
  const [billingTiming, setBillingTiming] = useState<'arrears' | 'advance'>(
    line.billing_timing || 'arrears'
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const currencySymbol = getCurrencySymbol(currencyCode);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const dollars = Number.parseFloat(rateInput);
    if (!Number.isFinite(dollars) || dollars < 0) {
      setError(t('contractLineEdit.validation.validRateRequired', {
        defaultValue: 'Please enter a valid rate (must be a non-negative number)',
      }));
      return;
    }

    const rateCents = Math.round(dollars * 100);

    setIsSaving(true);
    try {
      await onSave(line.contract_line_id, rateCents, billingTiming);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('contractLineEdit.errors.failedToSaveChanges', {
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
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">
                  {currencySymbol}
                </span>
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
                      setRateInput('0.00');
                      return;
                    }
                    const dollars = Number.parseFloat(rateInput);
                    if (!Number.isFinite(dollars) || dollars < 0) {
                      setRateInput('0.00');
                      return;
                    }
                    const cents = Math.round(dollars * 100);
                    setRateInput((cents / 100).toFixed(2));
                  }}
                  className="pl-10 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
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

        </form>
      </DialogContent>
    </Dialog>
  );
}
