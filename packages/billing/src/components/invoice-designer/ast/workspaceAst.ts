import type {
  InvoiceTemplateAst,
  InvoiceTemplateNode,
  InvoiceTemplateNodeStyleRef,
  InvoiceTemplateTableColumn,
  InvoiceTemplateTotalsRow,
  InvoiceTemplateValueExpression,
  InvoiceTemplateValueFormat,
} from '@alga-psa/types';
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

const isInvoiceTemplateValueFormat = (value: unknown): value is InvoiceTemplateValueFormat =>
  value === 'text' || value === 'number' || value === 'currency' || value === 'date';

const parseInvoiceTemplateValueFormat = (value: unknown): InvoiceTemplateValueFormat | undefined =>
  isInvoiceTemplateValueFormat(value) ? value : undefined;

const isInvoiceTemplateValueExpression = (value: unknown): value is InvoiceTemplateValueExpression => {
  if (!isRecord(value)) {
    return false;
  }

  if (value.type === 'literal') {
    return 'value' in value;
  }
  if (value.type === 'binding') {
    return typeof value.bindingId === 'string';
  }
  if (value.type === 'path') {
    return typeof value.path === 'string';
  }
  if (value.type === 'template') {
    return typeof value.template === 'string';
  }
  return false;
};

const resolveExpressionPreviewText = (
  expression: InvoiceTemplateValueExpression,
  astInput: InvoiceTemplateAst
): string => {
  if (expression.type === 'literal') {
    return String(expression.value ?? '');
  }
  if (expression.type === 'binding') {
    const bindingPath =
      astInput.bindings?.values?.[expression.bindingId]?.path ??
      astInput.bindings?.collections?.[expression.bindingId]?.path ??
      expression.bindingId;
    return `{{${denormalizeBindingPath(bindingPath)}}}`;
  }
  if (expression.type === 'path') {
    return `{{${denormalizeBindingPath(expression.path)}}}`;
  }
  return expression.template;
};

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

const hasInlineLayoutKeys = (inline: Record<string, unknown> | undefined): boolean => {
  if (!inline) return false;
  return (
    inline.display !== undefined ||
    inline.flexDirection !== undefined ||
    inline.justifyContent !== undefined ||
    inline.alignItems !== undefined ||
    inline.gap !== undefined ||
    inline.padding !== undefined ||
    inline.gridTemplateColumns !== undefined ||
    inline.gridTemplateRows !== undefined ||
    inline.gridAutoFlow !== undefined
  );
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
  const kindSpecificFallback =
    asTrimmedString(metadata.title) ||
    asTrimmedString(metadata.signerLabel) ||
    asTrimmedString(metadata.placeholder);
  return (
    asTrimmedString(metadata.text) ||
    asTrimmedString(metadata.label) ||
    asTrimmedString(metadata.content) ||
    kindSpecificFallback
  );
};

const resolveTextNodeContentExpression = (node: WorkspaceNode): InvoiceTemplateValueExpression => {
  const metadata = getWorkspaceNodeMetadata(node);
  const currentText = resolveNodeTextContent(node);
  const preservedExpression = isInvoiceTemplateValueExpression(metadata.astContentExpression)
    ? metadata.astContentExpression
    : null;

  if (!preservedExpression) {
    return { type: 'literal', value: currentText };
  }

  const importedPreviewText = asTrimmedString(metadata.__astContentPreviewText);
  if (importedPreviewText.length > 0) {
    return currentText === importedPreviewText
      ? preservedExpression
      : { type: 'literal', value: currentText };
  }

  if (preservedExpression.type === 'literal') {
    const preservedLiteral = asTrimmedString(preservedExpression.value);
    return currentText === preservedLiteral
      ? preservedExpression
      : { type: 'literal', value: currentText };
  }

  return preservedExpression;
};

