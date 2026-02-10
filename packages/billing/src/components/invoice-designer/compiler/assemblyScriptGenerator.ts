import type { InvoiceDesignerCompilerIr, InvoiceDesignerIrTreeNode } from './guiIr';
import { resolveLabelText } from '../labelText';

export type InvoiceDesignerSourceMapEntry = {
  nodeId: string;
  symbol: string;
  startLine: number;
  endLine: number;
};

export type GenerateAssemblyScriptResult = {
  source: string;
  sourceHash: string;
  sourceMap: InvoiceDesignerSourceMapEntry[];
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const asTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const escapeSourceString = (value: string): string =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');

const makeNodeSymbol = (nodeId: string) => `createNode_${nodeId.replace(/[^A-Za-z0-9_]/g, '_')}`;
const INVOICE_BORDER_SUBTLE = '1px solid #e2e8f0';
const INVOICE_BORDER_LIGHT = '1px solid #cbd5e1';
const INVOICE_BORDER_STRONG = '1px solid #94a3b8';

type SectionBorderStyle = 'none' | 'light' | 'strong';
type FieldBorderStyle = 'none' | 'underline' | 'box';
type FontWeightStyle = 'normal' | 'medium' | 'semibold' | 'bold';
type TableBorderPreset = 'custom' | 'list' | 'boxed' | 'grid' | 'none';
type TableBorderConfig = {
  outer: boolean;
  rowDividers: boolean;
  columnDividers: boolean;
};
type SectionBorderCss = {
  border: string;
  borderRadius: string;
};

const createDeterministicSourceHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const isGenericScaffoldLiteral = (value: string): boolean => {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
  return (
    normalized.length === 0 ||
    normalized === 'label' ||
    normalized === 'field label' ||
    normalized === 'text' ||
    normalized === 'terms text' ||
    normalized === 'term text' ||
    normalized === 'custom total' ||
    /^custom[-_ ]?total([ -_].*)?$/.test(normalized) ||
    /^text \d+$/.test(normalized) ||
    /^text[-_]\d+$/.test(normalized) ||
    /^label \d+$/.test(normalized) ||
    /^label[-_]\d+$/.test(normalized)
  );
};

const pickRenderableLiteral = (...candidates: string[]): string => {
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!isGenericScaffoldLiteral(trimmed)) {
      return trimmed;
    }
  }
  return '';
};

const normalizeScaffoldLabelLiteral = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return '';
  }

  const normalized = trimmed.toLowerCase().replace(/\s+/g, ' ');
  if (normalized === 'invoice number label') {
    return 'Invoice #';
  }
  if (normalized === 'from label') {
    return 'From';
  }
  if (normalized === 'bill to label') {
    return 'Bill To';
  }
  if (normalized === 'notes label') {
    return 'Notes';
  }

  const suffixMatch = trimmed.match(/^(.+)\s+label$/i);
  if (suffixMatch) {
    return suffixMatch[1].trim();
  }
  return trimmed;
};

const normalizeTotalBindingKey = (node: InvoiceDesignerIrTreeNode, value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  if (node.type === 'custom-total' && trimmed === 'invoice.custom') {
    return '';
  }
  return trimmed;
};

const resolveNodeText = (node: InvoiceDesignerIrTreeNode): { content: string; variant: string | null } => {
  const metadata = asRecord(node.metadata);

  if (node.type === 'text') {
    const text = pickRenderableLiteral(asTrimmedString(metadata.text), node.name);
    const variant = asTrimmedString(metadata.variant) || null;
    return { content: text, variant };
  }

  if (node.type === 'field') {
    return {
      content: node.name,
      variant: null,
    };
  }

  if (node.type === 'label') {
    const labelContent = normalizeScaffoldLabelLiteral(
      resolveLabelText(node, { shouldSkip: isGenericScaffoldLiteral }).text
    );
    return {
      content: labelContent,
      variant: 'label',
    };
  }

  if (node.type === 'subtotal' || node.type === 'tax' || node.type === 'discount' || node.type === 'custom-total') {
    const label = pickRenderableLiteral(
      asTrimmedString(metadata.label),
      node.name,
      resolveTotalLabelFallback(node)
    );
    const bindingKey = normalizeTotalBindingKey(node, asTrimmedString(metadata.bindingKey));
    return {
      content: bindingKey ? `${label}: {{${bindingKey}}}` : label,
      variant: null,
    };
  }

  if (node.type === 'signature') {
    const signer = pickRenderableLiteral(asTrimmedString(metadata.signerLabel));
    return {
      content: signer ? `Signature: ${signer}` : 'Signature',
      variant: null,
    };
  }

  if (node.type === 'action-button') {
    const label = pickRenderableLiteral(asTrimmedString(metadata.label));
    return {
      content: label ? `Button: ${label}` : 'Button',
      variant: null,
    };
  }

  if (node.type === 'attachment-list') {
    const title = pickRenderableLiteral(asTrimmedString(metadata.title));
    return {
      content: title ? `Attachments: ${title}` : 'Attachments',
      variant: null,
    };
  }

  if (node.type === 'divider') {
    return {
      content: '----------------',
      variant: null,
    };
  }

  if (node.type === 'spacer') {
    return {
      content: '',
      variant: null,
    };
  }

  return {
    content: node.name,
    variant: null,
  };
};

