import type { TemplateI18nText } from '@alga-psa/types';

export type ValueLabelSuggestion = { key: string; label: TemplateI18nText };

const BOOLEAN_SUGGESTIONS: ValueLabelSuggestion[] = [
  { key: 'true', label: { i18nKey: 'labels.yes', defaultValue: 'Yes' } },
  { key: 'false', label: { i18nKey: 'labels.no', defaultValue: 'No' } },
];

const FREQUENCY_SUGGESTIONS: ValueLabelSuggestion[] = [
  { key: 'weekly', label: { i18nKey: 'labels.cadence.weekly', defaultValue: 'Weekly' } },
  { key: 'monthly', label: { i18nKey: 'labels.cadence.monthly', defaultValue: 'Monthly' } },
  { key: 'quarterly', label: { i18nKey: 'labels.cadence.quarterly', defaultValue: 'Quarterly' } },
  { key: 'semi-annually', label: { i18nKey: 'labels.cadence.semiAnnually', defaultValue: 'Semi-annually' } },
  { key: 'annually', label: { i18nKey: 'labels.cadence.annually', defaultValue: 'Annually' } },
];

/**
 * Known values worth pre-offering for a bound field, with their translated
 * standard wording. Only a convenience: any value can still be typed by hand.
 */
export const suggestValueLabels = (bindingKey: string | undefined): ValueLabelSuggestion[] => {
  const field = (bindingKey ?? '').trim().split('.').pop() ?? '';
  if (field === 'billing_frequency') return FREQUENCY_SUGGESTIONS;
  if (/^(is|has)_/.test(field)) return BOOLEAN_SUGGESTIONS;
  return [];
};
