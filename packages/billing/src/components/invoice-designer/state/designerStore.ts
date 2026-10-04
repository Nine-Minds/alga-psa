import { create } from 'zustand';
import { generateUUID } from '@alga-psa/core';
import { devtools } from 'zustand/middleware';
import {
  DEFAULT_INVOICE_PRINT_SETTINGS,
  resolveTemplatePrintSettings,
  type TemplatePrintSettings,
  type TemplateTransformOperation,
} from '@alga-psa/types';

import {
  deleteNode as patchDeleteNode,
  insertChild as patchInsertChild,
  moveNode as patchMoveNode,
  removeChild as patchRemoveChild,
  setNodeProp as patchSetNodeProp,
  unsetNodeProp as patchUnsetNodeProp,
} from './patchOps';
import { getPresetById, LegacyLayoutPresetLayout } from '../constants/presets';
import { COPYABLE_STYLE_KEYS, isDefaultLayerName, suggestLayerName } from '../utils/structureEditing';
import { planDataFieldRebind } from '../fields/dataFieldRebind';
import type { DesignerClipboardPayload, DesignerStyleClipboard, InsertPlacement } from '../utils/structureEditing';
import type { DesignerInspectorTab } from '../schema/inspectorSchema';
import {
  createPageLayout,
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
  | 'richText'
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
export type CssTextAlign = 'left' | 'center' | 'right' | 'justify';

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
  objectPosition?: string;

  // Visual
  margin?: CssLength;
  border?: string;
  borderRadius?: CssLength;
  color?: string;
  backgroundColor?: string;
  fontSize?: CssLength;
  fontWeight?: string | number;
  fontFamily?: string;
  fontStyle?: string;
  lineHeight?: string | number;
  textAlign?: CssTextAlign;

  // Non-container layout-like style declarations that can be attached directly
  // to nodes such as fields in template AST inline styles.
  display?: 'flex' | 'grid';
  flexDirection?: 'row' | 'column';
  justifyContent?: CssJustifyContent;
  alignItems?: CssAlignItems;
  gap?: CssLength;
  padding?: CssLength;
  gridTemplateColumns?: string;
  gridTemplateRows?: string;
  gridAutoFlow?: CssGridAutoFlow;
}

export interface DesignerNode {
  id: string;
  type: DesignerComponentType;

  // Canonical authored props container.
  // Conventions for common namespaces:
  // - props.name: string
  // - props.metadata: Record<string, unknown>
  // - props.layout: DesignerContainerLayout
  // - props.style: DesignerNodeStyle
  props: Record<string, unknown>;

  // Runtime/editor geometry (not persisted in exported workspace).
  position: Point;
  size: Size;
  baseSize?: Size;

  canRotate?: boolean;
  rotation?: number;
  allowResize?: boolean;

  layoutPresetId?: string;

  parentId: string | null;

  // Canonical hierarchy.
  children: string[];
  allowedChildren: DesignerComponentType[];
}

export type DesignerNodeDefaults = {
  // Optional authored defaults (written into props.*)
  name?: string;
  metadata?: Record<string, unknown>;
  layout?: DesignerContainerLayout;
  style?: Partial<DesignerNodeStyle>;

  // Optional runtime/editor defaults
  size?: Size;
  rotation?: number;
  canRotate?: boolean;
  allowResize?: boolean;
  layoutPresetId?: string;
};

export type DesignerWorkspaceLoadInput = Partial<Omit<DesignerWorkspaceSnapshot, 'nodesById'>> & {
  rootId?: string;
  // Canonical snapshot input.
  nodesById?: DesignerWorkspaceSnapshot['nodesById'];
  // Legacy runtime nodes[] input (supported for tests/internal tooling during cutover).
  nodes?: DesignerNode[];
};

interface DesignerMetrics {
  totalDrags: number;
  completedDrops: number;
  failedDrops: number;
  totalSelections: number;
}

export interface DesignerWorkspaceSnapshot {
  rootId: string;
  nodesById: Record<string, { id: string; type: DesignerComponentType; props: Record<string, unknown>; children: string[] }>;
  transforms: DesignerTransformWorkspace;
  snapToGrid: boolean;
  gridSize: number;
  showGuides: boolean;
  showRulers: boolean;
  canvasScale: number;
}

export interface DesignerTransformWorkspace {
  sourceBindingId: string;
  outputBindingId: string;
  operations: TemplateTransformOperation[];
}

interface DesignerState {
  // Canonical tree index (cutover in progress): nodesById + rootId.
  // The legacy `nodes` array remains during migration but is always kept in sync.
  rootId: string;
  nodesById: Record<string, DesignerNode>;
  nodes: DesignerNode[];
  transforms: DesignerTransformWorkspace;
  selectedNodeId: string | null;
  hoverNodeId: string | null;
  // Designer-internal clipboard for copy/cut/paste/duplicate; not part of history.
  clipboard: DesignerClipboardPayload | null;
  styleClipboard: DesignerStyleClipboard | null;
  // Outline rows the user collapsed; kept here so switching panel tabs keeps them.
  outlineCollapsedIds: string[];
  // Where "+" puts a block when a container is selected: inside it, or after it.
  insertPlacement: InsertPlacement;
  inspectorTab: DesignerInspectorTab;
  snapToGrid: boolean;
  gridSize: number;
  showGuides: boolean;
  showRulers: boolean;
  canvasScale: number;
  /** Bumped each time a workspace is loaded or reset, so views can react to a fresh document. */
  workspaceLoadCount: number;
  metrics: DesignerMetrics;
  history: DesignerHistoryEntry[];
  historyIndex: number;