const normalizeBindingHint = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

const resolveImplicitBindingKeyFromHint = (hint: string): string => {
  const normalized = normalizeBindingHint(hint);
  if (normalized.length === 0) {
    return '';
  }

  if (normalized.includes('invoice number') || normalized === 'invoice #' || normalized === 'invoice no') {
    return 'invoice.number';
  }
  if (normalized.includes('from address') || normalized.includes('sender address') || normalized.includes('vendor address')) {
    return 'tenant.address';
  }
  if (
    normalized.includes('client address') ||
    normalized.includes('customer address') ||
    normalized.includes('bill to')
  ) {
    return 'customer.address';
  }
  if (normalized.includes('invoice date') || normalized.includes('issue date')) {
    return 'invoice.issueDate';
  }
  if (normalized.includes('due date')) {
    return 'invoice.dueDate';
  }
  if (
    normalized.includes('po number') ||
    normalized.includes('purchase order') ||
    normalized.includes('po #')
  ) {
    return 'invoice.poNumber';
  }
  if (normalized === 'subtotal') {
    return 'invoice.subtotal';
  }
  if (normalized === 'tax') {
    return 'invoice.tax';
  }
  if (normalized === 'total' || normalized === 'amount due' || normalized === 'grand total') {
    return 'invoice.total';
  }
  return '';
};

const resolveImplicitBindingKeyForNode = (node: InvoiceDesignerIrTreeNode): string => {
  const metadata = asRecord(node.metadata);
  const label = asTrimmedString(metadata.label);
  const text = asTrimmedString(metadata.text);
  return (
    resolveImplicitBindingKeyFromHint(label) ||
    resolveImplicitBindingKeyFromHint(text) ||
    resolveImplicitBindingKeyFromHint(node.name)
  );
};

const resolveFieldBindingKey = (node: InvoiceDesignerIrTreeNode): string =>
  asTrimmedString(asRecord(node.metadata).bindingKey) ||
  asTrimmedString(asRecord(node.metadata).binding) ||
  asTrimmedString(asRecord(node.metadata).path) ||
  resolveImplicitBindingKeyForNode(node);

const resolveFieldFormat = (node: InvoiceDesignerIrTreeNode, fallback: 'text' | 'currency' = 'text'): string => {
  const format = asTrimmedString(asRecord(node.metadata).format).toLowerCase();
  if (format === 'currency' || format === 'number' || format === 'date') {
    return format;
  }
  return fallback;
};

const resolveSectionBorderStyle = (metadata: Record<string, unknown>): SectionBorderStyle => {
  const candidate = asTrimmedString(metadata.sectionBorderStyle ?? metadata.sectionBorder).toLowerCase();
  if (candidate === 'none' || candidate === 'strong') {
    return candidate;
  }
  return 'light';
};

const resolveSectionBorderCss = (metadata: Record<string, unknown>): SectionBorderCss => {
  const style = resolveSectionBorderStyle(metadata);
  if (style === 'none') {
    return { border: '0px', borderRadius: '0px' };
  }
  if (style === 'strong') {
    return { border: INVOICE_BORDER_STRONG, borderRadius: '6px' };
  }
  return { border: INVOICE_BORDER_LIGHT, borderRadius: '4px' };
};

const resolveFieldBorderStyle = (metadata: Record<string, unknown>): FieldBorderStyle => {
  const candidate = asTrimmedString(metadata.fieldBorderStyle).toLowerCase();
  if (candidate === 'none' || candidate === 'underline') {
    return candidate;
  }
  return 'underline';
};

const resolveFontWeightStyle = (
  value: unknown,
  fallback: FontWeightStyle = 'normal'
): FontWeightStyle => {
  const candidate = asTrimmedString(value).toLowerCase();
  if (candidate === 'normal' || candidate === 'medium' || candidate === 'semibold' || candidate === 'bold') {
    return candidate;
  }
  return fallback;
};

const resolveFontWeightCssValue = (
  value: unknown,
  fallback: FontWeightStyle = 'normal'
): string => {
  const weight = resolveFontWeightStyle(value, fallback);
  if (weight === 'normal') {
    return 'normal';
  }
  if (weight === 'medium') {
    return '500';
  }
  if (weight === 'semibold') {
    return '600';
  }
  return 'bold';
};

const resolveTableBorderPreset = (metadata: Record<string, unknown>): TableBorderPreset => {
  const candidate = asTrimmedString(metadata.tableBorderPreset).toLowerCase();
  if (candidate === 'list' || candidate === 'boxed' || candidate === 'grid' || candidate === 'none') {
    return candidate;
  }
  return 'custom';
};

