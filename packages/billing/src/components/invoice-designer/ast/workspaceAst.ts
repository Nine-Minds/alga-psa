import type { InvoiceTemplateAst, InvoiceTemplateNode, InvoiceTemplateTableColumn } from '@alga-psa/types';
import { INVOICE_TEMPLATE_AST_VERSION } from '@alga-psa/types';
import type {
  DesignerComponentType,
  DesignerContainerLayout,
  DesignerNodeStyle,
  DesignerWorkspaceSnapshot,
} from '../state/designerStore';
import { DOCUMENT_NODE_ID } from '../state/designerStore';
import { getDefinition } from '../constants/componentCatalog';
import { DESIGNER_CANVAS_BOUNDS } from '../constants/layout';

type WorkspaceNode = DesignerWorkspaceSnapshot['nodesById'][string];

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

const getWorkspaceNodeName = (node: WorkspaceNode): string => {
  const props = isRecord(node.props) ? node.props : {};
  return typeof props.name === 'string' ? props.name : node.id;
};

const getWorkspaceNodeMetadata = (node: WorkspaceNode): UnknownRecord => {
  const props = isRecord(node.props) ? node.props : {};
  return isRecord(props.metadata) ? (props.metadata as UnknownRecord) : {};
};

const getWorkspaceNodeStyle = (node: WorkspaceNode): Partial<DesignerNodeStyle> => {
  const props = isRecord(node.props) ? node.props : {};
  return isRecord(props.style) ? (props.style as Partial<DesignerNodeStyle>) : {};
};

const getWorkspaceNodeLayout = (node: WorkspaceNode): Partial<DesignerContainerLayout> | undefined => {
  const props = isRecord(node.props) ? node.props : {};
  return isRecord(props.layout) ? (props.layout as Partial<DesignerContainerLayout>) : undefined;
};

