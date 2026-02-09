import type { InvoiceDesignerCompilerIr, InvoiceDesignerIrTreeNode } from './guiIr';

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
      pickRenderableLiteral(asTrimmedString(metadata.text), node.name)
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

  const parentPadding = Math.max(0, Math.round(parent.layout?.padding ?? 0));
  if (parent.layout.direction === 'row') {
    return rawY - parentPadding;
  }

  const siblingIds = parent.childIds;
  const siblingIndex = siblingIds.indexOf(node.id);
  if (siblingIndex <= 0) {
    return rawY - parentPadding;
  }

  const previousSiblingId = siblingIds[siblingIndex - 1];
  const previousSibling = nodesById.get(previousSiblingId);
  if (!previousSibling) {
    return rawY - parentPadding;
  }

  const previousSiblingBottom = Math.round(previousSibling.position.y) + Math.round(previousSibling.size.height);
  return rawY - previousSiblingBottom;
};

const resolveLayoutStyleArgs = (
  node: InvoiceDesignerIrTreeNode,
  nodesById: Map<string, InvoiceDesignerIrTreeNode>
) => ({
  width: Math.max(1, Math.round(node.size.width)),
  height: Math.max(1, Math.round(node.size.height)),
  x: Math.max(0, Math.round(node.position.x)),
  y: resolveNormalizedMarginTop(node, nodesById),
  gap: Math.max(0, Math.round(node.layout?.gap ?? 0)),
  padding: Math.max(0, Math.round(node.layout?.padding ?? 0)),
  align: node.layout?.align ?? 'start',
  justify: node.layout?.justify ?? 'start',
  mode: node.layout?.mode ?? 'canvas',
  sizing: node.layout?.sizing ?? 'fixed',
});

const emitLayoutStyleCall = (
  node: InvoiceDesignerIrTreeNode,
  lines: string[],
  nodesById: Map<string, InvoiceDesignerIrTreeNode>
) => {
  const args = resolveLayoutStyleArgs(node, nodesById);
  lines.push(`  // layout-mode:${args.mode}; sizing:${args.sizing}`);
  lines.push(
    `  applyGeneratedLayoutStyle(node, ${args.width}, ${args.height}, ${args.x}, ${args.y}, ${args.gap}, ${args.padding}, "${args.align}", "${args.justify}");`
  );
};

const emitLayoutHelpers = (lines: string[]) => {
  lines.push(
    'function applyGeneratedLayoutStyle(node: LayoutElement, width: i32, height: i32, x: i32, y: i32, gap: i32, padding: i32, align: string, justify: string): void {'
  );
  lines.push('  const style = new ElementStyle();');
  lines.push('  style.width = width.toString() + "px";');
  lines.push('  style.paddingLeft = x.toString() + "px";');
  lines.push('  style.marginTop = y.toString() + "px";');
  lines.push('  if (padding > 0) {');
  lines.push('    const px = padding.toString() + "px";');
  lines.push('    style.paddingTop = px;');
  lines.push('    style.paddingBottom = px;');
  lines.push('  }');
  lines.push('  if (gap > 0) {');
  lines.push('    style.marginBottom = gap.toString() + "px";');
  lines.push('  }');
  lines.push('  if (align == "center") {');
  lines.push('    style.textAlign = "center";');
  lines.push('  }');
  lines.push('  if (align == "end") {');
  lines.push('    style.textAlign = "right";');
  lines.push('  }');
  lines.push('  if (justify == "space-between") {');
  lines.push('    style.borderBottom = "0px";');
  lines.push('  }');
  lines.push('  style.height = height.toString() + "px";');
  lines.push('  node.style = style;');
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
    if (node.type === 'table' || node.type === 'dynamic-table') {
      lines.push('  children.push(new TextElement("Table"));');
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
      resolvedColumns.slice(0, 4).forEach((column) => {
        const header = asTrimmedString(column.header) || asTrimmedString(column.key) || 'Column';
        lines.push(`  children.push(new TextElement("${escapeSourceString(header)}"));`);
      });
      lines.push('  for (let itemIndex = 0; itemIndex < viewModel.items.length; itemIndex++) {');
      lines.push('    const rowItem = viewModel.items[itemIndex];');
      resolvedColumns.slice(0, 4).forEach((column) => {
        const key = asTrimmedString(column.key) || 'item.description';
        const format = asTrimmedString(column.type) || 'text';
        lines.push(
          `    children.push(new TextElement(resolveItemBinding(viewModel, rowItem, "${escapeSourceString(
            key
          )}", "${escapeSourceString(format)}")));`
        );
      });
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
    const textExpr = bindingKey
      ? `resolveInvoiceBinding(viewModel, "${escapeSourceString(bindingKey)}", "${escapeSourceString(format)}")`
      : `"${escapeSourceString(node.name)}"`;
    lines.push(`  const node = new TextElement(${textExpr});`);
    emitLayoutStyleCall(node, lines, nodesById);
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
    'import { InvoiceViewModel, InvoiceItem, LayoutElement, ElementStyle, DocumentElement, SectionElement, ColumnElement, TextElement, ImageElement } from "../assembly/types";'
  );
  lines.push('');
  emitLayoutHelpers(lines);
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
