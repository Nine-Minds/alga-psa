'use client';

import React from 'react';
import { CurrencyInput } from '@alga-psa/ui/components/CurrencyInput';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { CURRENCY_OPTIONS, currencyFractionDigits, getCurrencySymbol, toMinorUnits } from '@alga-psa/core';

/** Major-unit amounts as typed by the user; undefined means "left blank". */
export interface OpportunityValueAmounts {
  mrr?: number;
  nrr?: number;
  hardware?: number;
}

export interface OpportunityValueCents {
  mrr_cents: number;
  nrr_cents: number;
  hardware_cents: number;
}

export function amountsToCents(amounts: OpportunityValueAmounts, currencyCode: string): OpportunityValueCents {
  const convert = (value?: number) => (value == null || Number.isNaN(value) ? 0 : toMinorUnits(value, undefined, currencyCode));
  return {
    mrr_cents: convert(amounts.mrr),
    nrr_cents: convert(amounts.nrr),
    hardware_cents: convert(amounts.hardware),
  };
}

export function centsToAmounts(cents: OpportunityValueCents, currencyCode: string): OpportunityValueAmounts {
  const factor = Math.pow(10, currencyFractionDigits(currencyCode));
  return {
    mrr: cents.mrr_cents / factor,
    nrr: cents.nrr_cents / factor,
    hardware: cents.hardware_cents / factor,
  };
}

/**
 * The single money-entry surface for an opportunity: the currency the deal is
 * quoted in plus the three value lines. Create and Edit both render this so the
 * labels, the fraction digits and the cents conversion can never drift apart —
 * and so the currency is always visible rather than silently inherited.
 */
export function OpportunityValueFields({
  idPrefix,
  currencyCode,
  onCurrencyChange,
  amounts,
  onAmountsChange,
  disabled = false,
  columns = 1,
}: {
  idPrefix: string;
  currencyCode: string;
  /** Omit to render the currency as read-only text (values locked by a quote). */
  onCurrencyChange?: (currencyCode: string) => void;
  amounts: OpportunityValueAmounts;
  onAmountsChange: (amounts: OpportunityValueAmounts) => void;
  disabled?: boolean;
  columns?: 1 | 3;
}) {
  const { t } = useTranslation('msp/opportunities');
  const symbol = getCurrencySymbol(currencyCode);
  const withSymbol = (label: string) => `${label} (${symbol} ${currencyCode})`;
  const set = (patch: OpportunityValueAmounts) => onAmountsChange({ ...amounts, ...patch });

  return (
    <div className="space-y-3">
      {onCurrencyChange ? (
        <CustomSelect
          id={`${idPrefix}-currency`}
          label={t('opportunities.valuesDialog.currency', 'Currency')}
          options={CURRENCY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
          value={currencyCode}
          onValueChange={onCurrencyChange}
          disabled={disabled}
        />
      ) : (
        <p id={`${idPrefix}-currency`} className="text-[13px] text-[rgb(var(--color-text-500))]">
          {t('opportunities.valuesDialog.currencyFixed', 'Currency: {{code}}', { code: currencyCode })}
        </p>
      )}
      <div className={columns === 3 ? 'grid grid-cols-1 gap-3 sm:grid-cols-3' : 'space-y-3'}>
        <CurrencyInput
          id={`${idPrefix}-mrr`}
          label={withSymbol(t('opportunities.valuesDialog.mrr', 'Recurring (monthly)'))}
          currencyCode={currencyCode}
          value={amounts.mrr}
          onChange={(value) => set({ mrr: value })}
          disabled={disabled}
        />
        <CurrencyInput
          id={`${idPrefix}-nrr`}
          label={withSymbol(t('opportunities.valuesDialog.nrr', 'One-time services'))}
          currencyCode={currencyCode}
          value={amounts.nrr}
          onChange={(value) => set({ nrr: value })}
          disabled={disabled}
        />
        <CurrencyInput
          id={`${idPrefix}-hardware`}
          label={withSymbol(t('opportunities.valuesDialog.hardware', 'Hardware'))}
          currencyCode={currencyCode}
          value={amounts.hardware}
          onChange={(value) => set({ hardware: value })}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