const resolveFieldBindingPath = (node: WorkspaceNode): string => {
  const metadata = getWorkspaceNodeMetadata(node);
  const fromMetadata =
    asTrimmedString(metadata.bindingKey) ||
    asTrimmedString(metadata.binding) ||
    asTrimmedString(metadata.path);

  if (fromMetadata.length > 0) {
    return normalizeInvoiceBindingPath(fromMetadata);
  }

  switch (node.type as DesignerComponentType) {
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

const resolveCollectionPath = (node: WorkspaceNode): string => {
  const metadata = getWorkspaceNodeMetadata(node);
  const rawPath =
    asTrimmedString(metadata.collectionBindingKey) ||
    asTrimmedString(metadata.collectionPath) ||
    asTrimmedString(metadata.bindingKey) ||
    asTrimmedString(metadata.path);
  const normalized = normalizeInvoiceBindingPath(rawPath);
  return normalized.length > 0 && normalized !== 'invoiceNumber' ? normalized : 'items';
};

const resolveNodeTextContent = (node: WorkspaceNode): string => {
  const metadata = getWorkspaceNodeMetadata(node);
  return (
    asTrimmedString(metadata.text) ||
    asTrimmedString(metadata.label) ||
    asTrimmedString(metadata.content) ||
    getWorkspaceNodeName(node)
  );
};

const createNodeStyle = (node: WorkspaceNode) => {
  const inline: Record<string, unknown> = {};
  const style = getWorkspaceNodeStyle(node);
  const layout = getWorkspaceNodeLayout(node);
  const props = isRecord(node.props) ? node.props : {};
  const sizeFromProps = isRecord(props.size) ? (props.size as UnknownRecord) : null;
  const widthFromSize = sizeFromProps && typeof sizeFromProps.width === 'number' ? `${sizeFromProps.width}px` : undefined;
  const heightFromSize = sizeFromProps && typeof sizeFromProps.height === 'number' ? `${sizeFromProps.height}px` : undefined;

  inline.width = style.width ?? widthFromSize ?? '1px';
  inline.height = style.height ?? heightFromSize ?? '1px';

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

const mapTableColumns = (node: WorkspaceNode): InvoiceTemplateTableColumn[] => {
  const metadata = getWorkspaceNodeMetadata(node);
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

const createBaseNode = (node: WorkspaceNode): Pick<InvoiceTemplateNode, 'id' | 'style'> => ({
  id: node.id,
  style: createNodeStyle(node),
});

const mapDesignerNodeToAstNode = (
  node: WorkspaceNode,
  nodesById: Map<string, WorkspaceNode>,
  registerValueBinding: (path: string) => string,
  registerCollectionBinding: (path: string) => string
): InvoiceTemplateNode | null => {
  const children = node.children
    .map((childId) => nodesById.get(childId))
    .filter((child): child is WorkspaceNode => Boolean(child))
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
	        title: node.type === 'section' ? getWorkspaceNodeName(node) : undefined,
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
      const metadata = getWorkspaceNodeMetadata(node);
      const src = asTrimmedString(metadata.src) || asTrimmedString(metadata.url) || '';
      return {
        ...createBaseNode(node),
        type: 'image',
        src: { type: 'literal', value: src },
        alt: { type: 'literal', value: getWorkspaceNodeName(node) },
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
  const entries = Object.entries(workspace.nodesById ?? {});
  const nodesById = new Map(entries.map(([id, node]) => [id, node as WorkspaceNode]));
  const root =
    (typeof workspace.rootId === 'string' ? (workspace.nodesById?.[workspace.rootId] as WorkspaceNode | undefined) : undefined) ??
    (entries.find(([, node]) => (node as WorkspaceNode).type === 'document')?.[1] as WorkspaceNode | undefined) ??
    (entries[0]?.[1] as WorkspaceNode | undefined);
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

export const importInvoiceTemplateAstToWorkspace = (
  ast: InvoiceTemplateAst
): DesignerWorkspaceSnapshot => {
  const astDocument = ast.layout.type === 'document' ? ast.layout : null;
  const documentInline = astDocument && isRecord(astDocument.style?.inline)
    ? (astDocument.style?.inline as Record<string, unknown>)
    : undefined;

  // Back-compat: older exports wrap all content in a single top-level "page" section.
  // Prefer treating that as the designer page node so export -> import -> export is deterministic.
  const astPageSectionCandidate =
    astDocument && astDocument.children.length === 1 && astDocument.children[0]?.type === 'section'
      ? astDocument.children[0]
      : null;
  const pageSectionInline =
    astPageSectionCandidate && isRecord(astPageSectionCandidate.style?.inline)
      ? (astPageSectionCandidate.style?.inline as Record<string, unknown>)
      : undefined;

  return {
    rootId: DOCUMENT_NODE_ID,
    nodesById: (() => {
      const nodesById: DesignerWorkspaceSnapshot['nodesById'] = {};

      const documentLayout =
        coerceContainerLayoutFromInlineStyle(documentInline) ?? {
          display: 'flex',
          flexDirection: 'column',
          gap: '0px',
          padding: '0px',
          justifyContent: 'flex-start',
          alignItems: 'stretch',
        };
      const documentStyle = coerceNodeStyleFromInlineStyle(documentInline);

      const documentNode: WorkspaceNode = {
        id: DOCUMENT_NODE_ID,
        type: 'document',
        props: {
          name: 'Document',
          metadata: {},
          layout: documentLayout,
          style: documentStyle,
          size: { width: DESIGNER_CANVAS_BOUNDS.width, height: DESIGNER_CANVAS_BOUNDS.height },
          position: { x: 0, y: 0 },
        },
        children: [],
      };

      // Always materialize a page node as the canvas root so sizing/margins are stable and consistent.
      // If the AST uses a single top-level section wrapper, treat it as the page node.
      const pageLayout =
        coerceContainerLayoutFromInlineStyle(pageSectionInline) ?? {
          display: 'flex',
          flexDirection: 'column',
          gap: '32px',
          padding: '40px', // Page margins
          justifyContent: 'flex-start',
          alignItems: 'stretch',
        };
      const pageStyle = coerceNodeStyleFromInlineStyle(pageSectionInline);
      const pageSize = astPageSectionCandidate ? parseSizeFromStyle(astPageSectionCandidate) : null;
      const resolvedPageSize = pageSize
        ? {
            width: Number.isFinite(pageSize.width) ? pageSize.width : DESIGNER_CANVAS_BOUNDS.width,
            height: Number.isFinite(pageSize.height) ? pageSize.height : DESIGNER_CANVAS_BOUNDS.height,
          }
        : { width: DESIGNER_CANVAS_BOUNDS.width, height: DESIGNER_CANVAS_BOUNDS.height };

      const pageNode: WorkspaceNode = {
        id: astPageSectionCandidate?.id ?? 'page-root',
        type: 'page',
        props: {
          name: 'Page 1',
          metadata: {},
          layout: pageLayout,
          style: pageStyle,
          size: resolvedPageSize,
          position: { x: 0, y: 0 },
        },
        children: [],
      };

      nodesById[documentNode.id] = documentNode;
      nodesById[pageNode.id] = pageNode;
      documentNode.children.push(pageNode.id);

      const buildWorkspaceNode = (
        inputNode: InvoiceTemplateNode,
        designerType: DesignerComponentType,
        depthIndex: number,
        depth: number
      ): WorkspaceNode => {
        const def = getDefinition(designerType);
        const size = parseSizeFromStyle(inputNode);
        const inline = isRecord(inputNode.style?.inline) ? (inputNode.style?.inline as Record<string, unknown>) : undefined;
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

        const resolvedLayout =
          designerType === 'document' ||
          designerType === 'page' ||
          designerType === 'section' ||
          designerType === 'container'
            ? layoutFromInline ?? defaultContainerLayout
            : undefined;

        const resolvedSize = {
          width: Number.isFinite(size.width) ? size.width : def?.defaultSize.width ?? 220,
          height: Number.isFinite(size.height) ? size.height : def?.defaultSize.height ?? 56,
        };

        const resolvedPosition = isFixedFrame
          ? { x: 0, y: 0 }
          : depth <= 1
            ? { x: 0, y: 0 }
            : { x: 24, y: 24 + depthIndex * (resolvedSize.height + 12) };

        return {
          id: inputNode.id,
          type: designerType,
          props: {
            name: inputNode.id,
            metadata: { ...(def?.defaultMetadata ?? {}) },
            layout: resolvedLayout,
            style: styleFromInline,
            size: resolvedSize,
            position: resolvedPosition,
          },
          children: [],
        };
      };

      const importAstNode = (
        inputNode: InvoiceTemplateNode,
        parent: WorkspaceNode,
        astInput: InvoiceTemplateAst,
        depthIndex: number,
        depth: number
      ) => {
        const typeMap: Partial<Record<InvoiceTemplateNode['type'], DesignerComponentType>> = {
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

        const designerType = typeMap[inputNode.type];
        if (!designerType) return;

        const nextNode = buildWorkspaceNode(inputNode, designerType, depthIndex, depth);

        const props = isRecord(nextNode.props) ? nextNode.props : {};
        const metadata = isRecord(props.metadata) ? (props.metadata as UnknownRecord) : {};

        if (inputNode.type === 'text') {
          if (inputNode.content.type === 'literal') {
            metadata.text = String(inputNode.content.value ?? '');
            props.name = String(inputNode.content.value ?? inputNode.id);
          }
        } else if (inputNode.type === 'field') {
          const bindingPath =
            astInput.bindings?.values?.[inputNode.binding.bindingId]?.path ??
            astInput.bindings?.collections?.[inputNode.binding.bindingId]?.path ??
            inputNode.binding.bindingId;
          metadata.bindingKey = denormalizeBindingPath(bindingPath);
          if (inputNode.label) {
            metadata.label = inputNode.label;
            props.name = inputNode.label;
          }
        } else if (inputNode.type === 'dynamic-table' || inputNode.type === 'table') {
          const collectionPath =
            astInput.bindings?.collections?.[
              inputNode.type === 'dynamic-table'
                ? inputNode.repeat.sourceBinding.bindingId
                : inputNode.sourceBinding.bindingId
            ]?.path ?? 'items';
          metadata.collectionBindingKey = denormalizeBindingPath(collectionPath);
          metadata.columns = inputNode.columns.map((column) => ({
            id: column.id,
            header: column.header,
            key: column.value.type === 'path' ? `item.${column.value.path}` : column.id,
          }));
        }

        nextNode.props = {
          ...props,
          metadata,
        };

        nodesById[nextNode.id] = nextNode;
        parent.children.push(nextNode.id);

        const childNodes = inputNode.type === 'section' || inputNode.type === 'stack' ? inputNode.children : [];
        childNodes.forEach((child, index) => importAstNode(child, nextNode, astInput, index, depth + 1));
      };

      const rootChildren = ast.layout.type === 'document' ? ast.layout.children : [ast.layout];
      const childrenToImport =
        astPageSectionCandidate && astPageSectionCandidate.type === 'section'
          ? astPageSectionCandidate.children
          : rootChildren;

      childrenToImport.forEach((child, index) => importAstNode(child, pageNode, ast, index, 0));

      return nodesById;
    })(),
    snapToGrid: true,
    gridSize: 8,
    showGuides: true,
    showRulers: true,
    canvasScale: 1,
  };
};
