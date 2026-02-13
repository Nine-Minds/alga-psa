import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

import {
  deleteNode as patchDeleteNode,
  insertChild as patchInsertChild,
  moveNode as patchMoveNode,
  removeChild as patchRemoveChild,
  setNodeProp as patchSetNodeProp,
  unsetNodeProp as patchUnsetNodeProp,
} from './patchOps';
import { getPresetById, LegacyLayoutPresetLayout } from '../constants/presets';
import { DESIGNER_CANVAS_BOUNDS } from '../constants/layout';
import {
  canNestWithinParent,
  getAllowedChildrenForType,
  getAllowedParentsForType,
  getComponentSchema,
} from '../schema/componentSchema';

export type DesignerComponentType =
  | 'document'
  | 'page'
  | 'section'
  | 'column'
  | 'text'
  | 'totals'
  | 'table'
  | 'field'
  | 'label'
  | 'subtotal'
  | 'tax'
  | 'discount'
  | 'custom-total'
  | 'image'
  | 'logo'
  | 'qr'
  | 'dynamic-table'
  | 'signature'
  | 'action-button'
  | 'attachment-list'
  | 'divider'
  | 'spacer'
  | 'container';

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export type CssLength = string;

export type CssJustifyContent =
  | 'flex-start'
  | 'center'
  | 'flex-end'
  | 'space-between'
  | 'space-around'
  | 'space-evenly';

export type CssAlignItems = 'flex-start' | 'center' | 'flex-end' | 'stretch';

export type CssGridAutoFlow = 'row' | 'column' | 'dense' | 'row dense' | 'column dense';

export interface DesignerContainerLayout {
  display: 'flex' | 'grid';

  // Flex
  flexDirection?: 'row' | 'column';
  justifyContent?: CssJustifyContent;
  alignItems?: CssAlignItems;

  // Grid
  gridTemplateColumns?: string;
  gridTemplateRows?: string;
  gridAutoFlow?: CssGridAutoFlow;

  // Shared
  gap?: CssLength;
  padding?: CssLength;
}

export interface DesignerNodeStyle {
  width?: CssLength;
  height?: CssLength;
  minWidth?: CssLength;
  minHeight?: CssLength;
  maxWidth?: CssLength;
  maxHeight?: CssLength;

  // Flex item
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: CssLength;

  // Media
  aspectRatio?: string; // e.g. '16 / 9', '1'
  objectFit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
}

export interface DesignerNode {
  id: string;
  type: DesignerComponentType;
  name: string;

  // Unified props container (cutover in progress). Canvas/render code should prefer this.
  props: Record<string, unknown>;

  // Legacy geometry fields kept during cutover. Drag-drop cutover will stop persisting coordinates.
  position: Point;
  size: Size;
  baseSize?: Size;

  canRotate?: boolean;
  rotation?: number;
  allowResize?: boolean;

  metadata?: Record<string, unknown>;
  layoutPresetId?: string;

  parentId: string | null;

  // Unified hierarchy (cutover in progress). This should become the only authoritative hierarchy.
  children: string[];
  childIds: string[];
  allowedChildren: DesignerComponentType[];

  // CSS-like layout. Applies to containers.
  layout?: DesignerContainerLayout;

  // CSS-like sizing/media/item props.
  style?: DesignerNodeStyle;
}

interface DesignerMetrics {
  totalDrags: number;
  completedDrops: number;
  failedDrops: number;
  totalSelections: number;
}

export interface DesignerWorkspaceSnapshot {
  rootId: string;
  nodesById: Record<string, { id: string; type: DesignerComponentType; props: Record<string, unknown>; children: string[] }>;
  snapToGrid: boolean;
  gridSize: number;
  showGuides: boolean;
  showRulers: boolean;
  canvasScale: number;
}

interface DesignerState {
  // Canonical tree index (cutover in progress): nodesById + rootId.
  // The legacy `nodes` array remains during migration but is always kept in sync.
  rootId: string;
  nodesById: Record<string, DesignerNode>;
  nodes: DesignerNode[];
  selectedNodeId: string | null;
  hoverNodeId: string | null;
  snapToGrid: boolean;
  gridSize: number;
  showGuides: boolean;
  showRulers: boolean;
  canvasScale: number;
  metrics: DesignerMetrics;
  history: DesignerHistoryEntry[];
  historyIndex: number;

  addNodeFromPalette: (
    type: DesignerComponentType,
    dropPoint: Point,
    options?: { defaults?: Partial<DesignerNode>; parentId?: string }
  ) => void;
  insertPreset: (presetId: string, dropPoint?: Point, parentId?: string) => void;
  // Generic patch API (primary path going forward).
  setNodeProp: (nodeId: string, path: string, value: unknown, commit?: boolean) => void;
  unsetNodeProp: (nodeId: string, path: string, commit?: boolean) => void;
  insertChild: (parentId: string, childId: string, index: number) => void;
  removeChild: (parentId: string, childId: string) => void;
  moveNode: (nodeId: string, nextParentId: string, nextIndex: number) => void;
  deleteNode: (nodeId: string) => void;
  selectNode: (id: string | null) => void;
  setHoverNode: (id: string | null) => void;
  deleteSelectedNode: () => void;
  toggleSnap: () => void;
  setGridSize: (size: number) => void;
  setCanvasScale: (scale: number) => void;
  toggleGuides: () => void;
  toggleRulers: () => void;
  undo: () => void;
  redo: () => void;
  resetWorkspace: () => void;
  loadNodes: (nodes: DesignerNode[]) => void;
  loadWorkspace: (
    workspace: Partial<DesignerWorkspaceSnapshot> &
      Pick<DesignerWorkspaceSnapshot, 'nodesById'> &
      Partial<Pick<DesignerWorkspaceSnapshot, 'rootId'>>
  ) => void;
  exportWorkspace: () => DesignerWorkspaceSnapshot;
  recordDropResult: (success: boolean) => void;
}

