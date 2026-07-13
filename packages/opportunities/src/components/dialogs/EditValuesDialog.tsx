'use client';

import { useState } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { CurrencyInput } from '@alga-psa/ui/components/CurrencyInput';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { toMinorUnits, currencyFractionDigits } from '@alga-psa/core';

/** Manual value entry, available only until an accepted quote takes ownership of the numbers. */
export function EditValuesDialog({
  isOpen,
  onClose,
  currencyCode,
  initial,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  currencyCode: string;
  initial: { mrr_cents: number; nrr_cents: number; hardware_cents: number };
  onSubmit: (values: { mrr_cents: number; nrr_cents: number; hardware_cents: number }) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const factor = Math.pow(10, currencyFractionDigits(currencyCode));
  const [mrr, setMrr] = useState<number | undefined>(initial.mrr_cents / factor);
  const [nrr, setNrr] = useState<number | undefined>(initial.nrr_cents / factor);
  const [hardware, setHardware] = useState<number | undefined>(initial.hardware_cents / factor);
  const [saving, setSaving] = useState(false);

  const toCents = (v?: number) => (v == null ? 0 : toMinorUnits(v, undefined, currencyCode));

  const submit = async () => {
    setSaving(true);
    try {
      await onSubmit({ mrr_cents: toCents(mrr), nrr_cents: toCents(nrr), hardware_cents: toCents(hardware) });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      id="opportunity-edit-values-dialog"
      isOpen={isOpen}
      onClose={onClose}
      title={t('opportunities.valuesDialog.title', 'Estimated value')}
    >
      <div className="space-y-4 pt-1">
        <p className="text-[13px] text-[rgb(var(--color-text-500))]">
          {t(
            'opportunities.valuesDialog.note',
            'These are your estimates. An accepted quote replaces them with the real numbers.'
          )}
        </p>
        <CurrencyInput
          id="opportunity-values-mrr"
          label={t('opportunities.valuesDialog.mrr', 'Recurring (monthly)')}
          currencyCode={currencyCode}
          value={mrr}
          onChange={setMrr}
        />
        <CurrencyInput
          id="opportunity-values-nrr"
          label={t('opportunities.valuesDialog.nrr', 'One-time services')}
          currencyCode={currencyCode}
          value={nrr}
          onChange={setNrr}
        />
        <CurrencyInput
          id="opportunity-values-hardware"
          label={t('opportunities.valuesDialog.hardware', 'Hardware')}
          currencyCode={currencyCode}
          value={hardware}
          onChange={setHardware}
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button id="opportunity-values-cancel" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button id="opportunity-values-save" size="sm" onClick={submit} disabled={saving}>
            {t('common.saveChanges', 'Save changes')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
