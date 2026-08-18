import type { TemplatePrintSettings } from './invoice-print-settings';

export const TEMPLATE_AST_VERSION = 1 as const;

export type TemplateAstVersion = typeof TEMPLATE_AST_VERSION;

export interface TemplateAst {
  kind: 'invoice-template-ast';
  version: TemplateAstVersion;
  metadata?: TemplateAstMetadata;
  styles?: TemplateStyleCatalog;
  bindings?: TemplateBindingCatalog;
  transforms?: TemplateTransformPipeline;
  layout: TemplateNode;
}

export interface TemplateAstMetadata {
  templateName?: string;
  description?: string;
  /**
   * Authoring-time default locale, used for preview and when no recipient
   * locale can be resolved. The recipient's locale wins at render time for
   * both labels and number/date/currency formatting, so the two never diverge.
   */
  locale?: string;
  currencyCode?: string;
  printSettings?: TemplatePrintSettings;
}

/**
 * A translatable display string. A plain string is a literal, used exactly as
 * written; a key reference is resolved against the recipient's locale at render
 * time. Literals pass through untouched, which is what keeps every template
 * authored before this existed rendering byte-identically.
 */
export interface TemplateI18nRef {
  i18nKey: string;
  defaultValue: string;
}

export type TemplateI18nText = string | TemplateI18nRef;

export type TemplateValueFormat = 'text' | 'number' | 'currency' | 'date';
export type TemplateFieldDisplayFormat = 'single-line' | 'multiline' | 'raw';
export type TemplateFieldBorderStyle = 'underline' | 'box' | 'none';

export type TemplateNodeType =
  | 'document'
  | 'section'
  | 'stack'
  | 'text'
  | 'field'
  | 'image'
  | 'divider'
  | 'table'
  | 'dynamic-table'
  | 'totals';

export interface TemplateNodeBase {
  id: string;
  type: TemplateNodeType;
  style?: TemplateNodeStyleRef;
  children?: TemplateNode[];
}

export interface TemplateDocumentNode extends TemplateNodeBase {
  type: 'document';
  children: TemplateNode[];
}

export interface TemplateSectionNode extends TemplateNodeBase {
  type: 'section';
  title?: TemplateI18nText;
  children: TemplateNode[];
}

export interface TemplateStackNode extends TemplateNodeBase {
  type: 'stack';
  direction?: 'row' | 'column';
  /**
   * Optional repeat-region binding. When present, the stack renders its
   * `children` once per item in the resolved source collection. The current
   * item is pushed onto the render scope under `itemBinding` (same semantics
   * as `dynamic-table.repeat.itemBinding`) so nested `path` expressions and
   * inner `dynamic-table` nodes can resolve against the per-iteration item.
   * Without `repeat`, the stack renders its children exactly once using the
   * outer scope — backward compatible.
   */
  repeat?: TemplateRepeatRegionBinding;
  children: TemplateNode[];
}

export interface TemplateTextNode extends TemplateNodeBase {
  type: 'text';
  content: TemplateValueExpression;
  children?: never;
}

export interface TemplateFieldNode extends TemplateNodeBase {
  type: 'field';
  binding: TemplateBindingRef;
  label?: TemplateI18nText;
  labelStyle?: TemplateNodeStyleRef;
  emptyValue?: string;
  placeholder?: string;
  format?: TemplateValueFormat;
  displayFormat?: TemplateFieldDisplayFormat;
  borderStyle?: TemplateFieldBorderStyle;
  children?: never;
}

export interface TemplateImageNode extends TemplateNodeBase {
  type: 'image';
  src: TemplateValueExpression;
  alt?: TemplateValueExpression;
  children?: never;
}

export interface TemplateDividerNode extends TemplateNodeBase {
  type: 'divider';
  children?: never;
}

export interface TemplateTableColumn {
  id: string;
  header?: TemplateI18nText;
  value: TemplateValueExpression;
  format?: TemplateValueFormat;
  style?: TemplateNodeStyleRef;
}

export interface TemplateTableNode extends TemplateNodeBase {
  type: 'table';
  sourceBinding: TemplateBindingRef;
  rowBinding: string;
  columns: TemplateTableColumn[];
  headerStyle?: TemplateNodeStyleRef;
  emptyStateText?: TemplateI18nText;
  children?: never;
}

export interface TemplateRepeatRegionBinding {
  sourceBinding: TemplateBindingRef;
  itemBinding: string;
  keyPath?: string;
}

export interface TemplateDynamicTableNode extends TemplateNodeBase {
  type: 'dynamic-table';
  repeat: TemplateRepeatRegionBinding;
  columns: TemplateTableColumn[];
  headerStyle?: TemplateNodeStyleRef;
  emptyStateText?: TemplateI18nText;
  children?: never;
}

export interface TemplateTotalsNode extends TemplateNodeBase {
  type: 'totals';
  sourceBinding: TemplateBindingRef;
  rows: TemplateTotalsRow[];
  children?: never;
}

export interface TemplateTotalsRow {
  id: string;
  label: TemplateI18nText;
  labelStyle?: TemplateNodeStyleRef;
  value: TemplateValueExpression;
  format?: TemplateValueFormat;
  emphasize?: boolean;
  style?: TemplateNodeStyleRef;
}