const createNodeStyle = (node: WorkspaceNode): InvoiceTemplateNode['style'] | undefined => {
  const inline: Record<string, unknown> = {};
  const style = getWorkspaceNodeStyle(node);
  const metadata = getWorkspaceNodeMetadata(node);
  const layout = getWorkspaceNodeLayout(node);
  const props = isRecord(node.props) ? node.props : {};
  const sizeFromProps = isRecord(props.size) ? (props.size as UnknownRecord) : null;
  const widthFromSize = sizeFromProps && typeof sizeFromProps.width === 'number' ? `${sizeFromProps.width}px` : undefined;
  const heightFromSize = sizeFromProps && typeof sizeFromProps.height === 'number' ? `${sizeFromProps.height}px` : undefined;
  const astImported = metadata.__astImported === true;
  const astHadWidth = metadata.__astHadWidth === true;
  const astHadHeight = metadata.__astHadHeight === true;
  const astHadLayout = metadata.__astHadLayout === true;
  const styleTokenIds = Array.isArray(metadata.__astStyleTokenIds)
    ? metadata.__astStyleTokenIds.filter((tokenId: unknown): tokenId is string => typeof tokenId === 'string' && tokenId.trim().length > 0)
    : [];

  if (style.width) {
    inline.width = style.width;
  } else if (!astImported || astHadWidth) {
    if (widthFromSize) {
      inline.width = widthFromSize;
    }
  }

  if (style.height) {
    inline.height = style.height;
  } else if (!astImported || astHadHeight) {
    if (heightFromSize) {
      inline.height = heightFromSize;
    }
  }

  if (style.minWidth) inline.minWidth = style.minWidth;
  if (style.minHeight) inline.minHeight = style.minHeight;
  if (style.maxWidth) inline.maxWidth = style.maxWidth;
  if (style.maxHeight) inline.maxHeight = style.maxHeight;

  if (typeof style.flexGrow === 'number') inline.flexGrow = style.flexGrow;
  if (typeof style.flexShrink === 'number') inline.flexShrink = style.flexShrink;
  if (style.flexBasis) inline.flexBasis = style.flexBasis;

  if (style.aspectRatio) inline.aspectRatio = style.aspectRatio;
  if (style.objectFit) inline.objectFit = style.objectFit;
  if (style.margin) inline.margin = style.margin;
  if (style.border) inline.border = style.border;
  if (style.borderRadius) inline.borderRadius = style.borderRadius;
  if (style.color) inline.color = style.color;
  if (style.backgroundColor) inline.backgroundColor = style.backgroundColor;
  if (style.fontSize) inline.fontSize = style.fontSize;
  if (style.fontWeight !== undefined) inline.fontWeight = style.fontWeight;
  if (style.fontFamily) inline.fontFamily = style.fontFamily;
  if (style.lineHeight !== undefined) inline.lineHeight = style.lineHeight;
  if (style.textAlign) inline.textAlign = style.textAlign;
  if (style.display) inline.display = style.display;
  if (style.flexDirection) inline.flexDirection = style.flexDirection;
  if (style.justifyContent) inline.justifyContent = style.justifyContent;
  if (style.alignItems) inline.alignItems = style.alignItems;
  if (style.gap) inline.gap = style.gap;
  if (style.padding) inline.padding = style.padding;
  if (style.gridTemplateColumns) inline.gridTemplateColumns = style.gridTemplateColumns;
  if (style.gridTemplateRows) inline.gridTemplateRows = style.gridTemplateRows;
  if (style.gridAutoFlow) inline.gridAutoFlow = style.gridAutoFlow;

  if (layout && (!astImported || astHadLayout)) {
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

  const styleRef: NonNullable<InvoiceTemplateNode['style']> = {};
  if (styleTokenIds.length > 0) {
    styleRef.tokenIds = styleTokenIds;
  }
  if (Object.keys(inline).length > 0) {
    styleRef.inline = inline;
  }

  return Object.keys(styleRef).length > 0 ? styleRef : undefined;
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

const coerceString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const coerceNumberish = (value: unknown): string | number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
};

const coerceObjectFit = (value: unknown): DesignerNodeStyle['objectFit'] | undefined => {
  if (value === 'contain' || value === 'cover' || value === 'fill' || value === 'none' || value === 'scale-down') {
    return value;
  }
  return undefined;
};

const coerceTextAlign = (value: unknown): DesignerNodeStyle['textAlign'] | undefined => {
  if (value === 'left' || value === 'center' || value === 'right' || value === 'justify') {
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
  inline: Record<string, unknown> | undefined,
  preferredDirection?: 'row' | 'column'
): DesignerContainerLayout | undefined => {
  if (!inline) {
    if (!preferredDirection) {
      return undefined;
    }
    return {
      display: 'flex',
      flexDirection: preferredDirection,
      justifyContent: undefined,
      alignItems: undefined,
      gap: undefined,
      padding: undefined,
    };
  }
  const inferredFlexDisplay =
    preferredDirection !== undefined ||
    inline.gap !== undefined ||
    inline.padding !== undefined ||
    inline.justifyContent !== undefined ||
    inline.alignItems !== undefined ||
    inline.flexDirection !== undefined;
  const display =
    inline.display === 'flex' || inline.display === 'grid'
      ? inline.display
      : inferredFlexDisplay
        ? 'flex'
        : undefined;
  if (!display) return undefined;

  const gap = coerceCssLength(inline.gap);
  const padding = coerceCssLength(inline.padding);

  if (display === 'flex') {
    const flexDirection =
      inline.flexDirection === 'row' || inline.flexDirection === 'column'
        ? inline.flexDirection
        : preferredDirection;
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

  const margin = coerceCssLength(inline.margin);
  if (margin) style.margin = margin;

  const border = coerceString(inline.border);
  if (border) style.border = border;

  const borderRadius = coerceCssLength(inline.borderRadius);
  if (borderRadius) style.borderRadius = borderRadius;

  const color = coerceString(inline.color);
  if (color) style.color = color;

  const backgroundColor = coerceString(inline.backgroundColor);
  if (backgroundColor) style.backgroundColor = backgroundColor;

  const fontSize = coerceCssLength(inline.fontSize);
  if (fontSize) style.fontSize = fontSize;

  const fontWeight = coerceNumberish(inline.fontWeight);
  if (fontWeight !== undefined) style.fontWeight = fontWeight;

  const fontFamily = coerceString(inline.fontFamily);
  if (fontFamily) style.fontFamily = fontFamily;

  const lineHeight = coerceNumberish(inline.lineHeight);
  if (lineHeight !== undefined) style.lineHeight = lineHeight;

  const textAlign = coerceTextAlign(inline.textAlign);
  if (textAlign) style.textAlign = textAlign;

  const display = inline.display === 'flex' || inline.display === 'grid' ? inline.display : undefined;
  if (display) style.display = display;

  const flexDirection =
    inline.flexDirection === 'row' || inline.flexDirection === 'column' ? inline.flexDirection : undefined;
  if (flexDirection) style.flexDirection = flexDirection;

  const justifyContent = coerceJustifyContent(inline.justifyContent);
  if (justifyContent) style.justifyContent = justifyContent;

  const alignItems = coerceAlignItems(inline.alignItems);
  if (alignItems) style.alignItems = alignItems;

  const gap = coerceCssLength(inline.gap);
  if (gap) style.gap = gap;

  const padding = coerceCssLength(inline.padding);
  if (padding) style.padding = padding;

  const gridTemplateColumns = coerceString(inline.gridTemplateColumns);
  if (gridTemplateColumns) style.gridTemplateColumns = gridTemplateColumns;

  const gridTemplateRows = coerceString(inline.gridTemplateRows);
  if (gridTemplateRows) style.gridTemplateRows = gridTemplateRows;

  const gridAutoFlow = coerceGridAutoFlow(inline.gridAutoFlow);
  if (gridAutoFlow) style.gridAutoFlow = gridAutoFlow;

  return Object.keys(style).length > 0 ? style : undefined;
};

const mapTableColumns = (node: WorkspaceNode): InvoiceTemplateTableColumn[] => {
  const metadata = getWorkspaceNodeMetadata(node);
  const columns = Array.isArray(metadata.columns) ? metadata.columns : [];

  const mapColumnStyle = (value: unknown): InvoiceTemplateNodeStyleRef | undefined => {
    if (!isRecord(value)) {
      return undefined;
    }

    const mapped: InvoiceTemplateNodeStyleRef = {};

    if (Array.isArray(value.tokenIds)) {
      const tokenIds = value.tokenIds.filter(
        (tokenId: unknown): tokenId is string => typeof tokenId === 'string' && tokenId.trim().length > 0
      );
      if (tokenIds.length > 0) {
        mapped.tokenIds = tokenIds;
      }
    }

    if (isRecord(value.inline)) {
      mapped.inline = { ...(value.inline as Record<string, unknown>) };
    }

    return Object.keys(mapped).length > 0 ? mapped : undefined;
  };

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
      const preservedExpression = isInvoiceTemplateValueExpression(column.valueExpression)
        ? column.valueExpression
        : null;
      const parsedFormat = parseInvoiceTemplateValueFormat(column.format ?? column.type);

      const mapped: InvoiceTemplateTableColumn = {
        id: sanitizeId(id),
        header: header.length > 0 ? header : undefined,
        value: preservedExpression ?? { type: 'path', path: key.length > 0 ? key : 'description' },
      };
      const style = mapColumnStyle(column.style);
      if (style) {
        mapped.style = style;
      }
      if (parsedFormat) {
        mapped.format = parsedFormat;
      }
      return mapped;
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

const getAstNodeId = (node: WorkspaceNode): string => {
  const metadata = getWorkspaceNodeMetadata(node);
  const originalId = asTrimmedString(metadata.__astOriginalNodeId);
  return originalId.length > 0 ? originalId : node.id;
};

const createBaseNode = (node: WorkspaceNode): Pick<InvoiceTemplateNode, 'id' | 'style'> => ({
  id: getAstNodeId(node),
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
    case 'document': {
      const mappedChildren: InvoiceTemplateNode[] = [];
      for (const childId of node.children) {
        const childNode = nodesById.get(childId);
        if (!childNode) continue;
        const mappedChild = mapDesignerNodeToAstNode(childNode, nodesById, registerValueBinding, registerCollectionBinding);
        if (!mappedChild) continue;

        const childMetadata = getWorkspaceNodeMetadata(childNode);
        const isSyntheticPage =
          childNode.type === 'page' &&
          childMetadata.__astSyntheticPage === true &&
          mappedChild.type === 'section';

        if (isSyntheticPage) {
          mappedChildren.push(...mappedChild.children);
        } else {
          mappedChildren.push(mappedChild);
        }
      }

      return {
        ...createBaseNode(node),
        type: 'document',
        children: mappedChildren,
      };
    }
    case 'page':
    case 'section':
    case 'column':
      {
        const metadata = getWorkspaceNodeMetadata(node);
        const explicitTitle = asTrimmedString(metadata.title);
      return {
        ...createBaseNode(node),
        type: 'section',
        title: node.type === 'section' && explicitTitle.length > 0 ? explicitTitle : undefined,
        children,
      };
      }
	    case 'container':
	      {
	        const layout = getWorkspaceNodeLayout(node);
	        const direction =
	          layout?.display === 'flex'
	            ? layout.flexDirection === 'row'
	              ? 'row'
	              : 'column'
	            : undefined;
	        return {
	          ...createBaseNode(node),
	          type: 'stack',
	          direction,
	          children,
	        };
	      }
    case 'text':
    case 'label': {
      return {
        ...createBaseNode(node),
        type: 'text',
        content: resolveTextNodeContentExpression(node),
      };
    }
    case 'field':
    case 'subtotal':
    case 'tax':
    case 'discount':
    case 'custom-total': {
      const metadata = getWorkspaceNodeMetadata(node);
      const bindingPath = resolveFieldBindingPath(node);
      const bindingId = registerValueBinding(bindingPath);
      const explicitLabel = asTrimmedString(metadata.label);
      const format = parseInvoiceTemplateValueFormat(metadata.format);
      const astImported = metadata.__astImported === true;
      const hadImportedFormat = metadata.__astFieldHadFormat === true;
      const hadImportedEmptyValue = metadata.__astFieldHadEmptyValue === true;
      const hasExplicitEmptyValue = typeof metadata.emptyValue === 'string';
      const emptyValue = hasExplicitEmptyValue ? asTrimmedString(metadata.emptyValue) : '';
      const mapped: InvoiceTemplateNode = {
        ...createBaseNode(node),
        type: 'field',
        binding: { bindingId },
        label:
          node.type === 'field'
            ? explicitLabel.length > 0
              ? explicitLabel
              : undefined
            : resolveNodeTextContent(node),
      };
      if (hasExplicitEmptyValue) {
        mapped.emptyValue = emptyValue;
      } else if (!astImported || hadImportedEmptyValue) {
        // Designer-authored fields default to empty string; imported templates only retain this when explicitly present.
        mapped.emptyValue = '';
      }
      if (format && (!astImported || hadImportedFormat || format !== 'text')) {
        mapped.format = format;
      }
      return mapped;
    }
    case 'table':
    case 'dynamic-table': {
      const metadata = getWorkspaceNodeMetadata(node);
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
        emptyStateText:
          typeof metadata.emptyStateText === 'string' && metadata.emptyStateText.trim().length > 0
            ? metadata.emptyStateText.trim()
            : undefined,
      };
    }
    case 'totals':
      {
        const metadata = getWorkspaceNodeMetadata(node);
        const sourceBindingPath = resolveCollectionPath(node);
        const rowsSource = Array.isArray(metadata.totalsRows) ? metadata.totalsRows : [];
        const rows: InvoiceTemplateTotalsRow[] =
          rowsSource
            .map((row, index): InvoiceTemplateTotalsRow | null => {
              if (!isRecord(row)) {
                return null;
              }
              const id = asTrimmedString(row.id) || `row-${index + 1}`;
              const label = asTrimmedString(row.label) || id;
              const preservedValue = isInvoiceTemplateValueExpression(row.valueExpression)
                ? row.valueExpression
                : null;
              const valuePath = normalizeInvoiceBindingPath(asTrimmedString(row.valuePath));
              const format = parseInvoiceTemplateValueFormat(row.format ?? row.type);
              const mappedRow: InvoiceTemplateTotalsRow = {
                id: sanitizeId(id),
                label,
                value: preservedValue ?? { type: 'path', path: valuePath.length > 0 ? valuePath : 'total' },
              };
              if (format) {
                mappedRow.format = format;
              }
              if (row.emphasize === true) {
                mappedRow.emphasize = true;
              }
              return mappedRow;
            })
            .filter((row): row is InvoiceTemplateTotalsRow => Boolean(row));

        return {
          ...createBaseNode(node),
          type: 'totals',
          sourceBinding: { bindingId: registerCollectionBinding(sourceBindingPath) },
          rows:
            rows.length > 0
              ? rows
              : [
                  { id: 'subtotal', label: 'Subtotal', value: { type: 'path', path: 'subtotal' }, format: 'currency' },
                  { id: 'tax', label: 'Tax', value: { type: 'path', path: 'tax' }, format: 'currency' },
                  {
                    id: 'total',
                    label: 'Total',
                    value: { type: 'path', path: 'total' },
                    format: 'currency',
                    emphasize: true,
                  },
                ],
        };
      }
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
      const alt = asTrimmedString(metadata.alt);
      const preservedSrcExpression = isInvoiceTemplateValueExpression(metadata.astSrcExpression)
        ? metadata.astSrcExpression
        : null;
      const preservedAltExpression = isInvoiceTemplateValueExpression(metadata.astAltExpression)
        ? metadata.astAltExpression
        : null;
      return {
        ...createBaseNode(node),
        type: 'image',
        src: preservedSrcExpression ?? { type: 'literal', value: src },
        alt: preservedAltExpression ?? { type: 'literal', value: alt },
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
  const rootMetadata = root ? getWorkspaceNodeMetadata(root) : {};
  const importedBindings = isRecord(rootMetadata.__astBindingCatalog)
    ? (rootMetadata.__astBindingCatalog as UnknownRecord)
    : null;
  const importedValueBindings = importedBindings && isRecord(importedBindings.values)
    ? (importedBindings.values as UnknownRecord)
    : null;
  const importedCollectionBindings = importedBindings && isRecord(importedBindings.collections)
    ? (importedBindings.collections as UnknownRecord)
    : null;

  const valueBindings: Record<string, { id: string; kind: 'value'; path: string; fallback?: unknown }> = {};
  const collectionBindings: Record<string, { id: string; kind: 'collection'; path: string }> = {};

  if (importedValueBindings) {
    for (const [bindingId, binding] of Object.entries(importedValueBindings)) {
      if (!isRecord(binding)) continue;
      if (binding.kind !== 'value') continue;
      if (typeof binding.path !== 'string') continue;
      valueBindings[bindingId] = {
        id: typeof binding.id === 'string' && binding.id.trim().length > 0 ? binding.id : bindingId,
        kind: 'value',
        path: binding.path,
        ...(Object.prototype.hasOwnProperty.call(binding, 'fallback') ? { fallback: binding.fallback } : {}),
      };
    }
  }

  if (importedCollectionBindings) {
    for (const [bindingId, binding] of Object.entries(importedCollectionBindings)) {
      if (!isRecord(binding)) continue;
      if (binding.kind !== 'collection') continue;
      if (typeof binding.path !== 'string') continue;
      collectionBindings[bindingId] = {
        id: typeof binding.id === 'string' && binding.id.trim().length > 0 ? binding.id : bindingId,
        kind: 'collection',
        path: binding.path,
      };
    }
  }

  const valueBindingPathToId = new Map<string, string>();
  for (const [bindingId, binding] of Object.entries(valueBindings)) {
    if (!valueBindingPathToId.has(binding.path)) {
      valueBindingPathToId.set(binding.path, bindingId);
    }
  }

  const collectionBindingPathToId = new Map<string, string>();
  for (const [bindingId, binding] of Object.entries(collectionBindings)) {
    if (!collectionBindingPathToId.has(binding.path)) {
      collectionBindingPathToId.set(binding.path, bindingId);
    }
  }

  const createUniqueBindingId = (
    preferredId: string,
    registry: Record<string, { id: string; kind: 'value' | 'collection'; path: string; fallback?: unknown }>
  ): string => {
    if (!registry[preferredId]) {
      return preferredId;
    }
    let index = 2;
    while (registry[`${preferredId}_${index}`]) {
      index += 1;
    }
    return `${preferredId}_${index}`;
  };

  const registerValueBinding = (path: string): string => {
    const normalizedPath = normalizeInvoiceBindingPath(path);
    const existingBindingId = valueBindingPathToId.get(normalizedPath);
    if (existingBindingId) {
      return existingBindingId;
    }
    const preferredBindingId = sanitizeId(`value.${normalizedPath}`) || `value.${Object.keys(valueBindings).length + 1}`;
    const bindingId = createUniqueBindingId(preferredBindingId, valueBindings);
    if (!valueBindings[bindingId]) {
      valueBindings[bindingId] = {
        id: bindingId,
        kind: 'value',
        path: normalizedPath,
      };
    }
    valueBindingPathToId.set(normalizedPath, bindingId);
    return bindingId;
  };

  const registerCollectionBinding = (path: string): string => {
    const normalizedPath = normalizeInvoiceBindingPath(path);
    const existingBindingId = collectionBindingPathToId.get(normalizedPath);
    if (existingBindingId) {
      return existingBindingId;
    }
    const preferredBindingId =
      sanitizeId(`collection.${normalizedPath}`) || `collection.${Object.keys(collectionBindings).length + 1}`;
    const bindingId = createUniqueBindingId(preferredBindingId, collectionBindings);
    if (!collectionBindings[bindingId]) {
      collectionBindings[bindingId] = {
        id: bindingId,
        kind: 'collection',
        path: normalizedPath,
      };
    }
    collectionBindingPathToId.set(normalizedPath, bindingId);
    return bindingId;
  };

  const layout = root
    ? mapDesignerNodeToAstNode(root, nodesById, registerValueBinding, registerCollectionBinding)
    : null;

  return {
    kind: 'invoice-template-ast',
    version: INVOICE_TEMPLATE_AST_VERSION,
    metadata: isRecord(rootMetadata.__astTemplateMetadata)
      ? ({ ...(rootMetadata.__astTemplateMetadata as Record<string, unknown>) } as InvoiceTemplateAst['metadata'])
      : undefined,
    styles: isRecord(rootMetadata.__astStyleCatalog)
      ? ({ ...(rootMetadata.__astStyleCatalog as Record<string, unknown>) } as InvoiceTemplateAst['styles'])
      : undefined,
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

const parseSizeFromStyle = (node: InvoiceTemplateNode): { width?: number; height?: number } => {
  const inline = node.style?.inline ?? {};
  const parse = (value: unknown): number | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(1, value);
    }
    if (typeof value === 'string') {
      const numeric = Number.parseFloat(value.replace('px', '').trim());
      if (Number.isFinite(numeric)) {
        return Math.max(1, numeric);
      }
    }
    return undefined;
  };
  return {
    width: parse(inline.width),
    height: parse(inline.height),
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
          metadata: {
            __astImported: true,
            __astOriginalNodeId: astDocument?.id ?? DOCUMENT_NODE_ID,
            __astHadWidth: Boolean(documentInline && Object.prototype.hasOwnProperty.call(documentInline, 'width')),
            __astHadHeight: Boolean(documentInline && Object.prototype.hasOwnProperty.call(documentInline, 'height')),
            __astHadLayout: hasInlineLayoutKeys(documentInline),
            __astBindingCatalog: ast.bindings ?? undefined,
            __astStyleCatalog: ast.styles ?? undefined,
            __astTemplateMetadata: ast.metadata ?? undefined,
          },
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
          metadata: {
            __astImported: true,
            __astSyntheticPage: !astPageSectionCandidate,
            __astOriginalNodeId: astPageSectionCandidate?.id ?? '',
            __astHadWidth: Boolean(pageSectionInline && Object.prototype.hasOwnProperty.call(pageSectionInline, 'width')),
            __astHadHeight: Boolean(pageSectionInline && Object.prototype.hasOwnProperty.call(pageSectionInline, 'height')),
            __astHadLayout: hasInlineLayoutKeys(pageSectionInline),
          },
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
        const preferredDirection = inputNode.type === 'stack' ? inputNode.direction : undefined;
        const layoutFromInline = coerceContainerLayoutFromInlineStyle(inline, preferredDirection);

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

        const parsedWidth = typeof size.width === 'number' && Number.isFinite(size.width) ? size.width : undefined;
        const parsedHeight = typeof size.height === 'number' && Number.isFinite(size.height) ? size.height : undefined;
        const resolvedSize = {
          width: parsedWidth ?? def?.defaultSize.width ?? 220,
          height: parsedHeight ?? def?.defaultSize.height ?? 56,
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
        const inline = isRecord(inputNode.style?.inline) ? (inputNode.style.inline as Record<string, unknown>) : undefined;
        metadata.__astImported = true;
        metadata.__astOriginalNodeId = inputNode.id;
        metadata.__astHadWidth = Boolean(inline && Object.prototype.hasOwnProperty.call(inline, 'width'));
        metadata.__astHadHeight = Boolean(inline && Object.prototype.hasOwnProperty.call(inline, 'height'));
        metadata.__astHadLayout = hasInlineLayoutKeys(inline);
        metadata.__astStyleTokenIds = Array.isArray(inputNode.style?.tokenIds)
          ? inputNode.style.tokenIds.filter((tokenId): tokenId is string => typeof tokenId === 'string' && tokenId.trim().length > 0)
          : undefined;

        if (inputNode.type === 'text') {
          metadata.astContentExpression = inputNode.content;
          const resolvedText = resolveExpressionPreviewText(inputNode.content, astInput);
          metadata.text = resolvedText;
          metadata.__astContentPreviewText = resolvedText;
        } else if (inputNode.type === 'field') {
          const bindingPath =
            astInput.bindings?.values?.[inputNode.binding.bindingId]?.path ??
            astInput.bindings?.collections?.[inputNode.binding.bindingId]?.path ??
            inputNode.binding.bindingId;
          metadata.bindingKey = denormalizeBindingPath(bindingPath);
          metadata.__astFieldHadFormat = Object.prototype.hasOwnProperty.call(inputNode, 'format');
          metadata.__astFieldHadEmptyValue = Object.prototype.hasOwnProperty.call(inputNode, 'emptyValue');
          if (inputNode.format) {
            metadata.format = inputNode.format;
          }
          if (inputNode.label) {
            metadata.label = inputNode.label;
          }
          if (typeof inputNode.emptyValue === 'string') {
            metadata.emptyValue = inputNode.emptyValue;
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
            valueExpression: column.value,
            type: column.format,
            format: column.format,
            style: column.style ? ({ ...column.style } as Record<string, unknown>) : undefined,
          }));
          if (typeof inputNode.emptyStateText === 'string' && inputNode.emptyStateText.trim().length > 0) {
            metadata.emptyStateText = inputNode.emptyStateText.trim();
          }
        } else if (inputNode.type === 'totals') {
          const sourcePath =
            astInput.bindings?.collections?.[inputNode.sourceBinding.bindingId]?.path ??
            inputNode.sourceBinding.bindingId;
          metadata.collectionBindingKey = denormalizeBindingPath(sourcePath);
          metadata.totalsRows = inputNode.rows.map((row) => ({
            id: row.id,
            label: row.label,
            valueExpression: row.value,
            valuePath: row.value.type === 'path' ? row.value.path : '',
            type: row.format,
            format: row.format,
            emphasize: row.emphasize === true,
          }));
        } else if (inputNode.type === 'image') {
          metadata.astSrcExpression = inputNode.src;
          if (inputNode.src.type === 'literal') {
            metadata.src = String(inputNode.src.value ?? '');
          }
          if (inputNode.alt) {
            metadata.astAltExpression = inputNode.alt;
            if (inputNode.alt.type === 'literal') {
              metadata.alt = String(inputNode.alt.value ?? '');
            }
          }
        } else if (inputNode.type === 'section') {
          if (typeof inputNode.title === 'string' && inputNode.title.trim().length > 0) {
            metadata.title = inputNode.title;
          }
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
