import type { InvoiceTemplateAst, InvoiceTemplateNode, InvoiceTemplateTableColumn } from '@alga-psa/types';
import { INVOICE_TEMPLATE_AST_VERSION } from '@alga-psa/types';
import type {
  DesignerContainerLayout,
  DesignerNode,
  DesignerNodeStyle,
  DesignerWorkspaceSnapshot,
} from '../state/designerStore';
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

const createNodeStyle = (node: DesignerNode) => {
  const inline: Record<string, unknown> = {};
  const style = node.style ?? {};
  const layout = node.layout;

  inline.width = style.width ?? `${Math.max(1, Math.round(node.size.width))}px`;
  inline.height = style.height ?? `${Math.max(1, Math.round(node.size.height))}px`;

  if (style.minWidth) inline.minWidth = style.minWidth;
  if (style.minHeight) inline.minHeight = style.minHeight;
  if (style.maxWidth) inline.maxWidth = style.maxWidth;
  if (style.maxHeight) inline.maxHeight = style.maxHeight;

  if (typeof style.flexGrow === 'number') inline.flexGrow = style.flexGrow;
  if (typeof style.flexShrink === 'number') inline.flexShrink = style.flexShrink;
  if (style.flexBasis) inline.flexBasis = style.flexBasis;

  if (style.aspectRatio) inline.aspectRatio = style.aspectRatio;
  if (style.objectFit) inline.objectFit = style.objectFit;

  if (layout) {
    inline.display = layout.display;
    if (layout.gap) inline.gap = layout.gap;
    if (layout.padding) inline.padding = layout.padding;

    if (layout.display === 'flex') {
      if (layout.flexDirection) inline.flexDirection = layout.flexDirection;
      if (layout.justifyContent) inline.justifyContent = layout.justifyContent;
      if (layout.alignItems) inline.alignItems = layout.alignItems;
    }

    if (layout.display === 'grid') {
      if (layout.gridTemplateColumns) inline.gridTemplateColumns = layout.gridTemplateColumns;
      if (layout.gridTemplateRows) inline.gridTemplateRows = layout.gridTemplateRows;
      if (layout.gridAutoFlow) inline.gridAutoFlow = layout.gridAutoFlow;
    }
  }

  return { inline };
};

