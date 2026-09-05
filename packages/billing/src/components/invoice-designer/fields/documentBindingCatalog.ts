/* eslint-disable custom-rules/no-feature-to-feature-imports -- Designer field picker builds its options with the shared expression-authoring path builder */
import type { TemplateAst } from '@alga-psa/types';
import type {
  ExpressionMode,
  SharedExpressionContextRoot,
  SharedExpressionPathOption,
  SharedExpressionSchemaNode,
} from '@alga-psa/workflows/expression-authoring';
import { buildInvoiceExpressionPathOptions } from '@alga-psa/workflows/expression-authoring';

import { buildInvoiceTemplateBindings } from '../../../lib/invoice-template-ast/standardTemplates';
import { QUOTE_TEMPLATE_VALUE_BINDINGS } from '../../../lib/quote-template-ast/bindings';
import { SALES_ORDER_TEMPLATE_VALUE_BINDINGS } from '../../../lib/sales-order-template-ast/bindings';
import type { DesignerDocumentKind } from '../utils/documentKind';
import {
  getTemplateFieldDefinition,
  humanizeBindingToken,
  type InvoiceFieldCategory,
} from './fieldCatalog';

/**
 * The field picker is generated from each document type's binding catalog, so the menu can only
 * offer fields the render model actually has. `path` is the display path the designer stores as
 * `metadata.bindingKey`; `renderPath` is what the exported AST binds against.
 */
export type DocumentBindingField = {
  path: string;
  renderPath: string;
  bindingId?: string;
  valueType: 'string' | 'number' | 'boolean';
  description: string;
};

type CatalogValueBindings = NonNullable<NonNullable<TemplateAst['bindings']>['values']>;

type DocumentItemField = {
  name: string;
  valueType: 'string' | 'number' | 'boolean';
  description: string;
};

const ROOT_METADATA: Record<string, { label: string; description: string }> = {
  invoice: { label: 'Invoice', description: 'Invoice-level fields' },
  quote: { label: 'Quote', description: 'Quote-level fields' },
  quoteTotals: { label: 'Quote Totals', description: 'Recurring, one-time, service, and product totals.' },
  salesOrder: { label: 'Sales Order', description: 'Sales order-level fields' },
  client: { label: 'Client', description: 'Client fields' },
  contact: { label: 'Contact', description: 'Contact fields' },
  customer: { label: 'Customer', description: 'Customer fields' },
  tenant: { label: 'Tenant', description: 'Tenant fields' },
  item: { label: 'Line Item', description: 'Line item fields for repeating/table contexts' },
};

// The issuer party is `tenantClient` on the invoice and sales-order models and `tenant` on the
// quote model. The picker speaks one language — `tenant.*` — and the render path stays per-model.
const DISPLAY_ROOT_BY_RENDER_ROOT: Record<string, string> = {
  tenantClient: 'tenant',
};

const QUOTE_TOTALS_BINDING_ID = /^(recurring|onetime|service|product)(Subtotal|Tax|Total)$/;

// Logo bindings drive image sources, not text fields, so they stay out of the field picker.
const IMAGE_BINDING_ID = /logo/i;

const NUMERIC_RENDER_PATH = /(^|[._])(subtotal|tax|total|amount|version|quantity|price|rate|count)([._]|$)/i;