const resolveTableBorderConfig = (metadata: Record<string, unknown>): TableBorderConfig => {
  const preset = resolveTableBorderPreset(metadata);
  if (preset === 'list') {
    return { outer: false, rowDividers: true, columnDividers: false };
  }
  if (preset === 'boxed') {
    return { outer: true, rowDividers: true, columnDividers: false };
  }
  if (preset === 'grid') {
    return { outer: true, rowDividers: true, columnDividers: true };
  }
  if (preset === 'none') {
    return { outer: false, rowDividers: false, columnDividers: false };
  }

  return {
    outer: metadata.tableOuterBorder !== false,
    rowDividers: metadata.tableRowDividers !== false,
    columnDividers: metadata.tableColumnDividers === true,
  };
};

const TABLE_COLUMN_WIDTH_FALLBACKS = [220, 60, 100, 120];

const resolveTableColumnPixelWidth = (column: Record<string, unknown>, index: number): number => {
  const configuredWidth = Number(column.width);
  if (Number.isFinite(configuredWidth) && configuredWidth > 0) {
    return configuredWidth;
  }
  return TABLE_COLUMN_WIDTH_FALLBACKS[index] ?? 120;
};

const formatPercentage = (value: number): string =>
  `${(Math.round(value * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '')}%`;

const resolveTableColumnBasisPercentages = (columns: Array<Record<string, unknown>>): string[] => {
  if (columns.length === 0) {
    return [];
  }

  const widths = columns.map((column, index) => resolveTableColumnPixelWidth(column, index));
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  if (!Number.isFinite(totalWidth) || totalWidth <= 0) {
    const equalShare = formatPercentage(100 / columns.length);
    return columns.map(() => equalShare);
  }
  return widths.map((width) => formatPercentage((width / totalWidth) * 100));
};

const resolveTotalBindingFallback = (node: InvoiceDesignerIrTreeNode): string => {
  if (node.type === 'subtotal') return 'invoice.subtotal';
  if (node.type === 'tax') return 'invoice.tax';
  if (node.type === 'discount') return 'invoice.discount';
  if (node.type === 'custom-total') return 'invoice.total';
  return 'invoice.total';
};

const resolveTotalLabelFallback = (node: InvoiceDesignerIrTreeNode): string => {
  if (node.type === 'subtotal') return 'Subtotal';
  if (node.type === 'tax') return 'Tax';
  if (node.type === 'discount') return 'Discount';
  if (node.type === 'custom-total') return 'Total';
  return node.name;
};

const resolveRenderableTotalLabel = (node: InvoiceDesignerIrTreeNode): string =>
  (() => {
    const configuredLabel = asTrimmedString(asRecord(node.metadata).label);
    if (node.type === 'custom-total' && isGenericScaffoldLiteral(configuredLabel)) {
      return '';
    }
    return pickRenderableLiteral(configuredLabel, resolveTotalLabelFallback(node));
  })();

const resolveRenderableTotalBindingKey = (node: InvoiceDesignerIrTreeNode): string =>
  normalizeTotalBindingKey(node, asTrimmedString(asRecord(node.metadata).bindingKey)) ||
  resolveTotalBindingFallback(node);

const resolveNormalizedMarginLeft = (
  node: InvoiceDesignerIrTreeNode,
  nodesById: Map<string, InvoiceDesignerIrTreeNode>
): number => {
  const rawX = Math.round(node.position.x);
  if (!node.parentId) {
    return rawX;
  }

  const parent = nodesById.get(node.parentId);
  if (!parent || parent.layout?.mode !== 'flex') {
    return rawX;
  }
  return 0;
};

const resolveNormalizedMarginTop = (
  node: InvoiceDesignerIrTreeNode,
  nodesById: Map<string, InvoiceDesignerIrTreeNode>
): number => {
  const rawY = Math.round(node.position.y);
  if (!node.parentId) {
    return rawY;
  }

  const parent = nodesById.get(node.parentId);
  if (!parent || parent.layout?.mode !== 'flex') {
    return rawY;
  }
  return 0;
};

const resolveLayoutStyleArgs = (
  node: InvoiceDesignerIrTreeNode,
  nodesById: Map<string, InvoiceDesignerIrTreeNode>
) => ({
  width: Math.max(1, Math.round(node.size.width)),
  height: Math.max(1, Math.round(node.size.height)),
  x: resolveNormalizedMarginLeft(node, nodesById),
  y: resolveNormalizedMarginTop(node, nodesById),
  gap: Math.max(0, Math.round(node.layout?.gap ?? 0)),
  padding: Math.max(0, Math.round(node.layout?.padding ?? 0)),
  align: node.layout?.align ?? 'start',
  justify: node.layout?.justify ?? 'start',
  mode: node.layout?.mode ?? 'canvas',
  direction: node.layout?.direction ?? 'column',
  sizing: node.type === 'page' ? 'fixed' : node.layout?.sizing ?? 'fixed',
});

const emitLayoutStyleCall = (
  node: InvoiceDesignerIrTreeNode,
  lines: string[],
  nodesById: Map<string, InvoiceDesignerIrTreeNode>
) => {
  const args = resolveLayoutStyleArgs(node, nodesById);
  lines.push(`  // layout-mode:${args.mode}; sizing:${args.sizing}`);
  lines.push(
    `  applyGeneratedLayoutStyle(node, ${args.width}, ${args.height}, ${args.x}, ${args.y}, ${args.gap}, ${args.padding}, "${args.align}", "${args.justify}", "${args.mode}", "${args.direction}", "${args.sizing}");`
  );
};

