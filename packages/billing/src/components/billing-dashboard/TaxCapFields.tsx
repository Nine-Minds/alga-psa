'use client';

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Button } from '@alga-psa/ui/components/Button';
import { CurrencyPicker } from '@alga-psa/ui/components/CurrencyPicker';
import { supportedCurrencyCodes, minorUnitsToDecimalText, formatExactCurrencyFromMinorUnits } from '@alga-psa/core';
import { changeTaxCapCurrency, type TaxCapDraft, type TaxCapValue } from './taxCapForm';

export function TaxCapReadout({ rate, compact = false }: { rate: TaxCapValue & { is_composite?: boolean }; compact?: boolean }) {
  const { t, i18n } = useTranslation('msp/service-catalog');
  return <div className="space-y-1">
    <span>{rate.cap_amount == null ? t('taxRates.cap.noCap') : rate.currency_code
      ? formatExactCurrencyFromMinorUnits(rate.cap_amount, rate.currency_code, i18n.language)
      : t('taxRates.cap.legacy', { amount: String(rate.cap_amount) })}</span>
    {rate.is_composite && rate.cap_amount != null && <p className="max-w-sm text-xs text-muted-foreground" title={t('taxRates.cap.composite')}>{t(compact ? 'taxRates.cap.compositeIndicator' : 'taxRates.cap.composite')}</p>}
  </div>;
}

export function TaxCapFields({ draft, onChange, error, composite, disabled }: {
  draft: TaxCapDraft;
  onChange: (draft: TaxCapDraft) => void;
  error?: string | null;
  composite?: boolean;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation('msp/service-catalog');
  const legacy = draft.original.cap_amount != null && !draft.original.currency_code && !draft.touched;
  const currencyOptions = [{ value: 'all', label: t('taxRates.cap.universal') },
    ...supportedCurrencyCodes().map(value => ({ value, label: value }))];
  return <div className="space-y-3">
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div role="group" aria-describedby="tax-rate-cap-error" aria-invalid={Boolean(error && !draft.currency)}>
        <Label htmlFor="tax-rate-currency-field">{t('taxRates.cap.currency')}</Label>
        <CurrencyPicker id="tax-rate-currency-field" value={draft.currency || 'all'} options={currencyOptions}
          disabled={disabled} onValueChange={currency => onChange(changeTaxCapCurrency(draft, currency === 'all' ? '' : currency))} />
      </div>
      <div>
        <Label htmlFor="tax-rate-cap-field">{draft.currency ? t('taxRates.cap.label', { currencyCode: draft.currency }) : t('taxRates.cap.title')} <span className="font-normal text-muted-foreground">{t('taxRates.cap.optional')}</span></Label>
        <Input id="tax-rate-cap-field" type="text" inputMode="decimal" value={draft.text} disabled={disabled || legacy}
          aria-invalid={Boolean(error)} aria-describedby="tax-rate-cap-hint tax-rate-cap-error"
          onChange={event => onChange({ ...draft, text: event.target.value, touched: true, needsReentry: false })} />
      </div>
    </div>
    {draft.currency && <p className="text-sm text-muted-foreground">{t('taxRates.cap.applicability', { currencyCode: draft.currency })}</p>}
    {legacy && <div className="space-y-2 text-sm">
      <TaxCapReadout rate={draft.original} />
      <p className="text-muted-foreground">{t('taxRates.cap.legacyHelp')}</p>
      {draft.currency && <Button id="resolve-tax-rate-cap-button" type="button" variant="outline" disabled={disabled}
        onClick={() => onChange({ ...draft, text: minorUnitsToDecimalText(draft.original.cap_amount!, draft.currency, i18n.language), touched: true, needsReentry: false })}>
        {t('taxRates.cap.resolve', { currencyCode: draft.currency })}: {formatExactCurrencyFromMinorUnits(draft.original.cap_amount!, draft.currency, i18n.language)}
      </Button>}
    </div>}
    <div id="tax-rate-cap-hint" className="space-y-1 text-sm text-muted-foreground">
      {!draft.currency && !legacy && <p>{t('taxRates.cap.errors.currency')}</p>}
      <p>{t('taxRates.cap.hint')}</p>
      {draft.currency && <p>{t('taxRates.cap.example', { amount: minorUnitsToDecimalText(123, draft.currency, i18n.language) })}</p>}
    </div>
    {draft.needsReentry && <p className="text-sm text-muted-foreground">{t('taxRates.cap.reenter')}</p>}
    {composite && <p className="text-sm font-medium">{t('taxRates.cap.composite')}</p>}
    <p id="tax-rate-cap-error" role={error ? 'alert' : undefined} className="text-sm text-destructive">{error}</p>
    <Button id="clear-tax-rate-cap-button" type="button" variant="outline" disabled={disabled}
      onClick={() => onChange({ ...draft, text: '', touched: true, needsReentry: false })}>{t('taxRates.cap.clear')}</Button>
    <details className="text-sm">
      <summary id="tax-rate-cap-scope-toggle" className="cursor-pointer font-medium">{t('taxRates.cap.scopeTitle')}</summary>
      <p className="mt-2 max-w-prose text-muted-foreground">{t('taxRates.cap.scope')}</p>
    </details>
  </div>;
}
