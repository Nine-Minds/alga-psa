export const INVOICE_TEMPLATE_AST_VERSION = 1 as const;

export type InvoiceTemplateAstVersion = typeof INVOICE_TEMPLATE_AST_VERSION;

export interface InvoiceTemplateAst {
  kind: 'invoice-template-ast';
  version: InvoiceTemplateAstVersion;
  metadata?: InvoiceTemplateAstMetadata;
  styles?: InvoiceTemplateStyleCatalog;
  bindings?: InvoiceTemplateBindingCatalog;
  transforms?: InvoiceTemplateTransformPipeline;
  layout: InvoiceTemplateNode;
}

export interface InvoiceTemplateAstMetadata {
  templateName?: string;
  description?: string;
  locale?: string;
  currencyCode?: string;
}

export type InvoiceTemplateValueFormat = 'text' | 'number' | 'currency' | 'date';

export type InvoiceTemplateNodeType =
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

export interface InvoiceTemplateNodeBase {
  id: string;
  type: InvoiceTemplateNodeType;
  style?: InvoiceTemplateNodeStyleRef;
  children?: InvoiceTemplateNode[];
}

export interface InvoiceTemplateDocumentNode extends InvoiceTemplateNodeBase {
  type: 'document';
  children: InvoiceTemplateNode[];
}

export interface InvoiceTemplateSectionNode extends InvoiceTemplateNodeBase {
  type: 'section';
  title?: string;
  children: InvoiceTemplateNode[];
}

export interface InvoiceTemplateStackNode extends InvoiceTemplateNodeBase {
  type: 'stack';
  direction?: 'row' | 'column';
  children: InvoiceTemplateNode[];
}

export interface InvoiceTemplateTextNode extends InvoiceTemplateNodeBase {
  type: 'text';
  content: InvoiceTemplateValueExpression;
  children?: never;
}

export interface InvoiceTemplateFieldNode extends InvoiceTemplateNodeBase {
  type: 'field';
  binding: InvoiceTemplateBindingRef;
  label?: string;
  emptyValue?: string;
  format?: InvoiceTemplateValueFormat;
  children?: never;
}

export interface InvoiceTemplateImageNode extends InvoiceTemplateNodeBase {
  type: 'image';
  src: InvoiceTemplateValueExpression;
  alt?: InvoiceTemplateValueExpression;
  children?: never;
}

export interface InvoiceTemplateDividerNode extends InvoiceTemplateNodeBase {
  type: 'divider';
  children?: never;
}

export interface InvoiceTemplateTableColumn {
  id: string;
  header?: string;
  value: InvoiceTemplateValueExpression;
  format?: InvoiceTemplateValueFormat;
  style?: InvoiceTemplateNodeStyleRef;
}

export interface InvoiceTemplateTableNode extends InvoiceTemplateNodeBase {
  type: 'table';
  sourceBinding: InvoiceTemplateBindingRef;
  rowBinding: string;
  columns: InvoiceTemplateTableColumn[];
  emptyStateText?: string;
  children?: never;
}

export interface InvoiceTemplateRepeatRegionBinding {
  sourceBinding: InvoiceTemplateBindingRef;
  itemBinding: string;
  keyPath?: string;
}

export interface InvoiceTemplateDynamicTableNode extends InvoiceTemplateNodeBase {
  type: 'dynamic-table';
  repeat: InvoiceTemplateRepeatRegionBinding;
  columns: InvoiceTemplateTableColumn[];
  emptyStateText?: string;
  children?: never;
}

export interface InvoiceTemplateTotalsNode extends InvoiceTemplateNodeBase {
  type: 'totals';
  sourceBinding: InvoiceTemplateBindingRef;
  rows: InvoiceTemplateTotalsRow[];
  children?: never;
}

export interface InvoiceTemplateTotalsRow {
  id: string;
  label: string;
  value: InvoiceTemplateValueExpression;
  format?: InvoiceTemplateValueFormat;
  emphasize?: boolean;
}

export type InvoiceTemplateNode =
  | InvoiceTemplateDocumentNode
  | InvoiceTemplateSectionNode
  | InvoiceTemplateStackNode
  | InvoiceTemplateTextNode
  | InvoiceTemplateFieldNode
  | InvoiceTemplateImageNode
  | InvoiceTemplateDividerNode
  | InvoiceTemplateTableNode
  | InvoiceTemplateDynamicTableNode
  | InvoiceTemplateTotalsNode;