type DesignerHistoryEntry = {
  nodes: DesignerNode[];
};

const MAX_HISTORY_LENGTH = 50;
const DEFAULT_SIZE: Size = { width: 160, height: 64 };
export const DOCUMENT_NODE_ID = 'designer-document-root';
const DEFAULT_PAGE_NODE_ID = 'designer-page-default';

const generateId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const deepCloneJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const syncLegacyFieldsFromProps = (node: DesignerNode): DesignerNode => {
  const props = isPlainObject(node.props) ? node.props : {};

  const nextName = typeof props.name === 'string' ? (props.name as string) : node.name;
  const nextMetadata = isPlainObject(props.metadata) ? (props.metadata as Record<string, unknown>) : node.metadata;
  const nextLayout = isPlainObject(props.layout) ? (props.layout as DesignerContainerLayout) : node.layout;
  const nextStyle = isPlainObject(props.style) ? (props.style as DesignerNodeStyle) : node.style;

  if (nextName === node.name && nextMetadata === node.metadata && nextLayout === node.layout && nextStyle === node.style) {
    return node;
  }

  return {
    ...node,
    name: nextName,
    metadata: nextMetadata,
    layout: nextLayout,
    style: nextStyle,
  };
};

const syncLegacyFieldsFromPropsForNodeId = (nodes: DesignerNode[], nodeId: string): DesignerNode[] => {
  const index = nodes.findIndex((node) => node.id === nodeId);
  if (index < 0) return nodes;
  const node = nodes[index];
  if (!node) return nodes;
  const nextNode = syncLegacyFieldsFromProps(node);
  if (nextNode === node) return nodes;
  const copy = nodes.slice();
  copy[index] = nextNode;
  return copy;
};

const sanitizePersistedNodeProps = (props: Record<string, unknown> | undefined): Record<string, unknown> => {
  // Persist only authored component props. Runtime geometry (position/size) and editor-only hints
  // are intentionally excluded from the persisted workspace format.
  const clone = deepCloneJson(props ?? {});
  delete (clone as { position?: unknown }).position;
  delete (clone as { size?: unknown }).size;
  delete (clone as { baseSize?: unknown }).baseSize;
  delete (clone as { layoutPresetId?: unknown }).layoutPresetId;
  return clone;
};

type LabelNormalizationKind = 'name' | 'metadata';

const normalizeDesignerPatchPath = (input: string): string => {
  const path = input.trim();
  if (path.startsWith('props.')) return path;

  // During cutover we accept legacy root-level fields but always persist them to canonical `props.*`.
  if (path === 'name') return 'props.name';
  if (path === 'metadata' || path.startsWith('metadata.')) return `props.${path}`;
  if (path === 'layout' || path.startsWith('layout.')) return `props.${path}`;
  if (path === 'style' || path.startsWith('style.')) return `props.${path}`;

  return path;
};

const resolveLabelNormalizationKind = (path: string): LabelNormalizationKind | null => {
  if (path === 'name' || path === 'props.name') {
    return 'name';
  }
  if (path === 'metadata' || path === 'props.metadata') {
    return 'metadata';
  }
  if (path.startsWith('metadata.') || path.startsWith('props.metadata.')) {
    return 'metadata';
  }
  return null;
};

const normalizeLabelAfterMutation = (
  nodes: DesignerNode[],
  nodeId: string,
  kind: LabelNormalizationKind
): DesignerNode[] => {
  const index = nodes.findIndex((node) => node.id === nodeId);
  if (index < 0) return nodes;
  const node = nodes[index];
  if (!node || node.type !== 'label') return nodes;

  const existingMetadata = (node.metadata ?? {}) as Record<string, unknown>;
  const existingProps = isPlainObject(node.props) ? node.props : {};
  const propsMetadata = isPlainObject(existingProps.metadata) ? (existingProps.metadata as Record<string, unknown>) : {};

  if (kind === 'name') {
    // Name is canonical in `props.name`; legacy `node.name` exists only for back-compat while callsites migrate.
    const nextText =
      typeof existingProps.name === 'string' ? (existingProps.name as string) : typeof node.name === 'string' ? node.name : '';
    const nextMetadata = { ...existingMetadata, ...propsMetadata, text: nextText };
    const nextProps = { ...existingProps, name: nextText, metadata: nextMetadata };
    const nextNode: DesignerNode = { ...node, props: nextProps };
    if (nextNode === node) return nodes;
    const copy = nodes.slice();
    copy[index] = nextNode;
    return copy;
  }

  const mergedMetadata = { ...existingMetadata, ...propsMetadata };
  const candidateText = typeof mergedMetadata.text === 'string' ? mergedMetadata.text.trim() : '';
  const candidateLabel = typeof mergedMetadata.label === 'string' ? mergedMetadata.label.trim() : '';

  if (candidateText) {
    const nextMetadata = { ...mergedMetadata, text: candidateText };
    const nextProps = { ...existingProps, name: candidateText, metadata: nextMetadata };
    const nextNode: DesignerNode = { ...node, props: nextProps };
    const copy = nodes.slice();
    copy[index] = nextNode;
    return copy;
  }

  if (candidateLabel) {
    const nextMetadata = { ...mergedMetadata, text: candidateLabel, label: candidateLabel };
    const nextProps = { ...existingProps, name: candidateLabel, metadata: nextMetadata };
    const nextNode: DesignerNode = { ...node, props: nextProps };
    const copy = nodes.slice();
    copy[index] = nextNode;
    return copy;
  }

  return nodes;
};

