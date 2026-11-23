import type { TemplateI18nRef, TemplateI18nText } from '@alga-psa/types';

/**
 * Pure helpers for template display text. Kept apart from `i18nLabels.ts`,
 * which reaches the server-only i18n loader: modules that ship in the designer's
 * browser bundle (field formatting, value wording) import from here so that
 * loader never enters a client bundle.
 */

export type TemplateLabelTranslator = (
  key: string,
  options: { defaultValue: string }
) => string;

export const isTemplateI18nRef = (value: unknown): value is TemplateI18nRef =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as TemplateI18nRef).i18nKey === 'string' &&
  typeof (value as TemplateI18nRef).defaultValue === 'string';

/**
 * The literal a key reference falls back to when nothing resolves it. Used by
 * the renderer so an unresolved key never leaks into a customer's document.
 */
export const templateI18nTextToString = (value: TemplateI18nText): string =>
  typeof value === 'string' ? value : value.defaultValue;
