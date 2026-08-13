import type {
  TemplateAst,
  TemplateI18nRef,
  TemplateI18nText,
  TemplateNode,
  TemplateTableColumn,
  TemplateTotalsRow,
  TemplateValueExpression,
} from '@alga-psa/types';

/** Namespace holding the standard document chrome (labels, headers, totals rows). */
export const DOCUMENT_LABEL_NAMESPACE = 'documents';

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

const resolveText = (value: TemplateI18nRef, t: TemplateLabelTranslator): string =>
  t(value.i18nKey, { defaultValue: value.defaultValue });

const resolveExpression = (
  expression: TemplateValueExpression,
  t: TemplateLabelTranslator
): TemplateValueExpression => {
  if (expression.type === 'i18n') {
    return { type: 'literal', value: t(expression.i18nKey, { defaultValue: expression.defaultValue }) };
  }
  return expression;
};

const resolveColumns = (
  columns: TemplateTableColumn[],
  t: TemplateLabelTranslator
): TemplateTableColumn[] =>
  columns.map((column) =>
    isTemplateI18nRef(column.header) ? { ...column, header: resolveText(column.header, t) } : column
  );

const resolveTotalsRows = (
  rows: TemplateTotalsRow[],
  t: TemplateLabelTranslator
): TemplateTotalsRow[] =>
  rows.map((row) =>
    isTemplateI18nRef(row.label) ? { ...row, label: resolveText(row.label, t) } : row
  );

const resolveNode = (node: TemplateNode, t: TemplateLabelTranslator): TemplateNode => {
  switch (node.type) {
    case 'document':
    case 'stack':
      return { ...node, children: node.children.map((child) => resolveNode(child, t)) };
    case 'section':
      return {
        ...node,
        ...(isTemplateI18nRef(node.title) ? { title: resolveText(node.title, t) } : {}),
        children: node.children.map((child) => resolveNode(child, t)),
      };
    case 'text':
      return node.content.type === 'i18n'
        ? { ...node, content: resolveExpression(node.content, t) }
        : node;
    case 'field':
      return isTemplateI18nRef(node.label) ? { ...node, label: resolveText(node.label, t) } : node;
    case 'image':
      return node.alt?.type === 'i18n' ? { ...node, alt: resolveExpression(node.alt, t) } : node;
    case 'table':
    case 'dynamic-table':
      return {
        ...node,
        columns: resolveColumns(node.columns, t),
        ...(isTemplateI18nRef(node.emptyStateText)
          ? { emptyStateText: resolveText(node.emptyStateText, t) }
          : {}),
      };
    case 'totals':
      return { ...node, rows: resolveTotalsRows(node.rows, t) };
    default:
      return node;
  }
};

/**
 * Replace every `{ i18nKey, defaultValue }` display string in `ast` with its
 * translation, leaving literals exactly as authored.
 *
 * Only display fields are walked — section titles, field labels, table column
 * headers, empty-state text, totals row labels and `i18n` text expressions.
 * Node ids, binding ids, transform ids, column ids and paths are machine
 * identifiers and are never touched: translating one would silently corrupt a
 * rendered document while passing every gate.
 */
export const resolveTemplateAstI18n = (
  ast: TemplateAst,
  t: TemplateLabelTranslator
): TemplateAst => ({ ...ast, layout: resolveNode(ast.layout, t) });