const snapshotWorkspaceNodesById = (
  nodes: DesignerNode[]
): DesignerWorkspaceSnapshot['nodesById'] =>
  Object.fromEntries(
    nodes.map((node) => [
      node.id,
      {
        id: node.id,
        type: node.type,
        props: sanitizePersistedNodeProps(node.props),
        children: Array.isArray(node.children) ? node.children.slice() : (node.childIds ?? []).slice(),
      },
    ])
  );

const materializeNodesFromSnapshot = (snapshot: Pick<DesignerWorkspaceSnapshot, 'nodesById' | 'rootId'>): DesignerNode[] => {
  const nodesById = snapshot.nodesById ?? {};
  const rootId = typeof snapshot.rootId === 'string' && snapshot.rootId.length > 0 ? snapshot.rootId : DOCUMENT_NODE_ID;

  const visited = new Set<string>();
  const output: DesignerNode[] = [];

  const coerceChildren = (value: unknown): string[] => (Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []);

  const coercePoint = (value: unknown): Point | undefined => {
    if (!isPlainObject(value)) return undefined;
    const x = value.x;
    const y = value.y;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    return { x, y };
  };

  const coerceSize = (value: unknown): Size | undefined => {
    if (!isPlainObject(value)) return undefined;
    const width = value.width;
    const height = value.height;
    if (typeof width !== 'number' || typeof height !== 'number') return undefined;
    if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;
    return { width, height };
  };

  const parsePx = (value: unknown): number | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed.endsWith('px')) return undefined;
    const parsed = Number.parseFloat(trimmed.slice(0, -2));
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const dfs = (nodeId: string, parentId: string | null, depth: number, index: number) => {
    if (visited.has(nodeId)) return;
    const snapshotNode = nodesById[nodeId];
    if (!snapshotNode) return;
    visited.add(nodeId);

    const schema = getComponentSchema(snapshotNode.type);
    const rawProps = isPlainObject(snapshotNode.props) ? snapshotNode.props : {};

    const name =
      typeof rawProps.name === 'string'
        ? rawProps.name
        : schema?.defaults.name ?? `${schema?.label ?? snapshotNode.type}`;

    const rawMetadata = isPlainObject(rawProps.metadata) ? (rawProps.metadata as Record<string, unknown>) : {};
    const rawLayout = isPlainObject(rawProps.layout) ? (rawProps.layout as Partial<DesignerContainerLayout>) : undefined;
    const rawStyle = isPlainObject(rawProps.style) ? (rawProps.style as Partial<DesignerNodeStyle>) : undefined;

    const metadata = {
      ...(schema?.defaults.metadata ?? {}),
      ...rawMetadata,
    };

    const layout = rawLayout
      ? {
          ...(schema?.defaults.layout ?? {}),
          ...rawLayout,
        }
      : schema?.defaults.layout;

    const style = {
      ...(schema?.defaults.style ?? {}),
      ...(rawStyle ?? {}),
    };

    const sizeFromProps = coerceSize(rawProps.size);
    const sizeFromStyle = {
      width: parsePx(style.width),
      height: parsePx(style.height),
    };
    const defaultSize = schema?.defaults.size ?? DEFAULT_SIZE;
    const size = clampNodeSizeToPracticalMinimum(snapshotNode.type, {
      width: sizeFromProps?.width ?? sizeFromStyle.width ?? defaultSize.width,
      height: sizeFromProps?.height ?? sizeFromStyle.height ?? defaultSize.height,
    });

    // Keep CSS size in sync with the numeric box size when not explicitly set.
    if (!style.width) style.width = `${Math.round(size.width)}px`;
    if (!style.height) style.height = `${Math.round(size.height)}px`;

    const positionFromProps = coercePoint(rawProps.position);
    const position =
      positionFromProps ??
      (snapshotNode.type === 'document' || snapshotNode.type === 'page'
        ? { x: 0, y: 0 }
        : { x: 24, y: 24 + index * (Math.round(size.height) + 12) + depth * 4 });

    const children = coerceChildren(snapshotNode.children);

    const normalizedProps: Record<string, unknown> = {
      ...rawProps,
      name,
      metadata,
      layout,
      style,
      // Preserve any authored geometry if present; also ensure it's available for runtime.
      position: positionFromProps ?? rawProps.position,
      size: sizeFromProps ?? rawProps.size,
    };

    output.push(
      syncLegacyFieldsFromProps({
        id: snapshotNode.id,
        type: snapshotNode.type,
        name,
        props: normalizedProps,
        position,
        size,
        baseSize: size,
        rotation: 0,
        canRotate: snapshotNode.type !== 'document' && snapshotNode.type !== 'page',
        allowResize: snapshotNode.type !== 'document' && snapshotNode.type !== 'page',
        layoutPresetId:
          typeof (rawProps as { layoutPresetId?: unknown }).layoutPresetId === 'string'
            ? (rawProps as { layoutPresetId: string }).layoutPresetId
            : undefined,
        parentId,
        children,
        childIds: children,
        allowedChildren: getAllowedChildrenForType(snapshotNode.type),
      })
    );

    children.forEach((childId, childIndex) => dfs(childId, snapshotNode.id, depth + 1, childIndex));
  };

  dfs(rootId, null, 0, 0);

  return output;
};