  addNodeFromPalette: (
    type: DesignerComponentType,
    dropPoint: Point,
    options?: { defaults?: DesignerNodeDefaults; parentId?: string; index?: number }
  ) => void;
  /** `index` places the preset's top-level blocks at that position in `parentId` (default: the end). */
  insertPreset: (presetId: string, dropPoint?: Point, parentId?: string, index?: number) => void;
  applyPrintSettings: (settings: Partial<TemplatePrintSettings>) => void;
  // Generic patch API (primary path going forward).
  setNodeProp: (nodeId: string, path: string, value: unknown, commit?: boolean) => void;
  unsetNodeProp: (nodeId: string, path: string, commit?: boolean) => void;
  /**
   * Records the current document as an undo step if it changed since the last one:
   * ends a gesture whose live updates were applied with `commit = false`.
   */
  commitHistory: () => void;
  /**
   * Points a Data Field at `bindingPath` as one undo step: format always follows,
   * the label follows unless the author typed their own, and a still-generated
   * layer name is renamed. Shared by the inspector picker and the FIELDS tab.
   * `catalogLabel` is the picker's label for bindings without a standard label.
   */
  rebindDataField: (nodeId: string, bindingPath: string, catalogLabel?: string) => void;
  insertChild: (parentId: string, childId: string, index: number) => void;
  removeChild: (parentId: string, childId: string) => void;
  moveNode: (nodeId: string, nextParentId: string, nextIndex: number) => void;
  /** Inserts a fresh copy of a clipboard subtree and selects it; returns the new root id. */
  pasteSubtree: (payload: DesignerClipboardPayload, parentId: string, index: number) => string | null;
  setClipboard: (payload: DesignerClipboardPayload | null) => void;
  setStyleClipboard: (style: DesignerStyleClipboard | null) => void;
  /** Replaces the node's visual style (and container layout) with a copied one, as one undo step. */
  pasteStyle: (nodeId: string, style: DesignerStyleClipboard) => void;
  toggleOutlineCollapsed: (nodeId: string) => void;
  setInsertPlacement: (placement: InsertPlacement) => void;
  setInspectorTab: (tab: DesignerInspectorTab) => void;
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
  loadWorkspace: (workspace: DesignerWorkspaceLoadInput) => void;
  exportWorkspace: () => DesignerWorkspaceSnapshot;
  setTransforms: (transforms: DesignerTransformWorkspace, commit?: boolean) => void;
  recordDropResult: (success: boolean) => void;
}

type DesignerHistoryEntry = {
  nodes: DesignerNode[];
  transforms: DesignerTransformWorkspace;
};

const MAX_HISTORY_LENGTH = 50;
const DEFAULT_SIZE: Size = { width: 160, height: 64 };
export const DOCUMENT_NODE_ID = 'designer-document-root';
const DEFAULT_PAGE_NODE_ID = 'designer-page-default';

const generateId = () => generateUUID();

// Media frames need a concrete box; spacers exist to occupy a fixed height.
// Everything else is laid out by its parent's flow and sized by its content.
const FIXED_FRAME_TYPES = new Set<DesignerComponentType>(['image', 'logo', 'qr']);

export const collectLayerNames = (nodes: DesignerNode[]): Set<string> =>
  new Set(
    nodes
      .map((node) => (isPlainObject(node.props) ? node.props.name : undefined))
      .filter((name): name is string => typeof name === 'string')
  );

/**
 * A copied layer gets the next free numbered name ("Invoice # 2", "from-card-2"),
 * following the name's own separator style, so the outline never shows twins.
 */
export const createUniqueLayerName = (name: string, takenNames: ReadonlySet<string>): string => {
  if (!takenNames.has(name)) return name;
  const numbered = /^(.*?)([ -])(\d+)$/.exec(name);
  const base = numbered ? numbered[1] : name;
  const separator = numbered ? numbered[2] : /\s/.test(name) || !/[-_]/.test(name) ? ' ' : '-';
  for (let index = 2; ; index += 1) {
    const candidate = `${base}${separator}${index}`;
    if (!takenNames.has(candidate)) return candidate;
  }
};

/**
 * Replaces a still-generated layer name ("Data Field 3") with one describing the
 * block's content, so the outline reads like the document without manual renames.
 * Returns the new unique name, or null when the layer keeps its current one.
 */
export const resolveDefaultLayerRename = (
  nodes: DesignerNode[],
  nodeId: string,
  suggestion: string | null
): string | null => {
  if (!suggestion) return null;
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return null;
  const name = isPlainObject(node.props) && typeof node.props.name === 'string' ? node.props.name : '';
  if (!isDefaultLayerName(name, getComponentSchema(node.type).label)) return null;
  return createUniqueLayerName(suggestion, collectLayerNames(nodes.filter((candidate) => candidate.id !== nodeId)));
};

export const resolveNewNodeBaseStyle = (type: DesignerComponentType, size: Size): DesignerNodeStyle => {
  // A logo keeps its width and lets height follow the image (capped by its max height).
  if (type === 'logo') {
    return { width: `${Math.round(size.width)}px`, height: 'auto' };
  }
  if (FIXED_FRAME_TYPES.has(type)) {
    return { width: `${Math.round(size.width)}px`, height: `${Math.round(size.height)}px` };
  }
  if (type === 'spacer') {
    return { width: 'auto', height: `${Math.round(size.height)}px` };
  }
  return { width: 'auto', height: 'auto' };
};

const deepCloneJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