const emitLayoutHelpers = (lines: string[]) => {
  lines.push(
    'function applyGeneratedLayoutStyle(node: LayoutElement, width: i32, height: i32, x: i32, y: i32, gap: i32, padding: i32, align: string, justify: string, mode: string, direction: string, sizing: string): void {'
  );
  lines.push('  const style = new ElementStyle();');
  lines.push('  style.width = width.toString() + "px";');
  lines.push('  style.marginLeft = x.toString() + "px";');
  lines.push('  style.marginTop = y.toString() + "px";');
  lines.push('  if (mode == "flex") {');
  lines.push('    style.display = "flex";');
  lines.push('    style.flexDirection = direction == "row" ? "row" : "column";');
  lines.push('    if (align == "center") {');
  lines.push('      style.alignItems = "center";');
  lines.push('    } else if (align == "end") {');
  lines.push('      style.alignItems = "flex-end";');
  lines.push('    } else if (align == "stretch") {');
  lines.push('      style.alignItems = "stretch";');
  lines.push('    } else {');
  lines.push('      style.alignItems = "flex-start";');
  lines.push('    }');
  lines.push('    if (justify == "center") {');
  lines.push('      style.justifyContent = "center";');
  lines.push('    } else if (justify == "end") {');
  lines.push('      style.justifyContent = "flex-end";');
  lines.push('    } else if (justify == "space-between") {');
  lines.push('      style.justifyContent = "space-between";');
  lines.push('    } else {');
  lines.push('      style.justifyContent = "flex-start";');
  lines.push('    }');
  lines.push('    if (gap > 0) {');
  lines.push('      style.gap = gap.toString() + "px";');
  lines.push('    }');
  lines.push('  } else if (gap > 0) {');
  lines.push('    style.marginBottom = gap.toString() + "px";');
  lines.push('  }');
  lines.push('  if (padding > 0) {');
  lines.push('    const px = padding.toString() + "px";');
  lines.push('    style.paddingTop = px;');
  lines.push('    style.paddingRight = px;');
  lines.push('    style.paddingBottom = px;');
  lines.push('    style.paddingLeft = px;');
  lines.push('  }');
  lines.push('  if (align == "center") {');
  lines.push('    style.textAlign = "center";');
  lines.push('  }');
  lines.push('  if (align == "end") {');
  lines.push('    style.textAlign = "right";');
  lines.push('  }');
  lines.push('  if (!(mode == "flex" && sizing == "hug")) {');
  lines.push('    style.height = height.toString() + "px";');
  lines.push('  }');
  lines.push('  node.style = style;');
  lines.push('}');
  lines.push('');
};

const emitStyleHelpers = (lines: string[]) => {
  lines.push('function ensureElementStyle(node: LayoutElement): ElementStyle {');
  lines.push('  if (node.style == null) {');
  lines.push('    node.style = new ElementStyle();');
  lines.push('  }');
  lines.push('  return node.style as ElementStyle;');
  lines.push('}');
  lines.push('');
};

