import type { InvoiceTemplateAst, InvoiceTemplateNode, InvoiceTemplateTableColumn } from '@alga-psa/types';
import { INVOICE_TEMPLATE_AST_VERSION } from '@alga-psa/types';
import type { DesignerNode, DesignerWorkspaceSnapshot } from '../state/designerStore';
import { DOCUMENT_NODE_ID } from '../state/designerStore';
import { getAllowedChildrenForType } from '../state/hierarchy';
import { getDefinition } from '../constants/componentCatalog';
import { DESIGNER_CANVAS_BOUNDS } from '../constants/layout';

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

const denormalizeBindingPath = (path: string): string => {
  const aliases: Record<string, string> = {
    invoiceNumber: 'invoice.number',
    issueDate: 'invoice.issueDate',
    dueDate: 'invoice.dueDate',
    subtotal: 'invoice.subtotal',
    tax: 'invoice.tax',
    total: 'invoice.total',
    discount: 'invoice.discount',
    currencyCode: 'invoice.currencyCode',
    poNumber: 'invoice.poNumber',
    'customer.name': 'customer.name',
    'customer.address': 'customer.address',
    'tenantClient.name': 'tenant.name',
    'tenantClient.address': 'tenant.address',
  };
  return aliases[path] ?? path;
};

const parseSizeFromStyle = (node: InvoiceTemplateNode): { width: number; height: number } => {
  const inline = node.style?.inline ?? {};
  const defaultSize = getDefinition('text')?.defaultSize ?? { width: 180, height: 48 };
  const parse = (value: unknown, fallback: number): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(1, value);
    }
    if (typeof value === 'string') {
      const numeric = Number.parseFloat(value.replace('px', '').trim());
      if (Number.isFinite(numeric)) {
        return Math.max(1, numeric);
      }
    }
    return fallback;
  };
  return {
    width: parse(inline.width, defaultSize.width),
    height: parse(inline.height, defaultSize.height),
  };
};

const buildDesignerNode = (
  node: InvoiceTemplateNode,
  designerType: DesignerNode['type'],
  parentId: string,
  index: number
): DesignerNode => {
  const def = getDefinition(designerType);
  const size = parseSizeFromStyle(node);
  return {
    id: node.id,
    type: designerType,
    name: node.id,
    position: { x: 24, y: 24 + index * (size.height + 12) },
    size: {
      width: Number.isFinite(size.width) ? size.width : def?.defaultSize.width ?? 220,
      height: Number.isFinite(size.height) ? size.height : def?.defaultSize.height ?? 56,
    },
    baseSize: undefined,
    canRotate: false,
    allowResize: true,
    rotation: 0,
    metadata: { ...(def?.defaultMetadata ?? {}) },
    layoutPresetId: undefined,
    parentId,
    childIds: [],
    allowedChildren: getAllowedChildrenForType(designerType),
    layout: undefined,
  };
};

const importAstNode = (
  node: InvoiceTemplateNode,
  parentId: string,
  nodes: DesignerNode[],
  ast: InvoiceTemplateAst,
  depthIndex: number
) => {
  const typeMap: Partial<Record<InvoiceTemplateNode['type'], DesignerNode['type']>> = {
    section: 'section',
    stack: 'container',
    text: 'text',
    field: 'field',
    image: 'image',
    divider: 'divider',
    table: 'table',
    'dynamic-table': 'dynamic-table',
    totals: 'totals',
  };

  const designerType = typeMap[node.type];
  if (!designerType) {
    return;
  }

  const nextNode = buildDesignerNode(node, designerType, parentId, depthIndex);

  if (node.type === 'text') {
    if (node.content.type === 'literal') {
      nextNode.metadata = {
        ...(nextNode.metadata ?? {}),
        text: String(node.content.value ?? ''),
      };
      nextNode.name = String(node.content.value ?? nextNode.name);
    }
  } else if (node.type === 'field') {
    const bindingPath =
      ast.bindings?.values?.[node.binding.bindingId]?.path ??
      ast.bindings?.collections?.[node.binding.bindingId]?.path ??
      node.binding.bindingId;
    nextNode.metadata = {
      ...(nextNode.metadata ?? {}),
      bindingKey: denormalizeBindingPath(bindingPath),
    };
    if (node.label) {
      nextNode.name = node.label;
      nextNode.metadata.label = node.label;
    }
  } else if (node.type === 'dynamic-table' || node.type === 'table') {
    const collectionPath =
      ast.bindings?.collections?.[node.type === 'dynamic-table'
        ? node.repeat.sourceBinding.bindingId
        : node.sourceBinding.bindingId]?.path ?? 'items';
    nextNode.metadata = {
      ...(nextNode.metadata ?? {}),
      collectionBindingKey: denormalizeBindingPath(collectionPath),
      columns: node.columns.map((column) => ({
        id: column.id,
        header: column.header,
        key: column.value.type === 'path' ? `item.${column.value.path}` : column.id,
      })),
    };
  }

  nodes.push(nextNode);

  const childNodes = node.type === 'section' || node.type === 'stack' ? node.children : [];
  childNodes.forEach((child, index) => {
    importAstNode(child, nextNode.id, nodes, ast, index);
    nextNode.childIds.push(child.id);
  });
};

export const importInvoiceTemplateAstToWorkspace = (
  ast: InvoiceTemplateAst
): DesignerWorkspaceSnapshot => {
  const documentNode: DesignerNode = {
    id: DOCUMENT_NODE_ID,
    type: 'document',
    name: 'Document',
    position: { x: 0, y: 0 },
    size: { width: DESIGNER_CANVAS_BOUNDS.width, height: DESIGNER_CANVAS_BOUNDS.height },
    baseSize: { width: DESIGNER_CANVAS_BOUNDS.width, height: DESIGNER_CANVAS_BOUNDS.height },
    canRotate: false,
    allowResize: false,
    rotation: 0,
    metadata: {},
    layoutPresetId: undefined,
    parentId: null,
    childIds: ['designer-page-imported'],
    allowedChildren: getAllowedChildrenForType('document'),
    layout: {
      mode: 'flex',
      direction: 'column',
      gap: 0,
      padding: 0,
      justify: 'start',
      align: 'stretch',
      sizing: 'fixed',
    },
  };

  const pageNode: DesignerNode = {
    id: 'designer-page-imported',
    type: 'page',
    name: 'Page 1',
    position: { x: 0, y: 0 },
    size: { width: DESIGNER_CANVAS_BOUNDS.width, height: DESIGNER_CANVAS_BOUNDS.height },
    baseSize: { width: DESIGNER_CANVAS_BOUNDS.width, height: DESIGNER_CANVAS_BOUNDS.height },
    canRotate: false,
    allowResize: false,
    rotation: 0,
    metadata: {},
    layoutPresetId: undefined,
    parentId: DOCUMENT_NODE_ID,
    childIds: [],
    allowedChildren: getAllowedChildrenForType('page'),
    layout: {
      mode: 'flex',
      direction: 'column',
      gap: 32,
      padding: 40,
      justify: 'start',
      align: 'stretch',
      sizing: 'hug',
    },
  };

  const nodes: DesignerNode[] = [documentNode, pageNode];
  const rootChildren = ast.layout.type === 'document' ? ast.layout.children : [ast.layout];
  rootChildren.forEach((child, index) => {
    importAstNode(child, pageNode.id, nodes, ast, index);
    pageNode.childIds.push(child.id);
  });

  return {
    nodes,
    constraints: [],
    snapToGrid: true,
    gridSize: 8,
    showGuides: true,
    showRulers: true,
    canvasScale: 1,
  };
};
