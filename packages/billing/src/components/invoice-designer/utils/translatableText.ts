import type { DesignerNode } from '../state/designerStore';
import { getNodeMetadata } from './nodeProps';

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
