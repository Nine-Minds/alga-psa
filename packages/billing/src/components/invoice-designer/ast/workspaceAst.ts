import type { InvoiceTemplateAst, InvoiceTemplateNode, InvoiceTemplateTableColumn } from '@alga-psa/types';
import { INVOICE_TEMPLATE_AST_VERSION } from '@alga-psa/types';
import type { DesignerNode, DesignerWorkspaceSnapshot } from '../state/designerStore';

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asTrimmedString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const sanitizeId = (value: string): string =>
  value.replace(/[^a-zA-Z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '');

const normalizeInvoiceBindingPath = (bindingKey: string): string => {
  const normalized = bindingKey.trim();
  const aliases: Record<string, string> = {
    'invoice.number': 'invoiceNumber',
    'invoice.issueDate': 'issueDate',
    'invoice.dueDate': 'dueDate',
    'invoice.subtotal': 'subtotal',
    'invoice.tax': 'tax',
    'invoice.total': 'total',
    'invoice.discount': 'discount',
    'invoice.currencyCode': 'currencyCode',
    'invoice.poNumber': 'poNumber',
    'customer.name': 'customer.name',
    'customer.address': 'customer.address',
    'tenant.name': 'tenantClient.name',
    'tenant.address': 'tenantClient.address',
  };

  if (normalized.startsWith('item.')) {
    return normalized.slice('item.'.length);
  }
  return aliases[normalized] ?? normalized;
};

const resolveFieldBindingPath = (node: DesignerNode): string => {
  const metadata = isRecord(node.metadata) ? node.metadata : {};
  const fromMetadata =
    asTrimmedString(metadata.bindingKey) ||
    asTrimmedString(metadata.binding) ||
    asTrimmedString(metadata.path);

  if (fromMetadata.length > 0) {
    return normalizeInvoiceBindingPath(fromMetadata);
  }

  switch (node.type) {
    case 'subtotal':
      return 'subtotal';
    case 'tax':
      return 'tax';
    case 'discount':
      return 'discount';
    case 'custom-total':
      return 'total';
    default:
      return 'invoiceNumber';
  }
};

const resolveCollectionPath = (node: DesignerNode): string => {
  const metadata = isRecord(node.metadata) ? node.metadata : {};
  const rawPath =
    asTrimmedString(metadata.collectionBindingKey) ||
    asTrimmedString(metadata.collectionPath) ||
    asTrimmedString(metadata.bindingKey) ||
    asTrimmedString(metadata.path);
  const normalized = normalizeInvoiceBindingPath(rawPath);
  return normalized.length > 0 && normalized !== 'invoiceNumber' ? normalized : 'items';
};

const resolveNodeTextContent = (node: DesignerNode): string => {
  const metadata = isRecord(node.metadata) ? node.metadata : {};
  return (
    asTrimmedString(metadata.text) ||
    asTrimmedString(metadata.label) ||
    asTrimmedString(metadata.content) ||
    node.name
  );
};

const createNodeStyle = (node: DesignerNode) => ({
  inline: {
    width: `${Math.max(1, Math.round(node.size.width))}px`,
    height: `${Math.max(1, Math.round(node.size.height))}px`,
  },
});

const mapTableColumns = (node: DesignerNode): InvoiceTemplateTableColumn[] => {
  const metadata = isRecord(node.metadata) ? node.metadata : {};
  const columns = Array.isArray(metadata.columns) ? metadata.columns : [];

  const mappedColumns = columns
    .map((column, index): InvoiceTemplateTableColumn | null => {
      if (!isRecord(column)) {
        return null;
      }
      const id = asTrimmedString(column.id) || `col-${index + 1}`;
      const header = asTrimmedString(column.header);
      const key = normalizeInvoiceBindingPath(
        asTrimmedString(column.key) || asTrimmedString(column.path) || asTrimmedString(column.bindingKey)
      );
      return {
        id: sanitizeId(id),
        header: header.length > 0 ? header : undefined,
        value: { type: 'path', path: key.length > 0 ? key : 'description' },
      };
    })
    .filter((column): column is InvoiceTemplateTableColumn => Boolean(column));

  if (mappedColumns.length > 0) {
    return mappedColumns;
  }

  return [
    { id: 'description', header: 'Description', value: { type: 'path', path: 'description' } },
    { id: 'quantity', header: 'Qty', value: { type: 'path', path: 'quantity' } },
    { id: 'total', header: 'Amount', value: { type: 'path', path: 'total' } },
  ];
};

const createBaseNode = (node: DesignerNode): Pick<InvoiceTemplateNode, 'id' | 'style'> => ({
  id: node.id,
  style: createNodeStyle(node),
});

const mapDesignerNodeToAstNode = (
  node: DesignerNode,
  nodesById: Map<string, DesignerNode>,
  registerValueBinding: (path: string) => string,
  registerCollectionBinding: (path: string) => string
): InvoiceTemplateNode | null => {
  const children = node.childIds
    .map((childId) => nodesById.get(childId))
    .filter((child): child is DesignerNode => Boolean(child))
    .map((child) => mapDesignerNodeToAstNode(child, nodesById, registerValueBinding, registerCollectionBinding))
    .filter((child): child is InvoiceTemplateNode => Boolean(child));

  switch (node.type) {
    case 'document':
      return {
        ...createBaseNode(node),
        type: 'document',
        children,
      };
    case 'page':
    case 'section':
    case 'column':
    case 'container':
      return {
        ...createBaseNode(node),
        type: 'section',
        title: node.type === 'section' ? node.name : undefined,
        children,
      };
    case 'text':
    case 'label':
      return {
        ...createBaseNode(node),
        type: 'text',
        content: { type: 'literal', value: resolveNodeTextContent(node) },
      };
    case 'field':
    case 'subtotal':
    case 'tax':
    case 'discount':
    case 'custom-total': {
      const bindingPath = resolveFieldBindingPath(node);
      const bindingId = registerValueBinding(bindingPath);
      return {
        ...createBaseNode(node),
        type: 'field',
        binding: { bindingId },
        label: node.type === 'field' ? undefined : resolveNodeTextContent(node),
        emptyValue: '',
      };
    }
    case 'table':
    case 'dynamic-table': {
      const collectionPath = resolveCollectionPath(node);
      const sourceBindingId = registerCollectionBinding(collectionPath);
      return {
        ...createBaseNode(node),
        type: 'dynamic-table',
        repeat: {
          sourceBinding: { bindingId: sourceBindingId },
          itemBinding: 'item',
        },
        columns: mapTableColumns(node),
      };
    }
    case 'totals':
      return {
        ...createBaseNode(node),
        type: 'totals',
        sourceBinding: { bindingId: registerCollectionBinding('lineItems.shaped') },
        rows: [
          { id: 'subtotal', label: 'Subtotal', value: { type: 'path', path: 'subtotal' } },
          { id: 'tax', label: 'Tax', value: { type: 'path', path: 'tax' } },
          { id: 'total', label: 'Total', value: { type: 'path', path: 'total' }, emphasize: true },
        ],
      };
    case 'divider':
    case 'spacer':
      return {
        ...createBaseNode(node),
        type: 'divider',
      };
    case 'image':
    case 'logo':
    case 'qr': {
      const metadata = isRecord(node.metadata) ? node.metadata : {};
      const src = asTrimmedString(metadata.src) || asTrimmedString(metadata.url) || '';
      return {
        ...createBaseNode(node),
        type: 'image',
        src: { type: 'literal', value: src },
        alt: { type: 'literal', value: node.name },
      };
    }
    case 'signature':
    case 'action-button':
    case 'attachment-list':
      return {
        ...createBaseNode(node),
        type: 'text',
        content: { type: 'literal', value: resolveNodeTextContent(node) },
      };
    default:
      return null;
  }
};

export const exportWorkspaceToInvoiceTemplateAst = (
  workspace: DesignerWorkspaceSnapshot
): InvoiceTemplateAst => {
  const nodesById = new Map(workspace.nodes.map((node) => [node.id, node]));
  const root = workspace.nodes.find((node) => node.type === 'document') ?? workspace.nodes[0];
  const valueBindings: Record<string, { id: string; kind: 'value'; path: string }> = {};
  const collectionBindings: Record<string, { id: string; kind: 'collection'; path: string }> = {};

  const registerValueBinding = (path: string): string => {
    const normalizedPath = normalizeInvoiceBindingPath(path);
    const bindingId = sanitizeId(`value.${normalizedPath}`) || `value.${Object.keys(valueBindings).length + 1}`;
    if (!valueBindings[bindingId]) {
      valueBindings[bindingId] = {
        id: bindingId,
        kind: 'value',
        path: normalizedPath,
      };
    }
    return bindingId;
  };

  const registerCollectionBinding = (path: string): string => {
    const normalizedPath = normalizeInvoiceBindingPath(path);
    const bindingId = sanitizeId(`collection.${normalizedPath}`) || `collection.${Object.keys(collectionBindings).length + 1}`;
    if (!collectionBindings[bindingId]) {
      collectionBindings[bindingId] = {
        id: bindingId,
        kind: 'collection',
        path: normalizedPath,
      };
    }
    return bindingId;
  };

  const layout = root
    ? mapDesignerNodeToAstNode(root, nodesById, registerValueBinding, registerCollectionBinding)
    : null;

  return {
    kind: 'invoice-template-ast',
    version: INVOICE_TEMPLATE_AST_VERSION,
    bindings: {
      values: valueBindings,
      collections: collectionBindings,
    },
    layout: layout && layout.type === 'document'
      ? layout
      : {
          id: 'ast-root',
          type: 'document',
          children: layout ? [layout] : [],
        },
  };
};

export const exportWorkspaceToInvoiceTemplateAstJson = (
  workspace: DesignerWorkspaceSnapshot
): string => JSON.stringify(exportWorkspaceToInvoiceTemplateAst(workspace), null, 2);
