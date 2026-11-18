type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface TemplatePickerCurrencyInfo {
  contract_name: string;
  currency_code?: string;
  price_set_currencies?: string[];
  incomplete_set_currencies?: string[];
}

/**
 * True when the template can't supply a complete set of amounts in the client's
 * currency (neither its base currency nor a complete price set). The template
 * stays selectable: its structure still clones and the amounts are entered.
 */
export function templateNeedsRates(
  template: TemplatePickerCurrencyInfo,
  clientId: string | undefined,
  contractCurrency: string | undefined,
): boolean {
  const base = template.currency_code;
  if (!base || !clientId || !contractCurrency || base === contractCurrency) return false;
  const hasSet = (template.price_set_currencies ?? []).includes(contractCurrency);
  const incomplete = (template.incomplete_set_currencies ?? []).includes(contractCurrency);
  return !hasSet || incomplete;
}

/** "Template name · USD · EUR" (base first), plus "· Needs EUR rates" on a mismatch. */
export function templatePickerLabel(
  t: Translate,
  template: TemplatePickerCurrencyInfo,
  clientId: string | undefined,
  contractCurrency: string | undefined,
): string {
  const currencies = template.currency_code
    ? [template.currency_code, ...(template.price_set_currencies ?? []).filter((c) => c !== template.currency_code)]
    : [];
  const badges = currencies.length > 0 ? ` · ${currencies.join(' · ')}` : '';
  const hint = templateNeedsRates(template, clientId, contractCurrency)
    ? ` · ${t('wizard.templatePicker.needsRates', {
        defaultValue: 'Needs {{currency}} rates',
        currency: contractCurrency,
      })}`
    : '';
  return `${template.contract_name}${badges}${hint}`;
}