const emitBindingHelpers = (lines: string[]) => {
  lines.push('function formatCurrencyMinorUnits(value: f64, currencyCode: string): string {');
  lines.push('  const major = value / 100.0;');
  lines.push('  return currencyCode + " " + major.toString();');
  lines.push('}');
  lines.push('');
  lines.push('function formatBindingValueNumeric(value: f64, format: string, currencyCode: string): string {');
  lines.push('  if (format == "currency") {');
  lines.push('    return formatCurrencyMinorUnits(value, currencyCode);');
  lines.push('  }');
  lines.push('  return value.toString();');
  lines.push('}');
  lines.push('');
  lines.push('function resolveInvoiceBinding(viewModel: InvoiceViewModel, key: string, format: string): string {');
  lines.push('  if (key == "invoice.number" || key == "invoice.invoiceNumber") return viewModel.invoiceNumber;');
  lines.push('  if (key == "invoice.issueDate") return viewModel.issueDate;');
  lines.push('  if (key == "invoice.dueDate") return viewModel.dueDate;');
  lines.push('  if (key == "invoice.poNumber") return viewModel.poNumber != null ? viewModel.poNumber! : "";');
  lines.push('  if (key == "invoice.currencyCode") return viewModel.currencyCode;');
  lines.push('  if (key == "invoice.subtotal") return formatBindingValueNumeric(viewModel.subtotal, format, viewModel.currencyCode);');
  lines.push('  if (key == "invoice.tax") return formatBindingValueNumeric(viewModel.tax, format, viewModel.currencyCode);');
  lines.push('  if (key == "invoice.total") return formatBindingValueNumeric(viewModel.total, format, viewModel.currencyCode);');
  lines.push('  if (key == "invoice.discount") {');
  lines.push('    const discount = viewModel.subtotal + viewModel.tax - viewModel.total;');
  lines.push('    return formatBindingValueNumeric(discount > 0.0 ? discount : 0.0, format, viewModel.currencyCode);');
  lines.push('  }');
  lines.push('  if (key == "customer.name") return viewModel.customer != null ? viewModel.customer!.name : "";');
  lines.push('  if (key == "customer.address") return viewModel.customer != null ? viewModel.customer!.address : "";');
  lines.push('  if (key == "tenant.name") return viewModel.tenantClient != null && viewModel.tenantClient!.name != null ? viewModel.tenantClient!.name! : "";');
  lines.push('  if (key == "tenant.address") return viewModel.tenantClient != null && viewModel.tenantClient!.address != null ? viewModel.tenantClient!.address! : "";');
  lines.push('  return "";');
  lines.push('}');
  lines.push('');
  lines.push('function resolveItemBinding(viewModel: InvoiceViewModel, item: InvoiceItem, key: string, format: string): string {');
  lines.push('  if (key == "item.id") return item.id;');
  lines.push('  if (key == "item.description") return item.description;');
  lines.push('  if (key == "item.quantity") return formatBindingValueNumeric(item.quantity, format, viewModel.currencyCode);');
  lines.push('  if (key == "item.rate") return formatBindingValueNumeric(item.unitPrice, format, viewModel.currencyCode);');
  lines.push('  if (key == "item.unitPrice") return formatBindingValueNumeric(item.unitPrice, format, viewModel.currencyCode);');
  lines.push('  if (key == "item.total") return formatBindingValueNumeric(item.total, format, viewModel.currencyCode);');
  lines.push('  if (key == "item.category") return item.category != null ? item.category! : "";');
  lines.push('  return resolveInvoiceBinding(viewModel, key, format);');
  lines.push('}');
  lines.push('');
};