export const createEmptyDesignerTransformWorkspace = (): DesignerTransformWorkspace => ({
  sourceBindingId: '',
  outputBindingId: '',
  operations: [],
});

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parsePxLength = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.length) {
      return undefined;
    }

    const numeric = Number.parseFloat(trimmed.replace(/px$/i, '').trim());
    return Number.isFinite(numeric) ? numeric : undefined;
  }

  return undefined;
};

const getNodeMetadata = (node: DesignerNode | undefined): Record<string, unknown> => {
  if (!node || !isPlainObject(node.props)) {
    return {};
  }

  return isPlainObject(node.props.metadata) ? (node.props.metadata as Record<string, unknown>) : {};
};

const getNodeLayout = (node: DesignerNode | undefined): Partial<DesignerContainerLayout> => {
  if (!node || !isPlainObject(node.props)) {
    return {};
  }

  return isPlainObject(node.props.layout) ? (node.props.layout as Partial<DesignerContainerLayout>) : {};
};

const getNodeStyle = (node: DesignerNode | undefined): Partial<DesignerNodeStyle> => {
  if (!node || !isPlainObject(node.props)) {
    return {};
  }

  return isPlainObject(node.props.style) ? (node.props.style as Partial<DesignerNodeStyle>) : {};
};

const getNodePropSize = (node: DesignerNode | undefined): Partial<Size> => {
  if (!node || !isPlainObject(node.props) || !isPlainObject(node.props.size)) {
    return {};
  }

  return node.props.size as Partial<Size>;
};

const getDocumentAndPageNodes = (nodes: DesignerNode[]): {
  documentNode: DesignerNode | undefined;
  pageNode: DesignerNode | undefined;
} => {
  const documentNode = nodes.find((node) => node.type === 'document');
  const pageNode = documentNode
    ? nodes.find((node) => node.parentId === documentNode.id && node.type === 'page')
    : nodes.find((node) => node.type === 'page');

  return { documentNode, pageNode };
};

const resolveCurrentWorkspacePrintSettings = (nodes: DesignerNode[]) => {
  const { documentNode, pageNode } = getDocumentAndPageNodes(nodes);
  const documentMetadata = getNodeMetadata(documentNode);
  const documentPropSize = getNodePropSize(documentNode);
  const pagePropSize = getNodePropSize(pageNode);
  const pageStyle = getNodeStyle(pageNode);
  const pageLayout = getNodeLayout(pageNode);

  return resolveTemplatePrintSettings({
    printSettings: isPlainObject(documentMetadata.printSettings)
      ? (documentMetadata.printSettings as Partial<TemplatePrintSettings>)
      : undefined,
    pageWidthPx:
      pageNode?.size.width ??
      (typeof pagePropSize.width === 'number' ? pagePropSize.width : undefined) ??
      parsePxLength(pageStyle.width),
    pageHeightPx:
      pageNode?.size.height ??
      (typeof pagePropSize.height === 'number' ? pagePropSize.height : undefined) ??
      parsePxLength(pageStyle.height),
    documentWidthPx:
      documentNode?.size.width ??
      (typeof documentPropSize.width === 'number' ? documentPropSize.width : undefined),
    documentHeightPx:
      documentNode?.size.height ??
      (typeof documentPropSize.height === 'number' ? documentPropSize.height : undefined),
    pagePaddingPx: parsePxLength(pageLayout.padding),
  });
};