const normalizeDefaultMetadataForNewNode = (
  type: DesignerComponentType,
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  if (!metadata) return undefined;
  const clone = deepCloneJson(metadata);

  if (type === 'table' && Array.isArray((clone as { columns?: unknown }).columns)) {
    (clone as { columns: Array<Record<string, unknown>> }).columns = (
      (clone as { columns: Array<Record<string, unknown>> }).columns ?? []
    ).map((column) => ({
      ...column,
      id: typeof column.id === 'string' && column.id.length > 0 ? `${column.id}-${generateId()}` : generateId(),
    }));
  }

  if (type === 'attachment-list' && Array.isArray((clone as { items?: unknown }).items)) {
    (clone as { items: Array<Record<string, unknown>> }).items = (
      (clone as { items: Array<Record<string, unknown>> }).items ?? []
    ).map((item) => ({
      ...item,
      id: typeof item.id === 'string' && item.id.length > 0 ? `${item.id}-${generateId()}` : generateId(),
    }));
  }

  return clone;
};

const snapToGridValue = (value: number, gridSize: number) => Math.round(value / gridSize) * gridSize;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const indexNodesById = (nodes: DesignerNode[]): Record<string, DesignerNode> =>
  Object.fromEntries(nodes.map((node) => [node.id, node]));

const getPracticalMinimumSizeForType = (type: DesignerComponentType): Size => {
  switch (type) {
    case 'field':
      return { width: 120, height: 40 };
    case 'label':
      return { width: 80, height: 24 };
    case 'text':
      return { width: 120, height: 32 };
    case 'signature':
      return { width: 180, height: 96 };
    case 'action-button':
      return { width: 120, height: 40 };
    case 'attachment-list':
      return { width: 180, height: 96 };
    case 'table':
    case 'dynamic-table':
      return { width: 260, height: 120 };
    case 'totals':
      return { width: 220, height: 96 };
    case 'subtotal':
    case 'tax':
    case 'discount':
    case 'custom-total':
      return { width: 180, height: 40 };
    case 'container':
      return { width: 120, height: 64 };
    case 'section':
      return { width: 160, height: 96 };
    default:
      return { width: 40, height: 24 };
  }
};

export const clampNodeSizeToPracticalMinimum = (type: DesignerComponentType, size: Size): Size => {
  const minimum = getPracticalMinimumSizeForType(type);
  return {
    width: Math.max(minimum.width, size.width),
    height: Math.max(minimum.height, size.height),
  };
};

const isLegacyPresetLayout = (value: unknown): value is LegacyLayoutPresetLayout =>
  typeof value === 'object' && value !== null && 'mode' in (value as Record<string, unknown>);

const mapLegacyPresetLayoutToCss = (layout: LegacyLayoutPresetLayout): DesignerContainerLayout | undefined => {
  if (layout.mode !== 'flex') {
    return undefined;
  }

  const gap = Number.isFinite(layout.gap) ? Math.max(0, layout.gap ?? 0) : 0;
  const padding = Number.isFinite(layout.padding) ? Math.max(0, layout.padding ?? 0) : 0;

  const justifyContent: DesignerContainerLayout['justifyContent'] =
    layout.justify === 'center'
      ? 'center'
      : layout.justify === 'end'
        ? 'flex-end'
        : layout.justify === 'space-between'
          ? 'space-between'
          : 'flex-start';

  const alignItems: DesignerContainerLayout['alignItems'] =
    layout.align === 'center'
      ? 'center'
      : layout.align === 'end'
        ? 'flex-end'
        : layout.align === 'stretch'
          ? 'stretch'
          : 'flex-start';

  return {
    display: 'flex',
    flexDirection: layout.direction === 'row' ? 'row' : 'column',
    gap: `${gap}px`,
    padding: `${padding}px`,
    justifyContent,
    alignItems,
  };
};

const createDocumentNode = (): DesignerNode =>
  syncLegacyFieldsFromProps({
    id: DOCUMENT_NODE_ID,
    type: 'document',
    name: 'Document',
    props: {
      name: 'Document',
      metadata: {},
      layout: {
        display: 'flex',
        flexDirection: 'column',
        gap: '0px',
        padding: '0px',
        justifyContent: 'flex-start',
        alignItems: 'stretch',
      },
      style: {
        width: `${Math.round(DESIGNER_CANVAS_BOUNDS.width)}px`,
        height: `${Math.round(DESIGNER_CANVAS_BOUNDS.height)}px`,
      },
    },
    position: { x: 0, y: 0 },
    size: { width: DESIGNER_CANVAS_BOUNDS.width, height: DESIGNER_CANVAS_BOUNDS.height },
    baseSize: { width: DESIGNER_CANVAS_BOUNDS.width, height: DESIGNER_CANVAS_BOUNDS.height },
    canRotate: false,
    allowResize: false,
    rotation: 0,
    layoutPresetId: undefined,
    parentId: null,
    children: [],
    childIds: [],
    allowedChildren: getAllowedChildrenForType('document'),
  });

const createPageNode = (parentId: string, index = 1): DesignerNode =>
  syncLegacyFieldsFromProps({
    id: `${DEFAULT_PAGE_NODE_ID}-${index}-${generateId()}`,
    type: 'page',
    name: `Page ${index}`,
    props: {
      name: `Page ${index}`,
      metadata: {},
      layout: {
        display: 'flex',
        flexDirection: 'column',
        gap: '32px',
        padding: '40px', // Page margins
        justifyContent: 'flex-start',
        alignItems: 'stretch',
      },
      style: {
        width: `${Math.round(DESIGNER_CANVAS_BOUNDS.width)}px`,
        height: `${Math.round(DESIGNER_CANVAS_BOUNDS.height)}px`,
      },
    },
    position: { x: 0, y: 0 },
    size: { width: DESIGNER_CANVAS_BOUNDS.width, height: DESIGNER_CANVAS_BOUNDS.height },
    baseSize: { width: DESIGNER_CANVAS_BOUNDS.width, height: DESIGNER_CANVAS_BOUNDS.height },
    canRotate: false,
    allowResize: false,
    rotation: 0,
    layoutPresetId: undefined,
    parentId,
    children: [],
    childIds: [],
    allowedChildren: getAllowedChildrenForType('page'),
  });

