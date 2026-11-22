import type { TemplateAst } from '@alga-psa/types';
import { decodeTemplatePathExpression } from './templateInterpolationFilters';

/** Component fields that carry money. Everything else on a component is a quantity or a label. */
export const BUNDLE_COMPONENT_PRICE_FIELDS = ['unitPrice', 'total'] as const;

const PRICE_FIELD_SET = new Set<string>(BUNDLE_COMPONENT_PRICE_FIELDS);

const stripBindingPrefix = (path: string, itemBinding: string | null): string => {
  if (itemBinding && path.startsWith(`${itemBinding}.`)) return path.slice(itemBinding.length + 1);
  return path;
};

const pathBindsPrice = (rawPath: string, itemBinding: string | null): boolean => {
  const { path } = decodeTemplatePathExpression(rawPath);
  if (itemBinding) {
    const relative = stripBindingPrefix(path, itemBinding);
    if (PRICE_FIELD_SET.has(relative.split('.')[0])) return true;
  }
  // Direct reference through the item: `item.components.0.total`, `components.unitPrice`.
  return /(^|\.)components\.(\d+\.)?(unitPrice|total)(\.|$)/.test(path);
};

const templateBindsPrice = (template: string, itemBinding: string | null): boolean => {
  const re = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(template)) !== null) {
    if (pathBindsPrice(match[1], itemBinding)) return true;
  }
  return false;
};

const walk = (value: unknown, itemBinding: string | null): boolean => {
  if (Array.isArray(value)) return value.some((entry) => walk(entry, itemBinding));
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;

  if (record.type === 'path' && typeof record.path === 'string' && pathBindsPrice(record.path, itemBinding)) {
    return true;
  }
  if (record.type === 'template' && typeof record.template === 'string' && templateBindsPrice(record.template, itemBinding)) {
    return true;
  }

  return Object.entries(record).some(([key, child]) => {
    if (key === 'childRows' && typeof child === 'object' && child !== null) {
      const binding = (child as Record<string, unknown>).itemBinding;
      return walk(child, typeof binding === 'string' ? binding : itemBinding);
    }
    return walk(child, itemBinding);
  });
};

/**
 * Whether the AST renders a bundle component's money fields (`unitPrice` or
 * `total`). Client-visible data carries component prices only when this is
 * true for the template that will render the document; hiding prices only in
 * the layout would leave them in the serialized view model.
 */
export const templateUsesComponentPricing = (ast: TemplateAst | null | undefined): boolean =>
  ast ? walk(ast.layout, null) || walk(ast.bindings, null) : false;

const hasChildRows = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(hasChildRows);
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.type === 'dynamic-table' && typeof record.childRows === 'object' && record.childRows !== null) return true;
  return Object.values(record).some(hasChildRows);
};

/** Whether any table in the AST renders bundle component rows. */
export const templateHasComponentRows = (ast: TemplateAst | null | undefined): boolean =>
  ast ? hasChildRows(ast.layout) : false;

export interface BundleLoadDecision {
  includeBundlePresentation: boolean;
  includeBundleComponentAmounts: boolean;
}

/**
 * The single price-leak gate for what a viewer's invoice data may carry.
 * MSP users always get everything; for clients the resolved template decides,
 * and an unknown template (null) fails closed: no component data at all.
 */
export const decideBundleLoad = (
  viewer: 'msp' | 'client',
  ast: TemplateAst | null | undefined,
): BundleLoadDecision => {
  if (viewer === 'msp') return { includeBundlePresentation: true, includeBundleComponentAmounts: true };
  return {
    includeBundlePresentation: ast ? templateHasComponentRows(ast) : false,
    includeBundleComponentAmounts: ast ? templateUsesComponentPricing(ast) : false,
  };
};
