'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { dateFromString, dateToString } from '@alga-psa/ui/lib/dateInput';
import { Dialog, DialogContent, DialogDescription } from '@alga-psa/ui/components/Dialog';
import { Label } from '@alga-psa/ui/components/Label';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { ITaxRate, ITaxRegion } from '@alga-psa/types';
import { toPlainDate } from '@alga-psa/core';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { addTaxRate, updateTaxRate } from '../../../actions/taxRateActions';

export interface TaxRateDialogProps {
  isOpen: boolean;
  /** The region the rate belongs to. A rate never moves between regions. */
  region: Pick<ITaxRegion, 'region_code' | 'region_name'>;
  /** The rate being edited, or null to create one in `region`. */
  rate: ITaxRate | null;
  onClose: () => void;
  /** Called after a successful create or update with the persisted rate. */
  onSaved: (rate: ITaxRate) => void;
}

const toDateInput = (date: string | null | undefined): string => (date ? toPlainDate(date).toString() : '');

export function TaxRateDialog({ isOpen, region, rate, onClose, onSaved }: TaxRateDialogProps) {
  const { t } = useTranslation('msp/service-catalog');
  const isEditing = rate !== null;
  const [draft, setDraft] = useState<Partial<ITaxRate>>({});
  const [error, setError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setDraft(rate
      ? {
          ...rate,
          // The driver returns numerics as strings; the number input wants 6, not "6.0000".
          tax_percentage: Number(rate.tax_percentage),
          start_date: toDateInput(rate.start_date),
          end_date: toDateInput(rate.end_date),
        }
      : { region_code: region.region_code, is_active: true });
    setError(null);
    setHasAttemptedSubmit(false);
  }, [isOpen, rate, region.region_code]);

  const update = (patch: Partial<ITaxRate>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
  };

  const missing = {
    percentage: draft.tax_percentage === undefined || Number.isNaN(draft.tax_percentage),
    startDate: !draft.start_date,
  };
  const validationErrors = [
    missing.percentage ? t('taxRates.validation.percentage', { defaultValue: 'Tax percentage' }) : null,
    missing.startDate ? t('taxRates.validation.startDate', { defaultValue: 'Start date' }) : null,
  ].filter((message): message is string => message !== null);

  const handleSubmit = async () => {
    setHasAttemptedSubmit(true);
    if (validationErrors.length > 0) {
      return;
    }
    setIsSubmitting(true);
    try {
      const payload = {
        ...draft,
        region_code: region.region_code,
        end_date: draft.end_date || null,
      } as ITaxRate;
      const result = isEditing
        ? await updateTaxRate(payload)
        : await addTaxRate(payload);
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        setError(getErrorMessage(result));
        return;
      }
      onSaved(result);
    } catch (caught) {
      console.error('Error saving tax rate:', caught);
      setError(caught instanceof Error && caught.message
        ? caught.message
        : isEditing
          ? t('taxRates.errors.update', { defaultValue: 'Failed to update tax rate' })
          : t('taxRates.errors.add', { defaultValue: 'Failed to add tax rate' }));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      id="tax-rate-dialog"
      title={isEditing
        ? t('taxRates.dialog.editTitle', { defaultValue: 'Edit Tax Rate' })
        : t('taxRates.dialog.addTitle', { defaultValue: 'Add New Tax Rate' })}
      footer={(
        <div className="flex justify-end space-x-2">
          <Button id="cancel-tax-rate-button" type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            {t('taxRates.actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            id="save-tax-rate-button"
            type="button"
            disabled={isSubmitting}
            onClick={() => (document.getElementById('tax-rate-form') as HTMLFormElement | null)?.requestSubmit()}
          >
            {isEditing
              ? t('taxRates.actions.update', { defaultValue: 'Update Tax Rate' })
              : t('taxRates.actions.add', { defaultValue: 'Add Tax Rate' })}
          </Button>
        </div>
      )}
    >
      <DialogContent>
        <DialogDescription>
          {t('taxRates.dialog.regionDescription', {
            region: region.region_name,
            defaultValue: 'This rate applies to invoices taxed in {{region}}.',
          })}
        </DialogDescription>
        <form
          id="tax-rate-form"
          onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }}
          noValidate
        >
          <div className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {hasAttemptedSubmit && validationErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertDescription>
                  <p className="font-medium mb-2">
                    {t('taxRates.validation.requiredFieldsTitle', {
                      defaultValue: 'Please fill in the required fields:',
                    })}
                  </p>
                  <ul className="list-disc list-inside space-y-1">
                    {validationErrors.map((message) => <li key={message}>{message}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <div>
              <Label htmlFor="tax-rate-percentage-field">
                {t('taxRates.dialog.fields.percentage', { defaultValue: 'Tax Percentage *' })}
              </Label>
              <Input
                id="tax-rate-percentage-field"
                type="number"
                value={draft.tax_percentage ?? ''}
                onChange={(e) => update({ tax_percentage: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                placeholder={t('taxRates.dialog.placeholders.percentage', { defaultValue: 'Enter percentage' })}
                className={hasAttemptedSubmit && missing.percentage ? 'border-red-500' : ''}
              />
            </div>
            <div>
              <Label htmlFor="tax-rate-description-field">
                {t('taxRates.dialog.fields.description', { defaultValue: 'Description' })}
              </Label>
              <Input
                id="tax-rate-description-field"
                value={draft.description || ''}
                onChange={(e) => update({ description: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="tax-rate-start-date-field">
                {t('taxRates.dialog.fields.startDate', { defaultValue: 'Start Date *' })}
              </Label>
              <DatePicker
                id="tax-rate-start-date-field"
                label={t('taxRates.dialog.fields.startDate', { defaultValue: 'Start Date *' })}
                placeholder={t('taxRates.dialog.fields.startDate', { defaultValue: 'Start Date *' })}
                clearable
                value={dateFromString(draft.start_date || '')}
                onChange={(date) => update({ start_date: dateToString(date) })}
                className={`w-full ${hasAttemptedSubmit && missing.startDate ? 'border-red-500' : ''}`}
              />
            </div>
            <div>
              <Label htmlFor="tax-rate-end-date-field">
                {t('taxRates.dialog.fields.endDate', { defaultValue: 'End Date (Optional)' })}
              </Label>
              <DatePicker
                id="tax-rate-end-date-field"
                label={t('taxRates.dialog.fields.endDate', { defaultValue: 'End Date (Optional)' })}
                placeholder={t('taxRates.dialog.fields.endDate', { defaultValue: 'End Date (Optional)' })}
                clearable
                className="w-full"
                value={dateFromString(draft.end_date || '')}
                onChange={(date) => update({ end_date: dateToString(date) || null })}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="tax-rate-active-field">
                  {t('taxRates.dialog.fields.active', { defaultValue: 'Active' })}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t('taxRates.dialog.activeHint', {
                    defaultValue: 'Inactive rates are ignored when invoices are taxed.',
                  })}
                </p>
              </div>
              <Switch
                id="tax-rate-active-field"
                checked={draft.is_active !== false}
                onCheckedChange={(checked) => update({ is_active: checked })}
              />
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