const createInitialNodes = (): DesignerNode[] => {
  const documentNode = createDocumentNode();
  const pageNode = createPageNode(documentNode.id);
  documentNode.childIds = [pageNode.id];
  documentNode.children = [pageNode.id];
  return [documentNode, pageNode];
};

const attachChildAtIndex = (nodes: DesignerNode[], parentId: string, childId: string, index?: number) =>
  nodes.map((node) => {
    if (node.id !== parentId) return node;
    if (node.childIds.includes(childId)) {
      return node;
    }
    const next = [...node.childIds];
    if (typeof index === 'number' && index >= 0 && index <= next.length) {
      next.splice(index, 0, childId);
    } else {
      next.push(childId);
    }
    return { ...node, childIds: next, children: next };
  });

const detachChild = (nodes: DesignerNode[], parentId: string | null, childId: string) =>
  parentId
    ? nodes.map((node) =>
        node.id === parentId
          ? {
              ...node,
              childIds: node.childIds.filter((id) => id !== childId),
              children: node.children.filter((id) => id !== childId),
            }
          : node
      )
    : nodes;

const collectDescendants = (nodes: DesignerNode[], rootId: string): Set<string> => {
  const map = new Map(nodes.map((node) => [node.id, node]));
  const toRemove = new Set<string>();
  const dfs = (id: string) => {
    toRemove.add(id);
    const node = map.get(id);
    (node?.children ?? node?.childIds ?? []).forEach(dfs);
  };
  dfs(rootId);
  return toRemove;
};

const snapshotNodes = (nodes: DesignerNode[]): DesignerNode[] =>
  nodes.map((node) => {
    const props: Record<string, unknown> = node.props
      ? JSON.parse(JSON.stringify(node.props))
      : {
          name: node.name,
          metadata: node.metadata ?? {},
          layout: node.layout,
          style: node.style,
        };

    const derivedName = typeof props.name === 'string' ? (props.name as string) : node.name;
    const derivedMetadata = isPlainObject(props.metadata) ? (props.metadata as Record<string, unknown>) : node.metadata;
    const derivedLayout = isPlainObject(props.layout) ? (props.layout as DesignerContainerLayout) : node.layout;
    const derivedStyle = isPlainObject(props.style) ? (props.style as DesignerNodeStyle) : node.style;

    return {
      ...node,
      props,
      name: derivedName,
      metadata: derivedMetadata,
      layout: derivedLayout,
      style: derivedStyle,
      position: { ...node.position },
      size: { ...node.size },
      baseSize: node.baseSize ? { ...node.baseSize } : undefined,
      children: [...(node.children ?? node.childIds ?? [])],
      childIds: [...node.childIds],
      allowedChildren: [...node.allowedChildren],
    };
  });

const createHistoryEntry = (nodes: DesignerNode[]): DesignerHistoryEntry => ({
  nodes: snapshotNodes(nodes),
});

const appendHistory = (state: Pick<DesignerState, 'history' | 'historyIndex'>, nodes: DesignerNode[]) => {
  const nextHistory = [...state.history.slice(0, state.historyIndex + 1), createHistoryEntry(nodes)];
  if (nextHistory.length > MAX_HISTORY_LENGTH) {
    nextHistory.shift();
  }
  return {
    history: nextHistory,
    historyIndex: nextHistory.length - 1,
  };
};

export const getAbsolutePosition = (nodeId: string, nodes: DesignerNode[]): Point => {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return { x: 0, y: 0 };

  let current = node;
  let x = current.position.x;
  let y = current.position.y;

  while (current.parentId) {
    const parent = nodes.find((n) => n.id === current.parentId);
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    current = parent;
  }

  return { x, y };
};