const emitNodeFactory = (
  node: InvoiceDesignerIrTreeNode,
  lines: string[],
  sourceMap: InvoiceDesignerSourceMapEntry[],
  nodesById: Map<string, InvoiceDesignerIrTreeNode>
) => {
  const symbol = makeNodeSymbol(node.id);
  const startLine = lines.length + 1;

  lines.push(`function ${symbol}(viewModel: InvoiceViewModel): LayoutElement {`);

  if (node.type === 'document' || node.type === 'page' || node.type === 'section' || node.type === 'container') {
    lines.push('  const children = new Array<LayoutElement>();');
    node.children.forEach((childNode) => {
      lines.push(`  children.push(${makeNodeSymbol(childNode.id)}(viewModel));`);
    });
    if (node.type === 'document') {
      lines.push('  const node = new DocumentElement(children);');
    } else {
      lines.push('  const node = new SectionElement(children);');
    }
    emitLayoutStyleCall(node, lines, nodesById);
    if (node.type === 'section') {
      const sectionBorder = resolveSectionBorderCss(asRecord(node.metadata));
      lines.push('  const nodeStyle = ensureElementStyle(node);');
      lines.push(`  nodeStyle.border = "${escapeSourceString(sectionBorder.border)}";`);
      lines.push(`  nodeStyle.borderRadius = "${escapeSourceString(sectionBorder.borderRadius)}";`);
    }
    lines.push(`  node.id = "${escapeSourceString(node.id)}";`);
    lines.push('  return node;');
    lines.push('}');
    const endLine = lines.length;
    sourceMap.push({ nodeId: node.id, symbol, startLine, endLine });
    return;
  }

  if (node.type === 'column') {
    lines.push('  const children = new Array<LayoutElement>();');
    node.children.forEach((childNode) => {
      lines.push(`  children.push(${makeNodeSymbol(childNode.id)}(viewModel));`);
    });
    lines.push('  const node = new ColumnElement(children);');
    const span = Number(asRecord(node.metadata).span);
    lines.push(`  node.span = ${Number.isFinite(span) && span > 0 ? Math.floor(span) : 1};`);
    emitLayoutStyleCall(node, lines, nodesById);
    lines.push(`  node.id = "${escapeSourceString(node.id)}";`);
    lines.push('  return node;');
    lines.push('}');
    const endLine = lines.length;
    sourceMap.push({ nodeId: node.id, symbol, startLine, endLine });
    return;
  }

  if (node.type === 'table' || node.type === 'dynamic-table' || node.type === 'totals') {
    lines.push('  const children = new Array<LayoutElement>();');
    const metadata = asRecord(node.metadata);
    const tableBorderConfig = resolveTableBorderConfig(metadata);
    const tableHeaderFontWeight = resolveFontWeightCssValue(metadata.tableHeaderFontWeight, 'semibold');
    if (node.type === 'table' || node.type === 'dynamic-table') {
      const columns = Array.isArray(metadata.columns) ? (metadata.columns as Array<Record<string, unknown>>) : [];
      const resolvedColumns =
        columns.length > 0
          ? columns
          : [
              { header: 'Description', key: 'item.description', type: 'text' },
              { header: 'Qty', key: 'item.quantity', type: 'number' },
              { header: 'Rate', key: 'item.unitPrice', type: 'currency' },
              { header: 'Amount', key: 'item.total', type: 'currency' },
            ];
      const visibleColumns = resolvedColumns.slice(0, 4);
      const columnBasisPercentages = resolveTableColumnBasisPercentages(visibleColumns);
      lines.push('  const headerCells = new Array<LayoutElement>();');
      visibleColumns.forEach((column, columnIndex) => {
        const header = asTrimmedString(column.header) || asTrimmedString(column.key) || 'Column';
        const cellVar = `headerCell${columnIndex}`;
        const textVar = `headerText${columnIndex}`;
        const textStyleVar = `headerTextStyle${columnIndex}`;
        const cellBasis = columnBasisPercentages[columnIndex] ?? '25%';
        lines.push(
          `  const ${textVar} = new TextElement("${escapeSourceString(header)}", "label");`
        );
        lines.push(`  const ${textStyleVar} = new ElementStyle();`);
        lines.push(`  ${textStyleVar}.fontWeight = "${escapeSourceString(tableHeaderFontWeight)}";`);
        lines.push(`  ${textVar}.style = ${textStyleVar};`);
        lines.push(
          `  ${textVar}.id = "${escapeSourceString(node.id)}__header_text_${columnIndex}";`
        );
        lines.push(
          `  const ${cellVar} = new ColumnElement([${textVar}]);`
        );
        lines.push(`  const ${cellVar}Style = new ElementStyle();`);
        lines.push(`  ${cellVar}Style.flexGrow = "0";`);
        lines.push(`  ${cellVar}Style.flexShrink = "0";`);
        lines.push(`  ${cellVar}Style.flexBasis = "${escapeSourceString(cellBasis)}";`);
        lines.push(`  ${cellVar}Style.width = "${escapeSourceString(cellBasis)}";`);
        lines.push(
          `  ${cellVar}.id = "${escapeSourceString(node.id)}__header_cell_${columnIndex}";`
        );
        if (tableBorderConfig.columnDividers && columnIndex < visibleColumns.length - 1) {
          lines.push(`  ${cellVar}Style.borderRight = "${INVOICE_BORDER_SUBTLE}";`);
        }
        lines.push(`  ${cellVar}.style = ${cellVar}Style;`);
        lines.push(`  headerCells.push(${cellVar});`);
      });
      lines.push('  const headerRow = new RowElement(headerCells);');
      lines.push(`  headerRow.id = "${escapeSourceString(node.id)}__header_row";`);
      lines.push('  const headerRowStyle = new ElementStyle();');
      lines.push('  headerRowStyle.marginBottom = "0px";');
      lines.push(
        `  headerRowStyle.borderBottom = "${tableBorderConfig.rowDividers ? INVOICE_BORDER_LIGHT : '0px'}";`
      );
      lines.push('  headerRow.style = headerRowStyle;');
      lines.push('  children.push(headerRow);');
      lines.push('  for (let itemIndex = 0; itemIndex < viewModel.items.length; itemIndex++) {');
      lines.push('    const rowItem = viewModel.items[itemIndex];');
      lines.push('    const rowCells = new Array<LayoutElement>();');
      visibleColumns.forEach((column, columnIndex) => {
        const key = asTrimmedString(column.key) || 'item.description';
        const format = asTrimmedString(column.type) || 'text';
        const cellVar = `rowCell${columnIndex}`;
        const cellBasis = columnBasisPercentages[columnIndex] ?? '25%';
        lines.push(
          `    const ${cellVar} = new ColumnElement([new TextElement(resolveItemBinding(viewModel, rowItem, "${escapeSourceString(
            key
          )}", "${escapeSourceString(format)}"))]);`
        );
        lines.push(`    const ${cellVar}Style = new ElementStyle();`);
        lines.push(`    ${cellVar}Style.flexGrow = "0";`);
        lines.push(`    ${cellVar}Style.flexShrink = "0";`);
        lines.push(`    ${cellVar}Style.flexBasis = "${escapeSourceString(cellBasis)}";`);
        lines.push(`    ${cellVar}Style.width = "${escapeSourceString(cellBasis)}";`);
        lines.push(
          `    ${cellVar}.id = "${escapeSourceString(node.id)}__row_cell_${columnIndex}_" + itemIndex.toString();`
        );
        if (tableBorderConfig.columnDividers && columnIndex < visibleColumns.length - 1) {
          lines.push(`    ${cellVar}Style.borderRight = "${INVOICE_BORDER_SUBTLE}";`);
        }
        lines.push(`    ${cellVar}.style = ${cellVar}Style;`);
        lines.push(`    rowCells.push(${cellVar});`);
      });
      lines.push('    const row = new RowElement(rowCells);');
      lines.push(`    row.id = "${escapeSourceString(node.id)}__row_" + itemIndex.toString();`);
      lines.push('    const rowStyle = new ElementStyle();');
      lines.push('    rowStyle.marginBottom = "0px";');
      if (tableBorderConfig.rowDividers) {
        lines.push('    if (itemIndex < viewModel.items.length - 1) {');
        lines.push(`      rowStyle.borderBottom = "${INVOICE_BORDER_SUBTLE}";`);
        lines.push('    } else {');
        lines.push('      rowStyle.borderBottom = "0px";');
        lines.push('    }');
      } else {
        lines.push('    rowStyle.borderBottom = "0px";');
      }
      lines.push('    row.style = rowStyle;');
      lines.push('    children.push(row);');
      lines.push('  }');
    } else {
      lines.push('  children.push(new TextElement("Totals"));');
      lines.push(
        '  children.push(new TextElement("Subtotal: " + resolveInvoiceBinding(viewModel, "invoice.subtotal", "currency")));'
      );
      lines.push('  children.push(new TextElement("Tax: " + resolveInvoiceBinding(viewModel, "invoice.tax", "currency")));');
      lines.push(
        '  children.push(new TextElement("Total: " + resolveInvoiceBinding(viewModel, "invoice.total", "currency")));'
      );
    }
    node.children.forEach((childNode) => {
      lines.push(`  children.push(${makeNodeSymbol(childNode.id)}(viewModel));`);
    });
    lines.push('  const node = new SectionElement(children);');
    emitLayoutStyleCall(node, lines, nodesById);
    if (node.type === 'table' || node.type === 'dynamic-table') {
      lines.push('  const nodeStyle = ensureElementStyle(node);');
      lines.push(`  nodeStyle.border = "${tableBorderConfig.outer ? INVOICE_BORDER_STRONG : '0px'}";`);
      lines.push(`  nodeStyle.borderRadius = "${tableBorderConfig.outer ? '6px' : '0px'}";`);
    }
    lines.push(`  node.id = "${escapeSourceString(node.id)}";`);
    lines.push('  return node;');
    lines.push('}');
    const endLine = lines.length;
    sourceMap.push({ nodeId: node.id, symbol, startLine, endLine });
    return;
  }

  if (node.type === 'image' || node.type === 'logo' || node.type === 'qr') {
    const metadata = asRecord(node.metadata);
    const src = asTrimmedString(metadata.src) || asTrimmedString(metadata.url) || '';
    const alt = asTrimmedString(metadata.alt) || node.name || 'Image';
    lines.push(
      `  const node = new ImageElement("${escapeSourceString(src)}", "${escapeSourceString(alt)}");`
    );
    emitLayoutStyleCall(node, lines, nodesById);
    lines.push(`  node.id = "${escapeSourceString(node.id)}";`);
    lines.push('  return node;');
    lines.push('}');
    const endLine = lines.length;
    sourceMap.push({ nodeId: node.id, symbol, startLine, endLine });
    return;
  }

  if (node.type === 'field') {
    const bindingKey = resolveFieldBindingKey(node);
    const format = resolveFieldFormat(node);
    const fieldBorderStyle = resolveFieldBorderStyle(asRecord(node.metadata));
    const textExpr = bindingKey
      ? `resolveInvoiceBinding(viewModel, "${escapeSourceString(bindingKey)}", "${escapeSourceString(format)}")`
      : `"${escapeSourceString(node.name)}"`;
    lines.push(`  const node = new TextElement(${textExpr});`);
    emitLayoutStyleCall(node, lines, nodesById);
    lines.push('  const nodeStyle = ensureElementStyle(node);');
    if (fieldBorderStyle === 'underline') {
      lines.push('  nodeStyle.border = "0px";');
      lines.push(`  nodeStyle.borderBottom = "${INVOICE_BORDER_LIGHT}";`);
      lines.push('  nodeStyle.borderRadius = "0px";');
    } else if (fieldBorderStyle === 'none') {
      lines.push('  nodeStyle.border = "0px";');
      lines.push('  nodeStyle.borderBottom = "0px";');
      lines.push('  nodeStyle.borderRadius = "0px";');
    } else {
      lines.push(`  nodeStyle.border = "${INVOICE_BORDER_LIGHT}";`);
      lines.push('  nodeStyle.borderBottom = "0px";');
      lines.push('  nodeStyle.borderRadius = "4px";');
    }
    lines.push(`  node.id = "${escapeSourceString(node.id)}";`);
    lines.push('  return node;');
    lines.push('}');
    const endLine = lines.length;
    sourceMap.push({ nodeId: node.id, symbol, startLine, endLine });
    return;
  }

  if (node.type === 'subtotal' || node.type === 'tax' || node.type === 'discount' || node.type === 'custom-total') {
    const label = resolveRenderableTotalLabel(node);
    const bindingKey = resolveRenderableTotalBindingKey(node);
    const format = resolveFieldFormat(node, 'currency');
    const valueExpr = `resolveInvoiceBinding(viewModel, "${escapeSourceString(bindingKey)}", "${escapeSourceString(
      format
    )}")`;
    const contentExpr = label.length > 0 ? `"${escapeSourceString(label)}: " + ${valueExpr}` : valueExpr;
    lines.push(
      `  const node = new TextElement(${contentExpr});`
    );
    emitLayoutStyleCall(node, lines, nodesById);
    lines.push(`  node.id = "${escapeSourceString(node.id)}";`);
    lines.push('  return node;');
    lines.push('}');
    const endLine = lines.length;
    sourceMap.push({ nodeId: node.id, symbol, startLine, endLine });
    return;
  }

  if (node.type === 'text') {
    const metadata = asRecord(node.metadata);
    const explicitText = asTrimmedString(metadata.text);
    const variant = asTrimmedString(metadata.variant);
    const bindingKey =
      asTrimmedString(metadata.bindingKey) ||
      asTrimmedString(metadata.binding) ||
      resolveImplicitBindingKeyForNode(node);
    const format = resolveFieldFormat(node);

    if (bindingKey.length > 0 && explicitText.length === 0) {
      lines.push(
        `  const node = new TextElement(resolveInvoiceBinding(viewModel, "${escapeSourceString(
          bindingKey
        )}", "${escapeSourceString(format)}"));`
      );
    } else if (variant.length > 0) {
      const content = pickRenderableLiteral(explicitText, node.name);
      lines.push(
        `  const node = new TextElement("${escapeSourceString(content)}", "${escapeSourceString(variant)}");`
      );
    } else {
      const content = pickRenderableLiteral(explicitText, node.name);
      lines.push(`  const node = new TextElement("${escapeSourceString(content)}");`);
    }
    emitLayoutStyleCall(node, lines, nodesById);
    lines.push(`  node.id = "${escapeSourceString(node.id)}";`);
    lines.push('  return node;');
    lines.push('}');
    const endLine = lines.length;
    sourceMap.push({ nodeId: node.id, symbol, startLine, endLine });
    return;
  }

  if (node.type === 'label') {
    const metadata = asRecord(node.metadata);
    const labelText = normalizeScaffoldLabelLiteral(
      resolveLabelText(node, { shouldSkip: isGenericScaffoldLiteral }).text
    );
    const labelFontWeight = resolveFontWeightCssValue(metadata.fontWeight ?? metadata.labelFontWeight, 'semibold');
    lines.push(
      `  const node = new TextElement("${escapeSourceString(labelText)}", "label");`
    );
    emitLayoutStyleCall(node, lines, nodesById);
    lines.push('  const nodeStyle = ensureElementStyle(node);');
    lines.push(`  nodeStyle.fontWeight = "${escapeSourceString(labelFontWeight)}";`);
    lines.push(`  node.id = "${escapeSourceString(node.id)}";`);
    lines.push('  return node;');
    lines.push('}');
    const endLine = lines.length;
    sourceMap.push({ nodeId: node.id, symbol, startLine, endLine });
    return;
  }

  const text = resolveNodeText(node);
  if (text.variant) {
    lines.push(
      `  const node = new TextElement("${escapeSourceString(text.content)}", "${escapeSourceString(text.variant)}");`
    );
  } else {
    lines.push(`  const node = new TextElement("${escapeSourceString(text.content)}");`);
  }
  emitLayoutStyleCall(node, lines, nodesById);
  lines.push(`  node.id = "${escapeSourceString(node.id)}";`);
  lines.push('  return node;');
  lines.push('}');

  const endLine = lines.length;
  sourceMap.push({ nodeId: node.id, symbol, startLine, endLine });
};

