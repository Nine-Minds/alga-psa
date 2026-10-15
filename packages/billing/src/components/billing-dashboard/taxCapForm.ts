import { decimalTextToMinorUnits, minorUnitsToDecimalText, MoneyInputError, isSupportedCurrency } from '@alga-psa/core';

export interface TaxCapValue {
  cap_amount?: number | string | null;
  currency_code?: string | null;
}

export interface TaxCapDraft {
  text: string;
  currency: string;
  original: TaxCapValue;
  touched: boolean;
  needsReentry: boolean;
}

export function createTaxCapDraft(rate: TaxCapValue, locale: string): TaxCapDraft {
  return {
    original: rate,
    currency: rate.currency_code ?? '',
    text: rate.cap_amount != null && rate.currency_code
      ? minorUnitsToDecimalText(rate.cap_amount, rate.currency_code, locale) : '',
    touched: false,
    needsReentry: false,
  };
}

export function changeTaxCapCurrency(draft: TaxCapDraft, currency: string): TaxCapDraft {
  return { ...draft, currency, needsReentry: draft.needsReentry || (currency !== draft.currency && draft.text.trim() !== '') };
}

/** Serialize only meaningful changes; a legacy unresolved cap is never mistaken for blank. */
export function taxCapPayload(draft: TaxCapDraft, locale: string, editing: boolean): { cap_amount?: number | null; currency_code?: string | null } {
  if (draft.needsReentry) throw new Error('reenter');
  const oldCurrency = draft.original.currency_code ?? '';
  const legacy = draft.original.cap_amount != null && !oldCurrency;
  if (legacy && !draft.touched) {
    if (draft.currency !== oldCurrency) throw new MoneyInputError('currency');
    return {};
  }
  if (draft.currency && !isSupportedCurrency(draft.currency)) throw new MoneyInputError('currency');
  const cap = decimalTextToMinorUnits(draft.text, draft.currency, locale);
  const oldCap = draft.original.cap_amount == null ? null : Number(draft.original.cap_amount);
  const payload: { cap_amount?: number | null; currency_code?: string | null } = {};
  if (!editing || cap !== oldCap) payload.cap_amount = cap;
  if (!editing || draft.currency !== oldCurrency) payload.currency_code = draft.currency || null;
  return payload;
}