export const useInvoiceDesignerStore = create<DesignerState>()(
  devtools((set, get) => {
    const initialNodes = createInitialNodes();

    const setWithIndex: typeof set = (partial, replace, action) =>
      set((state) => {
        const nextPartial = typeof partial === 'function' ? partial(state) : partial;
        if (!nextPartial) return state;
        if (nextPartial === state) return state;

        const nextState = { ...state, ...(nextPartial as Partial<DesignerState>) } as DesignerState;

        if ('nodes' in (nextPartial as Partial<DesignerState>) && Array.isArray(nextState.nodes)) {
          nextState.nodesById = indexNodesById(nextState.nodes);
          const requestedRootId = (nextPartial as { rootId?: unknown }).rootId;
          const hasRequestedRoot = typeof requestedRootId === 'string' && Boolean(nextState.nodesById[requestedRootId]);
          const hasExistingRoot = Boolean(nextState.rootId && nextState.nodesById[nextState.rootId]);
          const derivedRootId =
            nextState.nodes.find((node) => node.type === 'document')?.id ??
            nextState.nodes.at(0)?.id ??
            DOCUMENT_NODE_ID;
          nextState.rootId = hasRequestedRoot
            ? (requestedRootId as string)
            : hasExistingRoot
              ? nextState.rootId
              : derivedRootId;
        }

        return nextState;
      }, replace, action);

    return {
    rootId: DOCUMENT_NODE_ID,
    nodesById: indexNodesById(initialNodes),
    nodes: initialNodes,
    selectedNodeId: null,
    hoverNodeId: null,
    snapToGrid: true,
    gridSize: 8,
    showGuides: true,
    showRulers: true,
    canvasScale: 1,
    history: [createHistoryEntry(initialNodes)],
    historyIndex: 0,
    metrics: {
      totalDrags: 0,
      completedDrops: 0,
      failedDrops: 0,
      totalSelections: 0,
    },

    addNodeFromPalette: (type, dropPoint, options = {}) => {
      const { snapToGrid: shouldSnap, gridSize } = get();

      const resolvedParentId =
        options.parentId ??
        (() => {
          const allowedParents = getAllowedParentsForType(type);
          if (!allowedParents.length) {
            return null;
          }
          const fallbackParent = get().nodes.filter((node) => allowedParents.includes(node.type)).at(0);
          return fallbackParent?.id ?? null;
        })();

      if (!resolvedParentId) {
        console.warn('[Designer] unable to resolve parent for', type);
        return;
      }

      const parentNode = get().nodes.find((node) => node.id === resolvedParentId);
      if (!parentNode || !canNestWithinParent(type, parentNode.type)) {
        console.warn('[Designer] invalid parent drop target', { type, resolvedParentId });
        return;
      }

      // Legacy coordinate-based insertion during cutover.
      const parentAbsPos = getAbsolutePosition(resolvedParentId, get().nodes);
      const relativeDropPoint = {
        x: dropPoint.x - parentAbsPos.x,
        y: dropPoint.y - parentAbsPos.y,
      };

      const position = shouldSnap
        ? {
            x: snapToGridValue(relativeDropPoint.x, gridSize),
            y: snapToGridValue(relativeDropPoint.y, gridSize),
          }
        : relativeDropPoint;

      const schema = getComponentSchema(type);
      const rawSize = options.defaults?.size ?? schema?.defaults.size ?? DEFAULT_SIZE;
      const size = clampNodeSizeToPracticalMinimum(type, rawSize);

      const defaultMetadata = normalizeDefaultMetadataForNewNode(type, schema?.defaults.metadata);
      const overrideMetadata = normalizeDefaultMetadataForNewNode(type, options.defaults?.metadata);
      const mergedMetadata = {
        ...(defaultMetadata ?? {}),
        ...(overrideMetadata ?? {}),
      };

      const baseStyle: DesignerNodeStyle = {
        width: `${Math.round(size.width)}px`,
        height: `${Math.round(size.height)}px`,
      };

      const nodeName = schema?.defaults.name ?? `${schema?.label ?? type} ${get().nodes.length + 1}`;

      const node: DesignerNode = syncLegacyFieldsFromProps({
        id: generateId(),
        type,
        name: nodeName,
        props: {
          name: nodeName,
          metadata: mergedMetadata,
          layout: options.defaults?.layout ?? schema?.defaults.layout,
          style: {
            ...baseStyle,
            ...(schema?.defaults.style ?? {}),
            ...(options.defaults?.style ?? {}),
          },
        },
        position,
        size,
        baseSize: size,
        rotation: typeof options.defaults?.rotation === 'number' ? options.defaults.rotation : 0,
        canRotate: typeof options.defaults?.canRotate === 'boolean' ? options.defaults.canRotate : true,
        allowResize: typeof options.defaults?.allowResize === 'boolean' ? options.defaults.allowResize : true,
        layoutPresetId:
          typeof options.defaults?.layoutPresetId === 'string' ? options.defaults.layoutPresetId : undefined,
        parentId: null,
        children: [],
        childIds: [],
        allowedChildren: getAllowedChildrenForType(type),
      });

      setWithIndex((state) => {
        const appendedNodes = [...state.nodes, node];
        const parent = state.nodesById[resolvedParentId];
        const insertIndex = parent ? parent.childIds.length : 0;
        const withParentLink = patchInsertChild(appendedNodes, resolvedParentId, node.id, insertIndex);
        const { history, historyIndex } = appendHistory(state, withParentLink);
        return {
          nodes: withParentLink,
          history,
          historyIndex,
          selectedNodeId: node.id,
        };
      }, false, 'designer/addNodeFromPalette');
    },

    insertPreset: (presetId, dropPoint = { x: 120, y: 120 }, parentId) => {
      const preset = getPresetById(presetId);
      if (!preset) {
        console.warn('[Designer] unknown layout preset', presetId);
        return;
      }

      setWithIndex((state) => {
        const origin = dropPoint ?? { x: 120, y: 120 };
        const resolvedParentId =
          parentId ??
          (() => {
            const fallbackType = preset.nodes[0]?.type ?? 'section';
            const allowedParents = getAllowedParentsForType(fallbackType);
            const fallbackParent = state.nodes.find((node) => allowedParents.includes(node.type));
            return fallbackParent?.id ?? null;
          })();

        if (!resolvedParentId) {
          console.warn('[Designer] unable to resolve parent for preset', presetId);
          return state;
        }

        const keyToId = new Map<string, string>();
        const nodesById = new Map<string, DesignerNode>(state.nodes.map((node) => [node.id, node]));
        const createdNodes: DesignerNode[] = [];

        preset.nodes.forEach((definition) => {
          const id = generateId();
          keyToId.set(definition.key, id);

          const parentKey = definition.parentKey;
          const resolvedParentKeyId = parentKey ? keyToId.get(parentKey) : undefined;
          const nodeParentId = resolvedParentKeyId ?? resolvedParentId;

          const offset = definition.offset ?? { x: 0, y: 0 };
          const position = {
            x: origin.x + offset.x,
            y: origin.y + offset.y,
          };

          const size = clampNodeSizeToPracticalMinimum(definition.type, definition.size ?? DEFAULT_SIZE);

          const mappedLayout = isLegacyPresetLayout(definition.layout)
            ? mapLegacyPresetLayoutToCss(definition.layout)
            : definition.layout;

          const style: DesignerNodeStyle = {
            width: `${Math.round(size.width)}px`,
            height: `${Math.round(size.height)}px`,
            ...definition.style,
          };
          const metadata = definition.metadata ?? {};
          const name = definition.name ?? definition.type;

          createdNodes.push(
            syncLegacyFieldsFromProps({
              id,
              type: definition.type,
              name,
              props: {
                name,
                metadata,
                layout: mappedLayout,
                style,
              },
              position,
              size,
              baseSize: size,
              rotation: 0,
              canRotate: true,
              allowResize: true,
              layoutPresetId: presetId,
              parentId: nodeParentId,
              children: [],
              childIds: [],
              allowedChildren: getAllowedChildrenForType(definition.type),
            })
          );
        });

        // Apply legacy preset constraints by translating them into CSS-like node styles.
        if (Array.isArray(preset.constraints) && preset.constraints.length > 0) {
          preset.constraints.forEach((constraint) => {
            if (constraint.type !== 'aspect-ratio') return;
            const nodeId = keyToId.get(constraint.node);
            if (!nodeId) return;
            const ratio = Number.isFinite(constraint.ratio) && constraint.ratio > 0 ? constraint.ratio : null;
            if (!ratio) return;

            const target = createdNodes.find((node) => node.id === nodeId);
            if (!target) return;
            const nextStyle: DesignerNodeStyle = {
              ...(isPlainObject((target.props as Record<string, unknown>).style)
                ? ((target.props as Record<string, unknown>).style as DesignerNodeStyle)
                : {}),
              aspectRatio: `${ratio} / 1`,
              objectFit: target.style?.objectFit ?? 'contain',
            };
            Object.assign(
              target,
              syncLegacyFieldsFromProps({
                ...target,
                props: {
                  ...target.props,
                  style: nextStyle,
                },
              })
            );
          });
        }

        const nextNodesBase = [...state.nodes, ...createdNodes];
        let nextNodes = nextNodesBase;

        // Attach children based on their parentId fields.
        createdNodes.forEach((node) => {
          if (!node.parentId) {
            return;
          }
          const parent = nodesById.get(node.parentId) ?? createdNodes.find((c) => c.id === node.parentId);
          if (!parent) {
            return;
          }
          nextNodes = attachChildAtIndex(nextNodes, node.parentId, node.id);
        });

        const { history, historyIndex } = appendHistory(state, nextNodes);
        return {
          ...state,
          nodes: nextNodes,
          history,
          historyIndex,
          selectedNodeId: createdNodes.at(-1)?.id ?? state.selectedNodeId,
        };
      }, false, 'designer/insertPreset');
    },

    setNodeProp: (nodeId, path, value, commit = true) => {
      setWithIndex((state) => {
        const normalizedPath = normalizeDesignerPatchPath(path);
        let nodes = patchSetNodeProp(state.nodes, nodeId, normalizedPath, value);
        if (nodes === state.nodes) return state;

        const labelNormalization = resolveLabelNormalizationKind(normalizedPath);
        if (labelNormalization) {
          nodes = normalizeLabelAfterMutation(nodes, nodeId, labelNormalization);
        }

        nodes = syncLegacyFieldsFromPropsForNodeId(nodes, nodeId);

        if (!commit) return { nodes };

        const { history, historyIndex } = appendHistory(state, nodes);
        return { nodes, history, historyIndex };
      }, false, 'designer/setNodeProp');
    },

    unsetNodeProp: (nodeId, path, commit = true) => {
      setWithIndex((state) => {
        const normalizedPath = normalizeDesignerPatchPath(path);
        let nodes = patchUnsetNodeProp(state.nodes, nodeId, normalizedPath);
        if (nodes === state.nodes) return state;

        const labelNormalization = resolveLabelNormalizationKind(normalizedPath);
        if (labelNormalization) {
          nodes = normalizeLabelAfterMutation(nodes, nodeId, labelNormalization);
        }

        nodes = syncLegacyFieldsFromPropsForNodeId(nodes, nodeId);

        if (!commit) return { nodes };

        const { history, historyIndex } = appendHistory(state, nodes);
        return { nodes, history, historyIndex };
      }, false, 'designer/unsetNodeProp');
    },

    insertChild: (parentId, childId, index) => {
      setWithIndex((state) => {
        const parent = state.nodesById[parentId];
        const child = state.nodesById[childId];
        if (!parent || !child) return state;
        if (!canNestWithinParent(child.type, parent.type)) return state;

        const nodes = patchInsertChild(state.nodes, parentId, childId, index);
        if (nodes === state.nodes) return state;
        const { history, historyIndex } = appendHistory(state, nodes);
        return { nodes, history, historyIndex };
      }, false, 'designer/insertChild');
    },

    removeChild: (parentId, childId) => {
      setWithIndex((state) => {
        const parent = state.nodesById[parentId];
        const child = state.nodesById[childId];
        if (!parent || !child) return state;

        const nodes = patchRemoveChild(state.nodes, parentId, childId);
        if (nodes === state.nodes) return state;
        const { history, historyIndex } = appendHistory(state, nodes);
        return { nodes, history, historyIndex };
      }, false, 'designer/removeChild');
    },

    moveNode: (nodeId, nextParentId, nextIndex) => {
      setWithIndex((state) => {
        const nodesById = state.nodesById;
        const node = nodesById[nodeId];
        const nextParent = nodesById[nextParentId];
        if (!node || !nextParent) return state;
        if (!canNestWithinParent(node.type, nextParent.type)) return state;

        const nodes = patchMoveNode(state.nodes, nodeId, nextParentId, nextIndex);
        if (nodes === state.nodes) return state;
        const { history, historyIndex } = appendHistory(state, nodes);
        return { nodes, history, historyIndex };
      }, false, 'designer/moveNode');
    },

    deleteNode: (nodeId) => {
      setWithIndex((state) => {
        const nodes = patchDeleteNode(state.nodes, nodeId);
        if (nodes === state.nodes) return state;
        const remainingIds = new Set(nodes.map((node) => node.id));
        const { history, historyIndex } = appendHistory(state, nodes);
        return {
          nodes,
          history,
          historyIndex,
          selectedNodeId: state.selectedNodeId && remainingIds.has(state.selectedNodeId) ? state.selectedNodeId : null,
          hoverNodeId: state.hoverNodeId && remainingIds.has(state.hoverNodeId) ? state.hoverNodeId : null,
        };
      }, false, 'designer/deleteNode');
    },

    selectNode: (id) => {
      setWithIndex((state) => {
        const nextId = id && state.nodesById[id] ? id : null;
        return {
          selectedNodeId: nextId,
          metrics: { ...state.metrics, totalSelections: state.metrics.totalSelections + 1 },
        };
      });
    },

    setHoverNode: (id) => {
      setWithIndex((state) => ({ hoverNodeId: id && state.nodesById[id] ? id : null }));
    },

    deleteSelectedNode: () => {
      const selectedNodeId = get().selectedNodeId;
      if (!selectedNodeId) {
        return;
      }
      get().deleteNode(selectedNodeId);
    },

    toggleSnap: () => setWithIndex((state) => ({ snapToGrid: !state.snapToGrid })),
    setGridSize: (size) => setWithIndex({ gridSize: size }),
    setCanvasScale: (scale) => setWithIndex({ canvasScale: scale }),
    toggleGuides: () => setWithIndex((state) => ({ showGuides: !state.showGuides })),
    toggleRulers: () => setWithIndex((state) => ({ showRulers: !state.showRulers })),

    undo: () => {
      setWithIndex((state) => {
        if (state.historyIndex <= 0) {
          return state;
        }
        const nextIndex = state.historyIndex - 1;
        const entry = state.history[nextIndex];
        if (!entry) {
          return state;
        }
        return {
          ...state,
          nodes: snapshotNodes(entry.nodes),
          historyIndex: nextIndex,
        };
      }, false, 'designer/undo');
    },

    redo: () => {
      setWithIndex((state) => {
        if (state.historyIndex >= state.history.length - 1) {
          return state;
        }
        const nextIndex = state.historyIndex + 1;
        const entry = state.history[nextIndex];
        if (!entry) {
          return state;
        }
        return {
          ...state,
          nodes: snapshotNodes(entry.nodes),
          historyIndex: nextIndex,
        };
      }, false, 'designer/redo');
    },

    resetWorkspace: () => {
      const nodes = createInitialNodes();
      setWithIndex(() => ({
        nodes,
        selectedNodeId: null,
        hoverNodeId: null,
        history: [createHistoryEntry(nodes)],
        historyIndex: 0,
      }));
    },

    loadNodes: (nodes) => {
      setWithIndex((state) => {
        const nextNodes = snapshotNodes(nodes);
        return {
          nodes: nextNodes,
          history: [createHistoryEntry(nextNodes)],
          historyIndex: 0,
          selectedNodeId: null,
        };
      }, false, 'designer/loadNodes');
    },

    loadWorkspace: (workspace) => {
      setWithIndex((state) => {
        const legacyNodes = (workspace as { nodes?: unknown }).nodes;
        const nextRootId = typeof workspace.rootId === 'string' ? workspace.rootId : state.rootId;
        const nextNodes = Array.isArray(legacyNodes)
          ? snapshotNodes(legacyNodes as DesignerNode[])
          : materializeNodesFromSnapshot({
              nodesById: workspace.nodesById,
              rootId: nextRootId,
            });
        return {
          rootId: nextRootId,
          nodes: nextNodes,
          snapToGrid: typeof workspace.snapToGrid === 'boolean' ? workspace.snapToGrid : state.snapToGrid,
          gridSize: typeof workspace.gridSize === 'number' ? workspace.gridSize : state.gridSize,
          showGuides: typeof workspace.showGuides === 'boolean' ? workspace.showGuides : state.showGuides,
          showRulers: typeof workspace.showRulers === 'boolean' ? workspace.showRulers : state.showRulers,
          canvasScale: typeof workspace.canvasScale === 'number' ? workspace.canvasScale : state.canvasScale,
          history: [createHistoryEntry(nextNodes)],
          historyIndex: 0,
          selectedNodeId: null,
          hoverNodeId: null,
        };
      }, false, 'designer/loadWorkspace');
    },

    exportWorkspace: () => {
      const state = get();
      return {
        rootId: state.rootId,
        nodesById: snapshotWorkspaceNodesById(state.nodes),
        snapToGrid: state.snapToGrid,
        gridSize: state.gridSize,
        showGuides: state.showGuides,
        showRulers: state.showRulers,
        canvasScale: state.canvasScale,
      };
    },

    recordDropResult: (success) => {
      setWithIndex((state) => ({
        metrics: {
          ...state.metrics,
          completedDrops: state.metrics.completedDrops + (success ? 1 : 0),
          failedDrops: state.metrics.failedDrops + (success ? 0 : 1),
        },
      }));
    },
  };
  })
);
