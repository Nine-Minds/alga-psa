import type { TemplateI18nText } from '@alga-psa/types';
import { templateI18nTextToString, type TemplateLabelTranslator } from './i18nText';

/**
 * Wording for the two boolean values when a template supplies no `valueLabels`.
 * Resolved through the `documents` namespace so a German document says "Ja".
 */
const BOOLEAN_LABELS = {
  true: { i18nKey: 'labels.yes', defaultValue: 'Yes' },
  false: { i18nKey: 'labels.no', defaultValue: 'No' },
} as const;

export type FormatTemplateValueParams = {
  value: unknown;
  /** Author wording keyed by `String(value)`; see `TemplateFieldNode.valueLabels`. */
  valueLabels?: Record<string, TemplateI18nText>;
  /** The `documents` label translator. Without one the English defaults apply. */
  t?: TemplateLabelTranslator;
  /**
   * Formats a value that has no label and is not a boolean. The caller owns
   * number, date and currency output (the table and field paths format currency
   * through different entry points), so this layer cannot change it.
   */
  fallback: (value: unknown) => string;
};

const resolveLabel = (label: TemplateI18nText, t?: TemplateLabelTranslator): string =>
  typeof label === 'string' || !t
    ? templateI18nTextToString(label)
    : t(label.i18nKey, { defaultValue: label.defaultValue });

/**
 * The one place a template value becomes display text for the label layer.
 * Precedence: the author's `valueLabels` entry (an empty label prints nothing),
 * then localized Yes/No for a boolean, then the caller's own formatting.
 * Shared by table cells, column lines, child-row cells, totals rows and
 * standalone field nodes so every surface words a value the same way.
 */
export const formatTemplateValue = ({ value, valueLabels, t, fallback }: FormatTemplateValueParams): string => {
  if (value !== null && value !== undefined && valueLabels) {
    const key = String(value);
    if (Object.prototype.hasOwnProperty.call(valueLabels, key)) {
      return resolveLabel(valueLabels[key]!, t);
    }
  }
  if (typeof value === 'boolean') {
    return resolveLabel(BOOLEAN_LABELS[value ? 'true' : 'false'], t);
  }
  return fallback(value);
};
