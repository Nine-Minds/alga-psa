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
  locale?: string;
  currencyCode?: string;
  printSettings?: TemplatePrintSettings;
}

export type TemplateValueFormat = 'text' | 'number' | 'currency' | 'date';

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
  title?: string;
  children: TemplateNode[];
}

export interface TemplateStackNode extends TemplateNodeBase {
  type: 'stack';
  direction?: 'row' | 'column';
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
  label?: string;
  emptyValue?: string;
  format?: TemplateValueFormat;
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
  header?: string;
  value: TemplateValueExpression;
  format?: TemplateValueFormat;
  style?: TemplateNodeStyleRef;
}

export interface TemplateTableNode extends TemplateNodeBase {
  type: 'table';
  sourceBinding: TemplateBindingRef;
  rowBinding: string;
  columns: TemplateTableColumn[];
  emptyStateText?: string;
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
  emptyStateText?: string;
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
  label: string;
  value: TemplateValueExpression;
  format?: TemplateValueFormat;
  emphasize?: boolean;
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
  | { type: 'template'; template: string; args?: Record<string, TemplateValueExpression> };

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