export interface InvoiceTemplateNodeStyleRef {
  tokenIds?: string[];
  inline?: InvoiceTemplateStyleDeclaration;
}

export interface InvoiceTemplateStyleCatalog {
  tokens?: Record<string, InvoiceTemplateStyleToken>;
  classes?: Record<string, InvoiceTemplateStyleDeclaration>;
}

export interface InvoiceTemplateStyleToken {
  id: string;
  value: string | number;
}

export interface InvoiceTemplateStyleDeclaration {
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
}

export interface InvoiceTemplateBindingCatalog {
  values?: Record<string, InvoiceTemplateValueBinding>;
  collections?: Record<string, InvoiceTemplateCollectionBinding>;
}

export interface InvoiceTemplateValueBinding {
  id: string;
  kind: 'value';
  path: string;
  fallback?: unknown;
}

export interface InvoiceTemplateCollectionBinding {
  id: string;
  kind: 'collection';
  path: string;
}

export type InvoiceTemplateBinding = InvoiceTemplateValueBinding | InvoiceTemplateCollectionBinding;

export interface InvoiceTemplateBindingRef {
  bindingId: string;
}

export type InvoiceTemplateValueExpression =
  | { type: 'literal'; value: string | number | boolean | null }
  | { type: 'binding'; bindingId: string }
  | { type: 'path'; path: string }
  | { type: 'template'; template: string; args?: Record<string, InvoiceTemplateValueExpression> };

export interface InvoiceTemplateTransformPipeline {
  sourceBindingId: string;
  outputBindingId: string;
  operations: InvoiceTemplateTransformOperation[];
}

export type InvoiceTemplateTransformOperation =
  | InvoiceTemplateFilterTransform
  | InvoiceTemplateSortTransform
  | InvoiceTemplateGroupTransform
  | InvoiceTemplateAggregateTransform
  | InvoiceTemplateComputedFieldTransform
  | InvoiceTemplateTotalsComposeTransform;

export interface InvoiceTemplateTransformBase {
  id: string;
  strategyId?: string;
}

export interface InvoiceTemplateFilterTransform extends InvoiceTemplateTransformBase {
  type: 'filter';
  predicate: InvoiceTemplatePredicate;
}

export interface InvoiceTemplateSortTransform extends InvoiceTemplateTransformBase {
  type: 'sort';
  keys: InvoiceTemplateSortKey[];
}

export interface InvoiceTemplateSortKey {
  path: string;
  direction?: 'asc' | 'desc';
  nulls?: 'first' | 'last';
}

export interface InvoiceTemplateGroupTransform extends InvoiceTemplateTransformBase {
  type: 'group';
  key: string;
  label?: string;
}

export interface InvoiceTemplateAggregateTransform extends InvoiceTemplateTransformBase {
  type: 'aggregate';
  aggregations: InvoiceTemplateAggregation[];
}

export interface InvoiceTemplateAggregation {
  id: string;
  op: 'sum' | 'count' | 'avg' | 'min' | 'max';
  path?: string;
}

export interface InvoiceTemplateComputedFieldTransform extends InvoiceTemplateTransformBase {
  type: 'computed-field';
  fields: InvoiceTemplateComputedField[];
}

export interface InvoiceTemplateComputedField {
  id: string;
  expression: InvoiceTemplateComputationExpression;
}

export interface InvoiceTemplateTotalsComposeTransform extends InvoiceTemplateTransformBase {
  type: 'totals-compose';
  totals: InvoiceTemplateTotalsEntry[];
}

export interface InvoiceTemplateTotalsEntry {
  id: string;
  label: string;
  value: InvoiceTemplateComputationExpression;
}

export type InvoiceTemplateComputationExpression =
  | { type: 'literal'; value: number }
  | { type: 'path'; path: string }
  | { type: 'aggregate-ref'; aggregateId: string }
  | {
      type: 'binary';
      op: 'add' | 'subtract' | 'multiply' | 'divide';
      left: InvoiceTemplateComputationExpression;
      right: InvoiceTemplateComputationExpression;
    };

export type InvoiceTemplatePredicate =
  | {
      type: 'comparison';
      path: string;
      op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';
      value: string | number | boolean | null | Array<string | number | boolean | null>;
    }
  | {
      type: 'logical';
      op: 'and' | 'or';
      conditions: InvoiceTemplatePredicate[];
    }
  | {
      type: 'not';
      condition: InvoiceTemplatePredicate;
    };