const ITEM_FIELDS: Record<DesignerDocumentKind, DocumentItemField[]> = {
  invoice: [
    { name: 'description', valueType: 'string', description: 'Line item description.' },
    { name: 'quantity', valueType: 'number', description: 'Line item quantity.' },
    { name: 'unitPrice', valueType: 'number', description: 'Line item unit price.' },
    { name: 'total', valueType: 'number', description: 'Line item total.' },
    {
      name: 'servicePeriodStart',
      valueType: 'string',
      description: 'Line item recurring service period start date when available.',
    },
    {
      name: 'servicePeriodEnd',
      valueType: 'string',
      description: 'Line item recurring service period end date when available.',
    },
    { name: 'billingTiming', valueType: 'string', description: 'Line item billing timing when available.' },
  ],
  quote: [
    { name: 'description', valueType: 'string', description: 'Quote line item description.' },
    { name: 'quantity', valueType: 'number', description: 'Quote line item quantity.' },
    { name: 'unit_price', valueType: 'number', description: 'Quote line item unit price.' },
    { name: 'total_price', valueType: 'number', description: 'Quote line item total.' },
    { name: 'tax_amount', valueType: 'number', description: 'Quote line item tax amount.' },
    { name: 'net_amount', valueType: 'number', description: 'Quote line item total including tax.' },
    { name: 'billing_frequency', valueType: 'string', description: 'Recurring billing frequency.' },
    { name: 'is_recurring', valueType: 'boolean', description: 'Whether the line item is recurring.' },
  ],
  'sales-order': [
    { name: 'description', valueType: 'string', description: 'Line description (product name).' },
    { name: 'service_name', valueType: 'string', description: 'Product / service name.' },
    { name: 'service_sku', valueType: 'string', description: 'Product SKU.' },
    { name: 'quantity_ordered', valueType: 'number', description: 'Quantity ordered.' },
    { name: 'quantity_fulfilled', valueType: 'number', description: 'Quantity fulfilled so far.' },
    { name: 'unit_price', valueType: 'number', description: 'Unit price.' },
    { name: 'amount', valueType: 'number', description: 'Line amount (qty × unit price).' },
  ],
};

const resolveValueType = (renderPath: string): DocumentBindingField['valueType'] =>
  NUMERIC_RENDER_PATH.test(renderPath) ? 'number' : 'string';

const toDisplayPath = (
  binding: { id: string; path: string },
  spec: { scalarRoot: string; totalsRoot?: string; leafOverrides?: Record<string, string> }
): string => {
  if (binding.path.includes('.')) {
    const [renderRoot, ...rest] = binding.path.split('.');
    return [DISPLAY_ROOT_BY_RENDER_ROOT[renderRoot] ?? renderRoot, ...rest].join('.');
  }
  const root =
    spec.totalsRoot && QUOTE_TOTALS_BINDING_ID.test(binding.id) ? spec.totalsRoot : spec.scalarRoot;
  return `${root}.${spec.leafOverrides?.[binding.id] ?? binding.id}`;
};

const buildCatalogFields = (
  values: CatalogValueBindings,
  spec: { scalarRoot: string; totalsRoot?: string; leafOverrides?: Record<string, string> }
): DocumentBindingField[] =>
  Object.values(values)
    .filter((binding) => !IMAGE_BINDING_ID.test(binding.id))
    .map((binding) => ({
      path: toDisplayPath(binding, spec),
      renderPath: binding.path,
      bindingId: binding.id,
      valueType: resolveValueType(binding.path),
      description: `Data path: ${binding.path}`,
    }));

const buildDocumentBindingFields = (documentKind: DesignerDocumentKind): DocumentBindingField[] => {
  if (documentKind === 'quote') {
    return buildCatalogFields(QUOTE_TEMPLATE_VALUE_BINDINGS, {
      scalarRoot: 'quote',
      totalsRoot: 'quoteTotals',
    });
  }
  if (documentKind === 'sales-order') {
    return buildCatalogFields(SALES_ORDER_TEMPLATE_VALUE_BINDINGS, { scalarRoot: 'salesOrder' });
  }
  return [
    ...buildCatalogFields(buildInvoiceTemplateBindings().values ?? {}, {
      scalarRoot: 'invoice',
      // `invoice.number` is the path shipped templates and the field catalog already use.
      leafOverrides: { invoiceNumber: 'number' },
    }),
    // On every invoice render model, but with no built-in binding to generate from.
    {
      path: 'invoice.currencyCode',
      renderPath: 'currencyCode',
      valueType: 'string',
      description: 'Data path: currencyCode',
    },
  ];
};

type DocumentCatalog = {
  fields: DocumentBindingField[];
  renderPathByDisplayPath: Map<string, string>;
  displayPathByRenderPath: Map<string, string>;
  tokenPaths: Set<string>;
  contextRoots: SharedExpressionContextRoot[];
};