const coerceCssLength = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${value}px`;
  }
  return undefined;
};

const coerceNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.length) return undefined;
    const numeric = Number.parseFloat(trimmed);
    return Number.isFinite(numeric) ? numeric : undefined;
  }
  return undefined;
};

const coerceObjectFit = (value: unknown): DesignerNodeStyle['objectFit'] | undefined => {
  if (value === 'contain' || value === 'cover' || value === 'fill' || value === 'none' || value === 'scale-down') {
    return value;
  }
  return undefined;
};

const coerceJustifyContent = (value: unknown): DesignerContainerLayout['justifyContent'] | undefined => {
  if (
    value === 'flex-start' ||
    value === 'center' ||
    value === 'flex-end' ||
    value === 'space-between' ||
    value === 'space-around' ||
    value === 'space-evenly'
  ) {
    return value;
  }
  return undefined;
};

const coerceAlignItems = (value: unknown): DesignerContainerLayout['alignItems'] | undefined => {
  if (value === 'flex-start' || value === 'center' || value === 'flex-end' || value === 'stretch') {
    return value;
  }
  return undefined;
};

const coerceGridAutoFlow = (value: unknown): DesignerContainerLayout['gridAutoFlow'] | undefined => {
  if (value === 'row' || value === 'column' || value === 'dense' || value === 'row dense' || value === 'column dense') {
    return value;
  }
  return undefined;
};

const coerceContainerLayoutFromInlineStyle = (
  inline: Record<string, unknown> | undefined
): DesignerContainerLayout | undefined => {
  if (!inline) return undefined;
  const display = inline.display === 'flex' || inline.display === 'grid' ? inline.display : undefined;
  if (!display) return undefined;

  const gap = coerceCssLength(inline.gap);
  const padding = coerceCssLength(inline.padding);

  if (display === 'flex') {
    const flexDirection = inline.flexDirection === 'row' || inline.flexDirection === 'column' ? inline.flexDirection : undefined;
    const justifyContent = coerceJustifyContent(inline.justifyContent);
    const alignItems = coerceAlignItems(inline.alignItems);
    return {
      display,
      flexDirection,
      justifyContent,
      alignItems,
      gap,
      padding,
    };
  }

  const gridAutoFlow = coerceGridAutoFlow(inline.gridAutoFlow);
  return {
    display,
    gridTemplateColumns: coerceCssLength(inline.gridTemplateColumns),
    gridTemplateRows: coerceCssLength(inline.gridTemplateRows),
    gridAutoFlow,
    gap,
    padding,
  };
};

const coerceNodeStyleFromInlineStyle = (inline: Record<string, unknown> | undefined): DesignerNodeStyle | undefined => {
  if (!inline) return undefined;

  const style: DesignerNodeStyle = {};

  const width = coerceCssLength(inline.width);
  const height = coerceCssLength(inline.height);
  const minWidth = coerceCssLength(inline.minWidth);
  const minHeight = coerceCssLength(inline.minHeight);
  const maxWidth = coerceCssLength(inline.maxWidth);
  const maxHeight = coerceCssLength(inline.maxHeight);

  if (width) style.width = width;
  if (height) style.height = height;
  if (minWidth) style.minWidth = minWidth;
  if (minHeight) style.minHeight = minHeight;
  if (maxWidth) style.maxWidth = maxWidth;
  if (maxHeight) style.maxHeight = maxHeight;

  const flexGrow = coerceNumber(inline.flexGrow);
  const flexShrink = coerceNumber(inline.flexShrink);
  const flexBasis = coerceCssLength(inline.flexBasis);
  if (typeof flexGrow === 'number') style.flexGrow = flexGrow;
  if (typeof flexShrink === 'number') style.flexShrink = flexShrink;
  if (flexBasis) style.flexBasis = flexBasis;

  const aspectRatio = coerceCssLength(inline.aspectRatio);
  if (aspectRatio) style.aspectRatio = aspectRatio;
  const objectFit = coerceObjectFit(inline.objectFit);
  if (objectFit) style.objectFit = objectFit;

  return Object.keys(style).length > 0 ? style : undefined;
};

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
	      return {
	        ...createBaseNode(node),
	        type: 'section',
	        title: node.type === 'section' ? node.name : undefined,
	        children,
	      };
	    case 'container':
	      return {
	        ...createBaseNode(node),
	        type: 'stack',
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
  index: number,
  depth: number
): DesignerNode => {
  const def = getDefinition(designerType);
  const size = parseSizeFromStyle(node);
  const inline = isRecord(node.style?.inline) ? (node.style?.inline as Record<string, unknown>) : undefined;
  const styleFromInline = coerceNodeStyleFromInlineStyle(inline);
  const layoutFromInline = coerceContainerLayoutFromInlineStyle(inline);

  const isFixedFrame = designerType === 'document' || designerType === 'page';
  const defaultContainerLayout: DesignerContainerLayout | undefined =
    designerType === 'page'
      ? {
          display: 'flex',
          flexDirection: 'column',
          gap: '32px',
          padding: '40px',
          justifyContent: 'flex-start',
          alignItems: 'stretch',
        }
      : designerType === 'document'
        ? {
            display: 'flex',
            flexDirection: 'column',
            gap: '0px',
            padding: '0px',
            justifyContent: 'flex-start',
            alignItems: 'stretch',
          }
        : designerType === 'section' || designerType === 'container'
          ? {
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              padding: '16px',
              justifyContent: 'flex-start',
              alignItems: 'stretch',
            }
          : undefined;

  return {
    id: node.id,
    type: designerType,
    name: node.id,
    position: isFixedFrame
      ? { x: 0, y: 0 }
      : depth <= 1
        ? { x: 0, y: 0 }
        : { x: 24, y: 24 + index * (size.height + 12) },
    size: {
      width: Number.isFinite(size.width) ? size.width : def?.defaultSize.width ?? 220,
      height: Number.isFinite(size.height) ? size.height : def?.defaultSize.height ?? 56,
    },
    baseSize: undefined,
    canRotate: false,
    allowResize: !isFixedFrame,
    rotation: 0,
    metadata: { ...(def?.defaultMetadata ?? {}) },
    layoutPresetId: undefined,
    parentId,
    childIds: [],
    allowedChildren: getAllowedChildrenForType(designerType),
    layout:
      designerType === 'document' || designerType === 'page' || designerType === 'section' || designerType === 'container'
        ? layoutFromInline ?? defaultContainerLayout
        : undefined,
    style: styleFromInline,
  };
};

const importAstNode = (
  node: InvoiceTemplateNode,
  parentId: string,
  nodes: DesignerNode[],
  ast: InvoiceTemplateAst,
  depthIndex: number,
  depth: number
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

  // The designer always has an explicit page node; AST nodes map directly without "first section becomes page"
  // heuristics. This avoids accidentally shrinking the canvas when importing AST that starts with a section.
  const designerType = typeMap[node.type];
  if (!designerType) {
    return;
  }

  const nextNode = buildDesignerNode(node, designerType, parentId, depthIndex, depth);

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
    importAstNode(child, nextNode.id, nodes, ast, index, depth + 1);
    nextNode.childIds.push(child.id);
  });
};

export const importInvoiceTemplateAstToWorkspace = (
  ast: InvoiceTemplateAst
): DesignerWorkspaceSnapshot => {
  const astDocument = ast.layout.type === 'document' ? ast.layout : null;
  const documentInline = astDocument && isRecord(astDocument.style?.inline)
    ? (astDocument.style?.inline as Record<string, unknown>)
    : undefined;

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
    childIds: [],
    allowedChildren: getAllowedChildrenForType('document'),
    layout:
      coerceContainerLayoutFromInlineStyle(documentInline) ?? {
        display: 'flex',
        flexDirection: 'column',
        gap: '0px',
        padding: '0px',
        justifyContent: 'flex-start',
        alignItems: 'stretch',
      },
    style: coerceNodeStyleFromInlineStyle(documentInline),
  };

  // Always materialize a page node as the canvas root so sizing/margins are stable and consistent.
  const pageNode: DesignerNode = {
    id: 'page-root',
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
    parentId: documentNode.id,
    childIds: [],
    allowedChildren: getAllowedChildrenForType('page'),
    layout: {
      display: 'flex',
      flexDirection: 'column',
      gap: '32px',
      padding: '40px', // Page margins
      justifyContent: 'flex-start',
      alignItems: 'stretch',
    },
    style: undefined,
  };

  documentNode.childIds = [pageNode.id];

  const nodes: DesignerNode[] = [documentNode, pageNode];
  const rootChildren = ast.layout.type === 'document' ? ast.layout.children : [ast.layout];
  rootChildren.forEach((child, index) => {
    importAstNode(child, pageNode.id, nodes, ast, index, 0);
    pageNode.childIds.push(child.id);
  });

  return {
    nodes,
    snapToGrid: true,
    gridSize: 8,
    showGuides: true,
    showRulers: true,
    canvasScale: 1,
  };
};