const applyResolvedPrintSettingsToNodes = (
  nodes: DesignerNode[],
  settings: Partial<TemplatePrintSettings>
): DesignerNode[] => {
  const current = resolveCurrentWorkspacePrintSettings(nodes);
  const resolved = resolveTemplatePrintSettings({
    printSettings: {
      paperPreset: settings.paperPreset ?? current.paperPreset,
      marginMm: typeof settings.marginMm === 'number' ? settings.marginMm : current.marginMm,
    },
  });
  if (
    current.paperPreset === resolved.paperPreset &&
    current.marginMm === resolved.marginMm &&
    current.pageWidthPx === resolved.pageWidthPx &&
    current.pageHeightPx === resolved.pageHeightPx &&
    current.marginPx === resolved.marginPx
  ) {
    return nodes;
  }

  return nodes.map((node) => {
    if (node.type !== 'document' && node.type !== 'page') {
      return node;
    }

    const metadata = {
      ...getNodeMetadata(node),
      printSettings: {
        paperPreset: resolved.paperPreset,
        marginMm: resolved.marginMm,
      },
    };
    const style = {
      ...getNodeStyle(node),
      width: `${resolved.pageWidthPx}px`,
      height: `${resolved.pageHeightPx}px`,
    };
    const layout =
      node.type === 'page'
        ? {
            ...getNodeLayout(node),
            padding: `${resolved.marginPx}px`,
          }
        : getNodeLayout(node);

    return {
      ...node,
      props: {
        ...node.props,
        metadata,
        layout,
        style,
        size: {
          width: resolved.pageWidthPx,
          height: resolved.pageHeightPx,
        },
      },
      size: {
        width: resolved.pageWidthPx,
        height: resolved.pageHeightPx,
      },
      baseSize: {
        width: resolved.pageWidthPx,
        height: resolved.pageHeightPx,
      },
    };
  });
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

const sanitizeTransformWorkspace = (value: unknown): DesignerTransformWorkspace => {
  if (!isPlainObject(value)) {
    return createEmptyDesignerTransformWorkspace();
  }

  const sourceBindingId = typeof value.sourceBindingId === 'string' ? value.sourceBindingId.trim() : '';
  const outputBindingId = typeof value.outputBindingId === 'string' ? value.outputBindingId.trim() : '';
  const operations = Array.isArray(value.operations)
    ? deepCloneJson(
        value.operations.filter(
          (operation): operation is TemplateTransformOperation =>
            isPlainObject(operation) &&
            typeof operation.id === 'string' &&
            operation.id.trim().length > 0 &&
            typeof operation.type === 'string'
        )
      )
    : [];

  return {
    sourceBindingId,
    outputBindingId,
    operations,
  };
};

export const snapshotWorkspaceNodesById = (
  nodes: DesignerNode[]
): DesignerWorkspaceSnapshot['nodesById'] =>
  Object.fromEntries(
    nodes.map((node) => [
      node.id,
      {
        id: node.id,
        type: node.type,
        props: sanitizePersistedNodeProps(node.props),
        children: node.children.slice(),
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
    // Back-compat: older snapshots stored authored fields on the node itself rather than inside `props`.
    // We only use these legacy fields during snapshot materialization; runtime state remains canonical.
    const legacyName = typeof (snapshotNode as any).name === 'string' ? String((snapshotNode as any).name) : undefined;
    const legacyMetadata = isPlainObject((snapshotNode as any).metadata) ? ((snapshotNode as any).metadata as Record<string, unknown>) : undefined;
    const legacyLayout = isPlainObject((snapshotNode as any).layout)
      ? ((snapshotNode as any).layout as Partial<DesignerContainerLayout>)
      : undefined;
    const legacyStyle = isPlainObject((snapshotNode as any).style)
      ? ((snapshotNode as any).style as Partial<DesignerNodeStyle>)
      : undefined;

    const name =
      typeof rawProps.name === 'string'
        ? rawProps.name
        : legacyName ?? schema?.defaults.name ?? `${schema?.label ?? snapshotNode.type}`;

    const rawMetadata = isPlainObject(rawProps.metadata)
      ? (rawProps.metadata as Record<string, unknown>)
      : legacyMetadata ?? {};
    const rawLayout = isPlainObject(rawProps.layout)
      ? (rawProps.layout as Partial<DesignerContainerLayout>)
      : legacyLayout;
    const rawStyle = isPlainObject(rawProps.style)
      ? (rawProps.style as Partial<DesignerNodeStyle>)
      : legacyStyle;

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

    const rawSizeValue = (rawProps as any).size ?? (snapshotNode as any).size;
    const sizeFromProps = coerceSize(rawSizeValue);
    const sizeFromStyle = {
      width: parsePx(style.width),
      height: parsePx(style.height),
    };
    const defaultSize = schema?.defaults.size ?? DEFAULT_SIZE;
    const size = clampNodeSizeToPracticalMinimum(snapshotNode.type, {
      width: sizeFromProps?.width ?? sizeFromStyle.width ?? defaultSize.width,
      height: sizeFromProps?.height ?? sizeFromStyle.height ?? defaultSize.height,
    });

    // Keep CSS size in sync with numeric box size for authored/designer-native nodes.
    // AST-imported nodes should remain fluid unless width/height existed in the
    // source AST. Check the AUTHORED style, not the merged one: the schema
    // defaults spread above always fills width/height (fields default to
    // 'auto'), which used to make these guards dead code and left native
    // nodes without their px sync.
    const astImported = metadata.__astImported === true;
    const astHadWidth = metadata.__astHadWidth === true;
    const astHadHeight = metadata.__astHadHeight === true;
    const authoredStyle = rawStyle ?? {};
    if (!authoredStyle.width && (!astImported || astHadWidth)) {
      style.width = `${Math.round(size.width)}px`;
    }
    if (!authoredStyle.height && (!astImported || astHadHeight)) {
      style.height = `${Math.round(size.height)}px`;
    }

    const rawPositionValue = (rawProps as any).position ?? (snapshotNode as any).position;
    const positionFromProps = coercePoint(rawPositionValue);
    const position =
      positionFromProps ??
      (snapshotNode.type === 'document' || snapshotNode.type === 'page'
        ? { x: 0, y: 0 }
        : { x: 24, y: 24 + index * (Math.round(size.height) + 12) + depth * 4 });

    // Back-compat: older snapshots used `childIds` instead of `children`.
    const children = coerceChildren((snapshotNode as any).children ?? (snapshotNode as any).childIds);

    const normalizedProps: Record<string, unknown> = {
      ...rawProps,
      name,
      metadata,
      layout,
      style,
      // Preserve any authored geometry if present; also ensure it's available for runtime.
      position: rawPositionValue,
      size: rawSizeValue,
    };

    output.push({
      id: snapshotNode.id,
      type: snapshotNode.type,
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
      allowedChildren: getAllowedChildrenForType(snapshotNode.type),
    });

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

const createDocumentNode = (): DesignerNode => {
  const resolvedPrintSettings = resolveTemplatePrintSettings({
    printSettings: DEFAULT_INVOICE_PRINT_SETTINGS,
  });

  return {
    id: DOCUMENT_NODE_ID,
    type: 'document',
    props: {
      name: 'Document',
      metadata: {
        printSettings: {
          paperPreset: resolvedPrintSettings.paperPreset,
          marginMm: resolvedPrintSettings.marginMm,
        },
      },
      layout: {
        display: 'flex',
        flexDirection: 'column',
        gap: '0px',
        padding: '0px',
        justifyContent: 'flex-start',
        alignItems: 'stretch',
      },
      style: {
        width: `${resolvedPrintSettings.pageWidthPx}px`,
        height: `${resolvedPrintSettings.pageHeightPx}px`,
      },
      size: {
        width: resolvedPrintSettings.pageWidthPx,
        height: resolvedPrintSettings.pageHeightPx,
      },
    },
    position: { x: 0, y: 0 },
    size: { width: resolvedPrintSettings.pageWidthPx, height: resolvedPrintSettings.pageHeightPx },
    baseSize: { width: resolvedPrintSettings.pageWidthPx, height: resolvedPrintSettings.pageHeightPx },
    canRotate: false,
    allowResize: false,
    rotation: 0,
    layoutPresetId: undefined,
    parentId: null,
    children: [],
    allowedChildren: getAllowedChildrenForType('document'),
  };
};

const createPageNode = (parentId: string, index = 1): DesignerNode => {
  const resolvedPrintSettings = resolveTemplatePrintSettings({
    printSettings: DEFAULT_INVOICE_PRINT_SETTINGS,
  });

  return {
    id: `${DEFAULT_PAGE_NODE_ID}-${index}-${generateId()}`,
    type: 'page',
    props: {
      name: `Page ${index}`,
      metadata: {},
      layout: createPageLayout(`${resolvedPrintSettings.marginPx}px`),
      style: {
        width: `${resolvedPrintSettings.pageWidthPx}px`,
        height: `${resolvedPrintSettings.pageHeightPx}px`,
      },
      size: {
        width: resolvedPrintSettings.pageWidthPx,
        height: resolvedPrintSettings.pageHeightPx,
      },
    },
    position: { x: 0, y: 0 },
    size: { width: resolvedPrintSettings.pageWidthPx, height: resolvedPrintSettings.pageHeightPx },
    baseSize: { width: resolvedPrintSettings.pageWidthPx, height: resolvedPrintSettings.pageHeightPx },
    canRotate: false,
    allowResize: false,
    rotation: 0,
    layoutPresetId: undefined,
    parentId,
    children: [],
    allowedChildren: getAllowedChildrenForType('page'),
  };
};

const createInitialNodes = (): DesignerNode[] => {
  const documentNode = createDocumentNode();
  const pageNode = createPageNode(documentNode.id);
  documentNode.children = [pageNode.id];
  return [documentNode, pageNode];
};

const attachChildAtIndex = (nodes: DesignerNode[], parentId: string, childId: string, index?: number) =>
  nodes.map((node) => {
    if (node.id !== parentId) return node;
    if (node.children.includes(childId)) {
      return node;
    }
    const next = [...node.children];
    if (typeof index === 'number' && index >= 0 && index <= next.length) {
      next.splice(index, 0, childId);
    } else {
      next.push(childId);
    }
    return { ...node, children: next };
  });

const detachChild = (nodes: DesignerNode[], parentId: string | null, childId: string) =>
  parentId
    ? nodes.map((node) =>
        node.id === parentId
          ? {
              ...node,
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
    (node?.children ?? []).forEach(dfs);
  };
  dfs(rootId);
  return toRemove;
};

const snapshotNodes = (nodes: DesignerNode[]): DesignerNode[] =>
  nodes.map((node) => {
    return {
      ...node,
      props: isPlainObject(node.props) ? deepCloneJson(node.props) : {},
      position: { ...node.position },
      size: { ...node.size },
      baseSize: node.baseSize ? { ...node.baseSize } : undefined,
      children: node.children.slice(),
      allowedChildren: [...node.allowedChildren],
    };
  });

const createHistoryEntry = (nodes: DesignerNode[], transforms: DesignerTransformWorkspace): DesignerHistoryEntry => ({
  nodes: snapshotNodes(nodes),
  transforms: deepCloneJson(transforms),
});

const appendHistory = (
  state: Pick<DesignerState, 'history' | 'historyIndex'>,
  nodes: DesignerNode[],
  transforms: DesignerTransformWorkspace
) => {
  const nextHistory = [...state.history.slice(0, state.historyIndex + 1), createHistoryEntry(nodes, transforms)];
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
    transforms: createEmptyDesignerTransformWorkspace(),
    selectedNodeId: null,
    hoverNodeId: null,
    clipboard: null,
    styleClipboard: null,
    outlineCollapsedIds: [],
    insertPlacement: 'inside',
    inspectorTab: 'content',
    snapToGrid: true,
    gridSize: 8,
    showGuides: true,
    showRulers: true,
    canvasScale: 1,
    workspaceLoadCount: 0,
    history: [createHistoryEntry(initialNodes, createEmptyDesignerTransformWorkspace())],
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

      const baseStyle = resolveNewNodeBaseStyle(type, size);

      // The first free number, so names stay dense after deletes and undos.
      const takenNames = collectLayerNames(get().nodes);
      const nodeName = schema?.defaults.name ?? createUniqueLayerName(`${schema?.label ?? type} 1`, takenNames);

      const node: DesignerNode = {
        id: generateId(),
        type,
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
        allowedChildren: getAllowedChildrenForType(type),
      };

      setWithIndex((state) => {
        const appendedNodes = [...state.nodes, node];
        const parent = state.nodesById[resolvedParentId];
        const childCount = parent ? parent.children.length : 0;
        const insertIndex =
          typeof options.index === 'number' && Number.isInteger(options.index)
            ? Math.min(Math.max(options.index, 0), childCount)
            : childCount;
        const withParentLink = patchInsertChild(appendedNodes, resolvedParentId, node.id, insertIndex);
        const { history, historyIndex } = appendHistory(state, withParentLink, state.transforms);
        return {
          nodes: withParentLink,
          history,
          historyIndex,
          selectedNodeId: node.id,
          insertPlacement: 'inside',
          // A new block is filled in next, so it opens on Content (blocks without one fall back to Style).
          inspectorTab: 'content',
        };
      }, false, 'designer/addNodeFromPalette');
    },

    insertPreset: (presetId, dropPoint = { x: 120, y: 120 }, parentId, index) => {
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
        const takenNames = collectLayerNames(state.nodes);
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

          // Preset blocks start exactly like palette blocks (schema defaults, content
          // sizing, unique names) with the preset's own settings on top.
          const schema = getComponentSchema(definition.type);
          const style: DesignerNodeStyle = {
            ...resolveNewNodeBaseStyle(definition.type, size),
            ...(schema?.defaults.style ?? {}),
            ...definition.style,
          };
          const metadata = {
            ...(normalizeDefaultMetadataForNewNode(definition.type, schema?.defaults.metadata) ?? {}),
            ...(definition.metadata ?? {}),
          };
          const name = createUniqueLayerName(definition.name ?? schema?.label ?? definition.type, takenNames);
          takenNames.add(name);

          createdNodes.push({
            id,
            type: definition.type,
            props: {
              name,
              metadata,
              layout: mappedLayout ?? schema?.defaults.layout,
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
            allowedChildren: getAllowedChildrenForType(definition.type),
          });
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
            const existingStyle = isPlainObject((target.props as Record<string, unknown>).style)
              ? ((target.props as Record<string, unknown>).style as DesignerNodeStyle)
              : {};
            const nextStyle: DesignerNodeStyle = {
              ...existingStyle,
              aspectRatio: `${ratio} / 1`,
              objectFit: existingStyle.objectFit ?? 'contain',
            };
            target.props = { ...target.props, style: nextStyle };
          });
        }

        const nextNodesBase = [...state.nodes, ...createdNodes];
        let nextNodes = nextNodesBase;

        // Attach children based on their parentId fields.
        let rootInsertIndex = index;
        createdNodes.forEach((node) => {
          if (!node.parentId) {
            return;
          }
          const parent = nodesById.get(node.parentId) ?? createdNodes.find((c) => c.id === node.parentId);
          if (!parent) {
            return;
          }
          const isTopLevel = node.parentId === resolvedParentId;
          nextNodes = attachChildAtIndex(nextNodes, node.parentId, node.id, isTopLevel ? rootInsertIndex : undefined);
          if (isTopLevel && typeof rootInsertIndex === 'number') {
            rootInsertIndex += 1;
          }
        });

        const { history, historyIndex } = appendHistory(state, nextNodes, state.transforms);
        return {
          ...state,
          nodes: nextNodes,
          history,
          historyIndex,
          selectedNodeId: createdNodes.at(-1)?.id ?? state.selectedNodeId,
        };
      }, false, 'designer/insertPreset');
    },

    applyPrintSettings: (settings) => {
      setWithIndex((state) => {
        const nodes = applyResolvedPrintSettingsToNodes(state.nodes, settings);
        if (nodes === state.nodes) {
          return state;
        }

        const { history, historyIndex } = appendHistory(state, nodes, state.transforms);
        return {
          nodes,
          history,
          historyIndex,
        };
      }, false, 'designer/applyPrintSettings');
    },

    setNodeProp: (nodeId, path, value, commit = true) => {
      setWithIndex((state) => {
        const normalizedPath = normalizeDesignerPatchPath(path);
        const nodes = patchSetNodeProp(state.nodes, nodeId, normalizedPath, value);
        if (nodes === state.nodes) return state;

        if (!commit) return { nodes };

        const { history, historyIndex } = appendHistory(state, nodes, state.transforms);
        return { nodes, history, historyIndex };
      }, false, 'designer/setNodeProp');
    },

    commitHistory: () => {
      setWithIndex((state) => {
        const current = state.history[state.historyIndex];
        if (
          current &&
          JSON.stringify(current.nodes) === JSON.stringify(state.nodes) &&
          JSON.stringify(current.transforms) === JSON.stringify(state.transforms)
        ) {
          return state;
        }
        const { history, historyIndex } = appendHistory(state, state.nodes, state.transforms);
        return { history, historyIndex };
      }, false, 'designer/commitHistory');
    },

    unsetNodeProp: (nodeId, path, commit = true) => {
      setWithIndex((state) => {
        const normalizedPath = normalizeDesignerPatchPath(path);
        const nodes = patchUnsetNodeProp(state.nodes, nodeId, normalizedPath);
        if (nodes === state.nodes) return state;

        if (!commit) return { nodes };

        const { history, historyIndex } = appendHistory(state, nodes, state.transforms);
        return { nodes, history, historyIndex };
      }, false, 'designer/unsetNodeProp');
    },

    rebindDataField: (nodeId, bindingPath, catalogLabel) => {
      setWithIndex((state) => {
        const node = state.nodesById[nodeId];
        if (!node) return state;

        let nodes = state.nodes;
        for (const { path, value } of planDataFieldRebind(node, bindingPath, catalogLabel)) {
          const normalizedPath = normalizeDesignerPatchPath(path);
          nodes =
            typeof value === 'undefined'
              ? patchUnsetNodeProp(nodes, nodeId, normalizedPath)
              : patchSetNodeProp(nodes, nodeId, normalizedPath, value);
        }

        const renamed = resolveDefaultLayerRename(state.nodes, nodeId, suggestLayerName({ bindingKey: bindingPath }));
        if (renamed) nodes = patchSetNodeProp(nodes, nodeId, normalizeDesignerPatchPath('name'), renamed);

        if (nodes === state.nodes) return state;
        const { history, historyIndex } = appendHistory(state, nodes, state.transforms);
        return { nodes, history, historyIndex };
      }, false, 'designer/rebindDataField');
    },

    insertChild: (parentId, childId, index) => {
      setWithIndex((state) => {
        const parent = state.nodesById[parentId];
        const child = state.nodesById[childId];
        if (!parent || !child) return state;
        if (!canNestWithinParent(child.type, parent.type)) return state;

        const nodes = patchInsertChild(state.nodes, parentId, childId, index);
        if (nodes === state.nodes) return state;
        const { history, historyIndex } = appendHistory(state, nodes, state.transforms);
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
        const { history, historyIndex } = appendHistory(state, nodes, state.transforms);
        return { nodes, history, historyIndex };
      }, false, 'designer/removeChild');
    },

    setClipboard: (payload) => setWithIndex({ clipboard: payload }),

    setStyleClipboard: (style) => setWithIndex({ styleClipboard: style }),

    pasteStyle: (nodeId, copied) => {
      const node = get().nodesById[nodeId];
      if (!node) return;
      // Every copyable key is written: a key the source lacks is cleared, so the
      // result looks exactly like the source rather than a blend of both.
      const patches: Array<[path: string, value: unknown]> = COPYABLE_STYLE_KEYS.map((key) => [
        `style.${key}`,
        copied.style[key],
      ]);
      if (node.allowedChildren.length > 0 && copied.layout) {
        patches.push(['layout', copied.layout]);
      }
      patches.forEach(([path, value], index) => {
        const commit = index === patches.length - 1;
        if (value === undefined) {
          get().unsetNodeProp(nodeId, path, commit);
        } else {
          get().setNodeProp(nodeId, path, value, commit);
        }
      });
    },

    setInsertPlacement: (placement) => setWithIndex({ insertPlacement: placement }),

    setInspectorTab: (tab) => setWithIndex({ inspectorTab: tab }),

    toggleOutlineCollapsed: (nodeId) =>
      setWithIndex((state) => ({
        outlineCollapsedIds: state.outlineCollapsedIds.includes(nodeId)
          ? state.outlineCollapsedIds.filter((id) => id !== nodeId)
          : [...state.outlineCollapsedIds, nodeId],
      })),

    pasteSubtree: (payload, parentId, index) => {
      const parent = get().nodesById[parentId];
      const source = new Map(payload.nodes.map((entry) => [entry.id, entry] as const));
      const sourceRoot = source.get(payload.rootId);
      if (!parent || !sourceRoot || !canNestWithinParent(sourceRoot.type, parent.type)) {
        return null;
      }

      const idMap = new Map(payload.nodes.map((entry) => [entry.id, generateId()] as const));
      const newIdFor = (sourceId: string): string => {
        const id = idMap.get(sourceId);
        if (!id) throw new Error(`Clipboard node ${sourceId} is missing from its own payload`);
        return id;
      };
      const takenNames = collectLayerNames(get().nodes);
      const created: DesignerNode[] = payload.nodes.map((entry) => {
        const props = JSON.parse(JSON.stringify(entry.props)) as Record<string, unknown>;
        if (typeof props.name === 'string' && props.name.length > 0) {
          const uniqueName = createUniqueLayerName(props.name, takenNames);
          props.name = uniqueName;
          takenNames.add(uniqueName);
        }
        const metadata = isPlainObject(props.metadata) ? (props.metadata as Record<string, unknown>) : null;
        // A copy is a new layer: it must not export under the original's AST id.
        if (metadata) {
          delete metadata.__astOriginalNodeId;
        }
        const propSize = isPlainObject(props.size) ? (props.size as Partial<Size>) : {};
        const size = {
          width: typeof propSize.width === 'number' ? propSize.width : DEFAULT_SIZE.width,
          height: typeof propSize.height === 'number' ? propSize.height : DEFAULT_SIZE.height,
        };
        return {
          id: newIdFor(entry.id),
          type: entry.type,
          props,
          position: { x: 0, y: 0 },
          size,
          baseSize: size,
          rotation: 0,
          canRotate: true,
          allowResize: true,
          parentId: null,
          children: entry.children.map((childId) => idMap.get(childId)).filter((id): id is string => Boolean(id)),
          allowedChildren: getAllowedChildrenForType(entry.type),
        };
      });
      const createdById = new Map(created.map((node) => [node.id, node] as const));
      created.forEach((node) => {
        node.children.forEach((childId) => {
          const child = createdById.get(childId);
          if (child) child.parentId = node.id;
        });
      });
      const newRootId = newIdFor(payload.rootId);

      setWithIndex((state) => {
        const nodes = patchInsertChild([...state.nodes, ...created], parentId, newRootId, index);
        const { history, historyIndex } = appendHistory(state, nodes, state.transforms);
        return { nodes, history, historyIndex, selectedNodeId: newRootId, insertPlacement: 'inside' };
      }, false, 'designer/pasteSubtree');
      return newRootId;
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
        const { history, historyIndex } = appendHistory(state, nodes, state.transforms);
        return { nodes, history, historyIndex };
      }, false, 'designer/moveNode');
    },

    deleteNode: (nodeId) => {
      setWithIndex((state) => {
        const nodes = patchDeleteNode(state.nodes, nodeId);
        if (nodes === state.nodes) return state;
        const remainingIds = new Set(nodes.map((node) => node.id));
        const { history, historyIndex } = appendHistory(state, nodes, state.transforms);
        // Deleting the selection keeps the user in place: the next sibling, else the
        // previous one, else the container it was in (never the page itself).
        const resolveSelectionAfterDelete = (): string | null => {
          const deleted = state.nodesById[nodeId];
          const parent = deleted?.parentId ? state.nodesById[deleted.parentId] : undefined;
          if (!deleted || !parent) return null;
          const index = parent.children.indexOf(nodeId);
          const neighbour = parent.children[index + 1] ?? parent.children[index - 1];
          if (neighbour && remainingIds.has(neighbour)) return neighbour;
          return parent.type === 'page' || parent.type === 'document' ? null : parent.id;
        };
        return {
          nodes,
          history,
          historyIndex,
          selectedNodeId:
            state.selectedNodeId === nodeId
              ? resolveSelectionAfterDelete()
              : state.selectedNodeId && remainingIds.has(state.selectedNodeId)
                ? state.selectedNodeId
                : null,
          hoverNodeId: state.hoverNodeId && remainingIds.has(state.hoverNodeId) ? state.hoverNodeId : null,
        };
      }, false, 'designer/deleteNode');
    },

    selectNode: (id) => {
      setWithIndex((state) => {
        const nextId = id && state.nodesById[id] ? id : null;
        return {
          selectedNodeId: nextId,
          // "After" is a one-selection choice; a new selection starts from "inside".
          insertPlacement: nextId === state.selectedNodeId ? state.insertPlacement : 'inside',
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
          transforms: deepCloneJson(entry.transforms),
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
          transforms: deepCloneJson(entry.transforms),
          historyIndex: nextIndex,
        };
      }, false, 'designer/redo');
    },

    resetWorkspace: () => {
      const nodes = createInitialNodes();
      setWithIndex((state) => ({
        nodes,
        transforms: createEmptyDesignerTransformWorkspace(),
        selectedNodeId: null,
        hoverNodeId: null,
        history: [createHistoryEntry(nodes, createEmptyDesignerTransformWorkspace())],
        historyIndex: 0,
        workspaceLoadCount: state.workspaceLoadCount + 1,
      }));
    },

    loadNodes: (nodes) => {
      setWithIndex((state) => {
        const nextNodes = snapshotNodes(nodes);
        return {
          nodes: nextNodes,
          transforms: createEmptyDesignerTransformWorkspace(),
          history: [createHistoryEntry(nextNodes, createEmptyDesignerTransformWorkspace())],
          historyIndex: 0,
          selectedNodeId: null,
        };
      }, false, 'designer/loadNodes');
    },

    loadWorkspace: (workspace) => {
      setWithIndex((state) => {
        const legacyNodes = (workspace as { nodes?: unknown }).nodes;
        const legacyNodesById = Array.isArray(legacyNodes)
          ? (Object.fromEntries(
              (legacyNodes as Array<Record<string, unknown>>)
                .filter((node): node is Record<string, unknown> & { id: string } => typeof node?.id === 'string')
                .map((node) => [node.id, node as unknown as DesignerWorkspaceSnapshot['nodesById'][string]])
            ) as DesignerWorkspaceSnapshot['nodesById'])
          : null;
        const incomingNodesById = legacyNodesById ?? workspace.nodesById ?? {};
        const requestedRootId = typeof workspace.rootId === 'string' ? workspace.rootId : null;
        const canUseExistingRootId =
          !requestedRootId && typeof state.rootId === 'string' && Boolean(incomingNodesById[state.rootId]);
        const fallbackRootId =
          Object.values(incomingNodesById).find((node) => node.type === 'document')?.id ??
          Object.keys(incomingNodesById)[0] ??
          state.rootId;
        const nextRootId = requestedRootId ?? (canUseExistingRootId ? state.rootId : fallbackRootId);
        const nextNodes = materializeNodesFromSnapshot({
          nodesById: incomingNodesById,
          rootId: nextRootId,
        });
        const nextTransforms = sanitizeTransformWorkspace(workspace.transforms);
        return {
          rootId: nextRootId,
          nodes: nextNodes,
          transforms: nextTransforms,
          snapToGrid: typeof workspace.snapToGrid === 'boolean' ? workspace.snapToGrid : state.snapToGrid,
          gridSize: typeof workspace.gridSize === 'number' ? workspace.gridSize : state.gridSize,
          showGuides: typeof workspace.showGuides === 'boolean' ? workspace.showGuides : state.showGuides,
          showRulers: typeof workspace.showRulers === 'boolean' ? workspace.showRulers : state.showRulers,
          canvasScale: typeof workspace.canvasScale === 'number' ? workspace.canvasScale : state.canvasScale,
          workspaceLoadCount: state.workspaceLoadCount + 1,
          history: [createHistoryEntry(nextNodes, nextTransforms)],
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
        transforms: deepCloneJson(state.transforms),
        snapToGrid: state.snapToGrid,
        gridSize: state.gridSize,
        showGuides: state.showGuides,
        showRulers: state.showRulers,
        canvasScale: state.canvasScale,
      };
    },

    setTransforms: (transforms, commit = true) => {
      setWithIndex((state) => {
        const nextTransforms = sanitizeTransformWorkspace(transforms);
        if (!commit) {
          return {
            transforms: nextTransforms,
          };
        }
        const { history, historyIndex } = appendHistory(state, state.nodes, nextTransforms);
        return {
          transforms: nextTransforms,
          history,
          historyIndex,
        };
      }, false, 'designer/setTransforms');
    },

    recordDropResult: (success) => {
      setWithIndex((state) => ({
        metrics: {
          ...state.metrics,
          totalDrags: state.metrics.totalDrags + 1,
          completedDrops: state.metrics.completedDrops + (success ? 1 : 0),
          failedDrops: state.metrics.failedDrops + (success ? 0 : 1),
        },
      }));
    },
  };
  })
);
