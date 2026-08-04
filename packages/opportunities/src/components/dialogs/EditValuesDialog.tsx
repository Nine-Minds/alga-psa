'use client';

import { useState } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  OpportunityValueFields,
  amountsToCents,
  centsToAmounts,
  type OpportunityValueAmounts,
  type OpportunityValueCents,
} from './OpportunityValueFields';

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
  initial: OpportunityValueCents;
  onSubmit: (values: OpportunityValueCents & { currency_code: string }) => Promise<void> | void;
}) {
  const { t } = useTranslation('msp/opportunities');
  const [currency, setCurrency] = useState(currencyCode);
  const [amounts, setAmounts] = useState<OpportunityValueAmounts>(() => centsToAmounts(initial, currencyCode));
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await onSubmit({ ...amountsToCents(amounts, currency), currency_code: currency });
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
        <OpportunityValueFields
          idPrefix="opportunity-values"
          currencyCode={currency}
          onCurrencyChange={setCurrency}
          amounts={amounts}
          onAmountsChange={setAmounts}
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
