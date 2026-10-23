import type { DesignerNode } from '../state/designerStore';
import { getNodeMetadata } from './nodeProps';
import { findStandardDocumentLabelByText } from '../../../lib/invoice-template-ast/standardDocumentLabels';

/**
 * Mirrors ast/workspaceAst.ts: a translatable value round-trips as display
 * text plus a private `__ast*I18n` ref, and export keeps the ref only while
 * the text still equals the ref's authored default. These checks answer, for
 * the canvas, "will this string be re-rendered in the recipient's language?"
 * — the moment an author types their own text the answer flips to no, and the
 * marker disappears with it.
 */

export type TranslatableRef = { i18nKey: string; defaultValue: string };

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const asTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export const isTranslatableRef = (value: unknown): value is TranslatableRef => {
  const record = asRecord(value);
  return typeof record.i18nKey === 'string' && typeof record.defaultValue === 'string';
};

export const isTranslatableValue = (text: unknown, ref: unknown): boolean =>
  isTranslatableRef(ref) && asTrimmedString(text) === ref.defaultValue.trim();

/** Field and totals-row labels: `metadata.label` backed by `__astLabelI18n`. */
export const isNodeLabelTranslatable = (node: DesignerNode): boolean => {
  const metadata = asRecord(getNodeMetadata(node));
  return isTranslatableValue(metadata.label, metadata.__astLabelI18n);
};

/**
 * Text nodes: the imported i18n expression is preserved in
 * `metadata.astContentExpression` with its resolved text mirrored in
 * `__astContentPreviewText`; export keeps the expression only while the
 * visible text matches that mirror.
 */
export const isNodeTextTranslatable = (node: DesignerNode): boolean => {
  const metadata = asRecord(getNodeMetadata(node));
  if (asRecord(metadata.astContentExpression).type !== 'i18n') {
    return false;
  }
  const previewText = asTrimmedString(metadata.__astContentPreviewText);
  if (previewText.length === 0) {
    return false;
  }
  const text =
    asTrimmedString(metadata.text) || asTrimmedString(metadata.label) || asTrimmedString(metadata.content);
  return text === previewText;
};

/** Table columns: `header` backed by `__astHeaderI18n` on the column entry. */
export const isColumnHeaderTranslatable = (column: Record<string, unknown>): boolean =>
  isTranslatableValue(column.header, column.__astHeaderI18n);

/**
 * Metadata that makes a text node render a standard label in the recipient's
 * language: the i18n expression, its English text as the visible value, and the
 * mirror export compares against (see isNodeTextTranslatable).
 */
export const createTextTranslationMetadata = (ref: TranslatableRef): Record<string, unknown> => ({
  text: ref.defaultValue,
  astContentExpression: { type: 'i18n', i18nKey: ref.i18nKey, defaultValue: ref.defaultValue },
  __astContentPreviewText: ref.defaultValue,
});

/** Field and totals-row labels: the label text plus the ref export keeps while they match. */
export const createLabelTranslationMetadata = (ref: TranslatableRef): Record<string, unknown> => ({
  label: ref.defaultValue,
  __astLabelI18n: { i18nKey: ref.i18nKey, defaultValue: ref.defaultValue },
});

/** The ref behind a translatable text node, or null once its text was customized. */
export const getNodeTextTranslation = (node: DesignerNode): TranslatableRef | null => {
  if (!isNodeTextTranslatable(node)) return null;
  const expression = asRecord(asRecord(getNodeMetadata(node)).astContentExpression);
  return isTranslatableRef(expression) ? { i18nKey: expression.i18nKey, defaultValue: expression.defaultValue } : null;
};

/** The ref behind a translatable field / totals-row label, or null once customized. */
export const getNodeLabelTranslation = (node: DesignerNode): TranslatableRef | null => {
  const metadata = asRecord(getNodeMetadata(node));
  return isTranslatableValue(metadata.label, metadata.__astLabelI18n) ? (metadata.__astLabelI18n as TranslatableRef) : null;
};

/**
 * Typing a standard label's exact text links it, so "INVOICE" renders as
 * "RECHNUNG" for a German recipient without a separate step. The visible
 * "translated" state says so, and "Use fixed text" opts the value out for good
 * by setting this flag beside it.
 */
export const TRANSLATION_OPT_OUT_KEY = '__translationOptOut';

export const resolveAutoTranslation = (text: string, optedOut: unknown): TranslatableRef | undefined =>
  optedOut === true ? undefined : findStandardDocumentLabelByText(text);