const buildContextRoots = (
  documentKind: DesignerDocumentKind,
  fields: DocumentBindingField[]
): SharedExpressionContextRoot[] => {
  const schemaByRoot = new Map<string, SharedExpressionSchemaNode>();

  const propertyFor = (root: string, segments: string[]): Record<string, SharedExpressionSchemaNode> => {
    let schema = schemaByRoot.get(root);
    if (!schema) {
      schema = { type: 'object', properties: {} };
      schemaByRoot.set(root, schema);
    }
    let properties = schema.properties as Record<string, SharedExpressionSchemaNode>;
    for (const segment of segments) {
      const next = properties[segment] ?? { type: 'object', properties: {} };
      properties[segment] = next;
      next.properties = next.properties ?? {};
      properties = next.properties;
    }
    return properties;
  };

  for (const field of fields) {
    const [root, ...rest] = field.path.split('.');
    const leaf = rest.pop();
    if (!root || !leaf) continue;
    propertyFor(root, rest)[leaf] = { type: field.valueType, description: field.description };
  }

  for (const itemField of ITEM_FIELDS[documentKind]) {
    propertyFor('item', [])[itemField.name] = {
      type: itemField.valueType,
      description: itemField.description,
    };
  }

  return Array.from(schemaByRoot.entries()).map(([root, schema]) => ({
    key: root,
    label: ROOT_METADATA[root]?.label ?? root,
    description: ROOT_METADATA[root]?.description,
    schema,
    allowInModes: ['path-only', 'template'],
  }));
};

const buildDocumentCatalog = (documentKind: DesignerDocumentKind): DocumentCatalog => {
  const fields = buildDocumentBindingFields(documentKind);
  const renderPathByDisplayPath = new Map<string, string>();
  const displayPathByRenderPath = new Map<string, string>();
  const tokenPaths = new Set<string>();

  for (const field of fields) {
    if (!renderPathByDisplayPath.has(field.path)) {
      renderPathByDisplayPath.set(field.path, field.renderPath);
    }
    if (!displayPathByRenderPath.has(field.renderPath)) {
      displayPathByRenderPath.set(field.renderPath, field.path);
    }
    if (!field.renderPath.includes('.')) {
      tokenPaths.add(field.renderPath);
    }
  }

  return {
    fields,
    renderPathByDisplayPath,
    displayPathByRenderPath,
    tokenPaths,
    contextRoots: buildContextRoots(documentKind, fields),
  };
};

const catalogCache = new Map<DesignerDocumentKind, DocumentCatalog>();

const getDocumentCatalog = (documentKind: DesignerDocumentKind): DocumentCatalog => {
  const cached = catalogCache.get(documentKind);
  if (cached) {
    return cached;
  }
  const catalog = buildDocumentCatalog(documentKind);
  catalogCache.set(documentKind, catalog);
  return catalog;
};

export const getDocumentBindingFields = (documentKind: DesignerDocumentKind): DocumentBindingField[] =>
  getDocumentCatalog(documentKind).fields;

export const getDocumentItemFields = (documentKind: DesignerDocumentKind): DocumentItemField[] =>
  ITEM_FIELDS[documentKind];

/** Picker display path -> render-model path. */
export const resolveDocumentRenderPath = (
  documentKind: DesignerDocumentKind,
  displayPath: string
): string | undefined => getDocumentCatalog(documentKind).renderPathByDisplayPath.get(displayPath);

/** Render-model path -> picker display path. */
export const resolveDocumentDisplayPath = (
  documentKind: DesignerDocumentKind,
  renderPath: string
): string | undefined => getDocumentCatalog(documentKind).displayPathByRenderPath.get(renderPath);

/** Single-segment text-block tokens this document type recognises, e.g. `{{quote_number}}`. */
export const getDocumentTokenPaths = (documentKind: DesignerDocumentKind): ReadonlySet<string> =>
  getDocumentCatalog(documentKind).tokenPaths;

export const buildDocumentExpressionContextRoots = (
  documentKind: DesignerDocumentKind
): SharedExpressionContextRoot[] => getDocumentCatalog(documentKind).contextRoots;

export const buildDocumentExpressionPathOptions = (params: {
  mode?: ExpressionMode;
  includeRootPaths?: boolean;
  documentKind: DesignerDocumentKind;
}): SharedExpressionPathOption[] =>
  buildInvoiceExpressionPathOptions({
    mode: params.mode,
    includeRootPaths: params.includeRootPaths,
    contextRoots: buildDocumentExpressionContextRoots(params.documentKind),
  });

const DOCUMENT_KINDS: DesignerDocumentKind[] = ['invoice', 'quote', 'sales-order'];