const collectTreeNodes = (root: InvoiceDesignerIrTreeNode): InvoiceDesignerIrTreeNode[] => {
  const nodes: InvoiceDesignerIrTreeNode[] = [];
  const walk = (node: InvoiceDesignerIrTreeNode) => {
    nodes.push(node);
    node.children.forEach((child) => walk(child));
  };
  walk(root);
  return nodes;
};

export const generateAssemblyScriptFromIr = (
  ir: InvoiceDesignerCompilerIr
): GenerateAssemblyScriptResult => {
  const lines: string[] = [];
  const sourceMap: InvoiceDesignerSourceMapEntry[] = [];
  const treeNodes = collectTreeNodes(ir.tree);
  const nodesById = new Map(treeNodes.map((node) => [node.id, node]));

  lines.push('import { JSON } from "json-as";');
  lines.push(
    'import { InvoiceViewModel, InvoiceItem, LayoutElement, ElementStyle, DocumentElement, SectionElement, RowElement, ColumnElement, TextElement, ImageElement } from "../assembly/types";'
  );
  lines.push('');
  emitLayoutHelpers(lines);
  emitStyleHelpers(lines);
  emitBindingHelpers(lines);

  treeNodes.forEach((node) => {
    emitNodeFactory(node, lines, sourceMap, nodesById);
    lines.push('');
  });

  lines.push('// @ts-ignore: decorator');
  lines.push('@unsafe');
  lines.push('export function generateLayout(dataString: string): string {');
  lines.push('  const viewModel = JSON.parse<InvoiceViewModel>(dataString);');
  lines.push(`  const root = ${makeNodeSymbol(ir.rootNodeId)}(viewModel);`);
  lines.push('  return root.toJsonString();');
  lines.push('}');

  const source = lines.join('\n');
  return {
    source,
    sourceHash: createDeterministicSourceHash(source),
    sourceMap,
  };
};
