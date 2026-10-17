'use client';

import React, { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { ContractDraftDiscount } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { validateDiscountInput } from '../../../../lib/billing/discountAuthoring';

interface ContractDiscountsPanelProps {
  discounts: ContractDraftDiscount[];
  currencyCode: string;
  onChange: (discounts: ContractDraftDiscount[]) => void;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Authors the contract-wide automatic discounts a new contract starts with.
 *
 * The drafts live in wizard state and are written once, as independently owned
 * discount definitions on the new client contract, when setup is finished — the
 * same shape the contract's Discounts tab edits afterwards. Line- and
 * service-scoped discounts stay on that tab, which can name the contract's
 * saved lines and services.
 */
export function ContractDiscountsPanel({
  discounts,
  currencyCode,
  onChange,
}: ContractDiscountsPanelProps) {
  const { t } = useTranslation('msp/contracts');
  const { formatCurrency } = useFormatters();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'percentage' | 'fixed'>('percentage');
  const [value, setValue] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setEditingKey(null);
    setName('');
    setKind('percentage');
    setValue('');
    setStartDate(today());
    setEndDate('');
    setError(null);
  };

  const edit = (discount: ContractDraftDiscount) => {
    setEditingKey(discount.draft_key);
    setName(discount.discount_name);
    setKind(discount.discount_type);
    setValue(String(discount.value));
    setStartDate(discount.start_date);
    setEndDate(discount.end_date ?? '');
    setError(null);
  };

  const formatValue = (discount: ContractDraftDiscount) =>
    discount.discount_type === 'percentage'
      ? `${discount.value}%`
      : formatCurrency(discount.value, currencyCode || 'USD');

  const save = () => {
    const draft: ContractDraftDiscount = {
      draft_key: editingKey ?? uuidv4(),
      discount_name: name.trim(),
      discount_type: kind,
      value: Number(value),
      start_date: startDate,
      end_date: endDate || null,
    };
    // The same rules the discount actions apply, so a draft can never author a
    // discount the server would refuse on finish.
    const validationError = validateDiscountInput({ ...draft, scope: 'contract' });
    if (validationError) {
      setError(validationError);
      return;
    }
    onChange(
      editingKey
        ? discounts.map((current) => (current.draft_key === editingKey ? draft : current))
        : [...discounts, draft],
    );
    resetForm();
  };

  const remove = (draftKey: string) => {
    if (editingKey === draftKey) resetForm();
    onChange(discounts.filter((current) => current.draft_key !== draftKey));
  };

  return (
    <section
      aria-labelledby="contract-wizard-discounts-heading"
      className="space-y-3 border-t pt-6"
    >
      <h3 id="contract-wizard-discounts-heading" className="text-base font-semibold">
        {t('contractDiscounts.title', { defaultValue: 'Discounts' })}
      </h3>
      <p className="text-sm text-muted-foreground">
        {t('wizard.discounts.help', {
          defaultValue:
            'Contract-wide discounts apply to every eligible charge this contract bills. They are created with the contract when you finish setup, and the simulation below prices them.',
        })}
      </p>

      {discounts.map((discount) => (
        <div
          key={discount.draft_key}
          className="flex items-center justify-between gap-3 border-b pb-2 text-sm"
        >
          <span>
            {discount.discount_name} · {formatValue(discount)} ·{' '}
            {discount.start_date}
            {discount.end_date ? ` → ${discount.end_date}` : ''}
          </span>
          <div className="flex gap-2">
            <Button
              id={`edit-wizard-discount-${discount.draft_key}-button`}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => edit(discount)}
            >
              {t('common.actions.edit', { defaultValue: 'Edit' })}
            </Button>
            <Button
              id={`remove-wizard-discount-${discount.draft_key}-button`}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => remove(discount.draft_key)}
            >
              {t('templateDetail.discounts.remove', { defaultValue: 'Remove' })}
            </Button>
          </div>
        </div>
      ))}

      <div className="grid gap-3 md:grid-cols-2">
        <Input
          id="wizard-discount-name"
          label={t('contractDiscounts.fields.name', { defaultValue: 'Name' })}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('contractDiscounts.fields.namePlaceholder', {
            defaultValue: 'e.g. Loyalty 10%',
          })}
        />
        <div>
          <label
            htmlFor="wizard-discount-kind"
            className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1"
          >
            {t('contractDiscounts.fields.type', { defaultValue: 'Type' })}
          </label>
          <CustomSelect
            id="wizard-discount-kind"
            value={kind}
            onValueChange={(selected) => setKind(selected as 'percentage' | 'fixed')}
            options={[
              {
                value: 'percentage',
                label: t('contractDiscounts.types.percentage', { defaultValue: 'Percentage' }),
              },
              {
                value: 'fixed',
                label: t('contractDiscounts.types.fixed', { defaultValue: 'Fixed amount' }),
              },
            ]}
          />
        </div>
        <Input
          id="wizard-discount-value"
          label={
            kind === 'percentage'
              ? t('contractDiscounts.fields.percentValue', { defaultValue: 'Percent (0–100)' })
              : t('contractDiscounts.fields.fixedValue', { defaultValue: 'Amount' })
          }
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={kind === 'percentage' ? '10' : '50.00'}
        />
        <Input
          id="wizard-discount-start-date"
          label={t('contractDiscounts.fields.startDate', { defaultValue: 'Start date' })}
          type="date"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
        />
        <Input
          id="wizard-discount-end-date"
          label={t('contractDiscounts.fields.endDate', { defaultValue: 'End date' })}
          type="date"
          value={endDate}
          onChange={(event) => setEndDate(event.target.value)}
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex gap-2">
        <Button id="add-wizard-discount-button" type="button" onClick={save}>
          {editingKey
            ? t('contractDiscounts.actions.save', { defaultValue: 'Save' })
            : t('contractDiscounts.actions.add', { defaultValue: 'Add Discount' })}
        </Button>
        {editingKey && (
          <Button
            id="cancel-wizard-discount-edit-button"
            type="button"
            variant="outline"
            onClick={resetForm}
          >
            {t('contractDiscounts.actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
        )}
      </div>
    </section>
  );
}

export default ContractDiscountsPanel;