/**
 * Every render path a binding key could mean, across document types. The editor canvas resolves a
 * binding key against whichever sample model it was handed, so it tries each and takes the first
 * that exists — `tenant.name` is `tenantClient.name` on an invoice and `tenant.name` on a quote.
 */
export const resolveCandidateRenderPaths = (bindingKey: string): string[] => {
  const key = bindingKey.trim();
  if (key.length === 0) {
    return [];
  }
  const candidates = new Set<string>();
  for (const documentKind of DOCUMENT_KINDS) {
    const renderPath = resolveDocumentRenderPath(documentKind, key);
    if (renderPath) {
      candidates.add(renderPath);
    }
  }
  return Array.from(candidates);
};

const FIELD_CATEGORY_BY_ROOT: Record<string, InvoiceFieldCategory> = {
  invoice: 'Invoice',
  customer: 'Customer',
  quote: 'Quote',
  quoteTotals: 'Quote Totals',
  salesOrder: 'Sales Order',
  client: 'Client',
  contact: 'Contact',
  tenant: 'Tenant',
  item: 'Line Item',
};

// The picker already groups options under the category heading, so document-root fields do not
// repeat it ("Quote Number", never "Quote Quote Number"). Party and line-item fields keep the
// prefix, because "Name" or "Address" on its own is ambiguous.
const UNPREFIXED_CATEGORIES: ReadonlySet<InvoiceFieldCategory> = new Set<InvoiceFieldCategory>([
  'Invoice',
  'Quote',
  'Sales Order',
]);

const toTitleCase = (value: string): string =>
  value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

const applyCategoryPrefix = (category: InvoiceFieldCategory, fieldLabel: string): string => {
  if (UNPREFIXED_CATEGORIES.has(category)) {
    return fieldLabel;
  }
  const prefix = category === 'Line Item' ? 'Item' : category;
  return fieldLabel.toLowerCase().startsWith(`${prefix.toLowerCase()} `)
    ? fieldLabel
    : `${prefix} ${fieldLabel}`;
};

export type DocumentFieldOptionDescription = {
  category: InvoiceFieldCategory;
  label: string;
  description: string;
};

/** Curated field-catalog labels first, generated labels second — the Fields panel's label layer. */
export const describeBindingOption = (
  option: SharedExpressionPathOption
): DocumentFieldOptionDescription | null => {
  const curated = getTemplateFieldDefinition(option.path);
  if (curated) {
    return { category: curated.category, label: curated.label, description: curated.description };
  }

  const category = FIELD_CATEGORY_BY_ROOT[option.root];
  if (!category) {
    return null;
  }
  const segments = option.path.split('.');
  if (segments.length < 2 || !option.isLeaf) {
    return null;
  }
  const fieldName = segments[segments.length - 1]?.replace(/\[\]/g, '') ?? option.path;
  return {
    category,
    label: applyCategoryPrefix(category, toTitleCase(fieldName)),
    description: option.description ?? option.path,
  };
};

let labelCache: Map<string, string> | null = null;

const generatedLabelByPath = (): Map<string, string> => {
  if (labelCache) {
    return labelCache;
  }
  labelCache = new Map<string, string>();
  for (const documentKind of DOCUMENT_KINDS) {
    for (const field of getDocumentBindingFields(documentKind)) {
      if (labelCache.has(field.path)) continue;
      const category = FIELD_CATEGORY_BY_ROOT[field.path.split('.')[0] ?? ''];
      if (!category) continue;
      const leaf = field.path.split('.').slice(-1)[0] ?? field.path;
      labelCache.set(field.path, applyCategoryPrefix(category, toTitleCase(leaf)));
    }
  }
  return labelCache;
};

/** True when the binding key is one the field picker offers for some document type. */
export const isDocumentFieldPath = (bindingKey: string): boolean => {
  const normalized = bindingKey.trim();
  return normalized.length > 0 &&
    (Boolean(getTemplateFieldDefinition(normalized)) || generatedLabelByPath().has(normalized));
};

/** Human label for a stored binding key, e.g. `quote.quoteNumber` -> "Quote Number". */
export const resolveDocumentFieldLabel = (bindingKey: string): string => {
  const normalized = bindingKey.trim();
  if (!normalized) {
    return 'Unbound';
  }
  return (
    getTemplateFieldDefinition(normalized)?.label ??
    generatedLabelByPath().get(normalized) ??
    humanizeBindingToken(normalized)
  );
};