export type TemplateNode =
  | TemplateDocumentNode
  | TemplateSectionNode
  | TemplateStackNode
  | TemplateTextNode
  | TemplateFieldNode
  | TemplateImageNode
  | TemplateDividerNode
  | TemplateTableNode
  | TemplateDynamicTableNode
  | TemplateTotalsNode;

export interface TemplateNodeStyleRef {
  tokenIds?: string[];
  inline?: TemplateStyleDeclaration;
}

export interface TemplateStyleCatalog {
  tokens?: Record<string, TemplateStyleToken>;
  classes?: Record<string, TemplateStyleDeclaration>;
}

export interface TemplateStyleToken {
  id: string;
  value: string | number;
}

export interface TemplateStyleDeclaration {
  display?: string;
  width?: string;
  height?: string;
  minWidth?: string;
  minHeight?: string;
  maxWidth?: string;
  maxHeight?: string;
  padding?: string;
  margin?: string;
  border?: string;
  borderRadius?: string;
  gap?: string;
  justifyContent?: string;
  alignItems?: string;
  color?: string;
  backgroundColor?: string;
  fontSize?: string;
  fontWeight?: string | number;
  fontFamily?: string;
  lineHeight?: string | number;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  flex?: string;
  // Longhand flex has been part of the runtime contract since the AST cutover:
  // the designer export emits it and the zod styleDeclarationSchema accepts it.
  flexGrow?: string | number;
  flexShrink?: string | number;
  flexBasis?: string;
  aspectRatio?: string;
  objectFit?: string;
  objectPosition?: string;
  borderColor?: string;
  fontStyle?: string;
}

export interface TemplateBindingCatalog {
  values?: Record<string, TemplateValueBinding>;
  collections?: Record<string, TemplateCollectionBinding>;
}

export interface TemplateValueBinding {
  id: string;
  kind: 'value';
  path: string;
  fallback?: unknown;
}

export interface TemplateCollectionBinding {
  id: string;
  kind: 'collection';
  path: string;
}

export type TemplateBinding = TemplateValueBinding | TemplateCollectionBinding;

export interface TemplateBindingRef {
  bindingId: string;
}

export type TemplateValueExpression =
  | { type: 'literal'; value: string | number | boolean | null }
  | { type: 'binding'; bindingId: string }
  | { type: 'path'; path: string }
  | { type: 'template'; template: string; args?: Record<string, TemplateValueExpression> }
  // Standing headings authored as text nodes ("Bill To", "From",
  // "Terms & Conditions"). Resolved against the recipient's locale; falls back
  // to `defaultValue` when the key is missing.
  | { type: 'i18n'; i18nKey: string; defaultValue: string };

export interface TemplateTransformPipeline {
  sourceBindingId: string;
  outputBindingId: string;
  operations: TemplateTransformOperation[];
}

export type TemplateTransformOperation =
  | TemplateFilterTransform
  | TemplateSortTransform
  | TemplateGroupTransform
  | TemplateAggregateTransform
  | TemplateComputedFieldTransform
  | TemplateTotalsComposeTransform;

export interface TemplateTransformBase {
  id: string;
  strategyId?: string;
}

export interface TemplateFilterTransform extends TemplateTransformBase {
  type: 'filter';
  predicate: TemplatePredicate;
}

export interface TemplateSortTransform extends TemplateTransformBase {
  type: 'sort';
  keys: TemplateSortKey[];
}

export interface TemplateSortKey {
  path: string;
  direction?: 'asc' | 'desc';
  nulls?: 'first' | 'last';
}

export interface TemplateGroupTransform extends TemplateTransformBase {
  type: 'group';
  key: string;
  label?: string;
}

export interface TemplateAggregateTransform extends TemplateTransformBase {
  type: 'aggregate';
  aggregations: TemplateAggregation[];
}

export interface TemplateAggregation {
  id: string;
  op: 'sum' | 'count' | 'avg' | 'min' | 'max';
  path?: string;
}

export interface TemplateComputedFieldTransform extends TemplateTransformBase {
  type: 'computed-field';
  fields: TemplateComputedField[];
}

export interface TemplateComputedField {
  id: string;
  expression: TemplateComputationExpression;
}

export interface TemplateTotalsComposeTransform extends TemplateTransformBase {
  type: 'totals-compose';
  totals: TemplateTotalsEntry[];
}

export interface TemplateTotalsEntry {
  id: string;
  label: string;
  value: TemplateComputationExpression;
}

export type TemplateComputationExpression =
  | { type: 'literal'; value: number }
  | { type: 'path'; path: string }
  | { type: 'aggregate-ref'; aggregateId: string }
  | {
      type: 'binary';
      op: 'add' | 'subtract' | 'multiply' | 'divide';
      left: TemplateComputationExpression;
      right: TemplateComputationExpression;
    };

export type TemplatePredicate =
  | {
      type: 'comparison';
      path: string;
      op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';
      value: string | number | boolean | null | Array<string | number | boolean | null>;
    }
  | {
      type: 'logical';
      op: 'and' | 'or';
      conditions: TemplatePredicate[];
    }
  | {
      type: 'not';
      condition: TemplatePredicate;
    };
