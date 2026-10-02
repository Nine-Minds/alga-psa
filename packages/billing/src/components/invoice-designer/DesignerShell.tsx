/* eslint-disable custom-rules/no-feature-to-feature-imports -- Invoice designer uses shared expression-authoring utilities for template variable insertion and validation */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { generateUUID } from '@alga-psa/core';
import type { Modifier } from '@dnd-kit/core';
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragMoveEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  type CollisionDetection,
  useDndMonitor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import clsx from 'clsx';
import { restrictToWindowEdges, createSnapModifier } from '@dnd-kit/modifiers';
import {
  clampInvoiceMarginMm,
  listInvoicePaperPresets,
  resolveTemplatePrintSettings,
  type TemplateFieldDisplayFormat,
  type TemplatePrintSettings,
} from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { ComponentPalette } from './palette/ComponentPalette';
import { DesignCanvas } from './canvas/DesignCanvas';
import { DesignerToolbar } from './toolbar/DesignerToolbar';
import type { DesignerComponentType, DesignerNode, DesignerNodeStyle, Point, Size } from './state/designerStore';
import { clampNodeSizeToPracticalMinimum, getAbsolutePosition, useInvoiceDesignerStore } from './state/designerStore';
import { AlignmentGuide, resolveFlexPadding } from './utils/layout';
import { getDefinition } from './constants/componentCatalog';
import { getPresetById } from './constants/presets';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import {
  insertTextIntoDomControl,
  insertTextIntoValue,
  validateSourcePaths,
  type ExpressionMode,
} from '@alga-psa/workflows/expression-authoring';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import type { LucideIcon } from 'lucide-react';
import {
  AlignCenter,
  AlignHorizontalDistributeCenter,
  AlignHorizontalSpaceAround,
  AlignHorizontalSpaceBetween,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  BoxSelect,
  ClipboardPaste,
  Copy,
  CopyPlus,
  CornerLeftUp,
  CornerRightDown,
  PaintBucket,
  Paintbrush,
  Trash2,
  Maximize2,
  Scaling,
  Shrink,
  StretchHorizontal,
  Grid3X3,
} from 'lucide-react';
import { useDesignerShortcuts } from './hooks/useDesignerShortcuts';
import { useStructureCommands, type StructureCommand } from './hooks/useStructureCommands';
import { planSubtreeRename, resolveInsertionTarget } from './utils/structureEditing';
import { canNestWithinParent, getAllowedParentsForType, getComponentSchema } from './schema/componentSchema';
import type { DesignerInspectorTab } from './schema/inspectorSchema';
import { invoiceDesignerCollisionDetection } from './utils/dndCollision';
import { resolveInsertPositionFromRects } from './utils/dropIndicator';
import { DesignerSchemaInspector } from './inspector/DesignerSchemaInspector';
import { NodeOverridesSummary } from './inspector/NodeOverridesSummary';
import DocumentImagePickerWidget from './inspector/widgets/DocumentImagePickerWidget';
import { normalizeCssLength } from './inspector/normalizers';
import { getNodeLayout, getNodeMetadata, getNodeName, getNodeStyle } from './utils/nodeProps';
import {
  resolveHeightValueForMode,
  resolveWidthValueForMode,
  type DesignerHeightMode,
  type DesignerWidthMode,
} from './utils/sizeModes';
import { resolveDesignerDocumentKind } from './utils/documentKind';
import {
  buildDocumentExpressionPathOptions,
  resolveDocumentFieldLabel,
} from './fields/documentBindingCatalog';
import { getTemplateFieldDefinition, getTemplateFieldDisplayFormats } from './fields/fieldCatalog';

const DROPPABLE_CANVAS_ID = 'designer-canvas';

type ActiveDragState =
  | { kind: 'component'; componentType: DesignerComponentType }
  | { kind: 'preset'; presetId: string }
  | { kind: 'node'; nodeId: string }
  | null;

type PaletteDragData =
  | {
      source: 'component';
      componentType: DesignerComponentType;
    }
  | {
      source: 'preset';
      presetId: string;
    };

type NodeDragData = {
  dragKind: 'node';
  nodeId: string;
  layoutKind: 'absolute' | 'flow';
};

type DropTargetMeta = {
  nodeId: string;
  nodeType: DesignerComponentType;
  allowedChildren: DesignerComponentType[];
};

type DropFeedback = {
  tone: 'info' | 'error';
  message: string;
};

type DropIndicator =
  | { kind: 'insert'; overNodeId: string; position: 'before' | 'after'; tone: 'valid' | 'invalid' }
  | { kind: 'container'; containerId: string; tone: 'invalid' }
  | null;

type ComponentDropResolution =
  | { ok: true; parentId: string }
  | { ok: false; message: string };

type ComponentInsertOptions = {
  dropMeta?: DropTargetMeta;
  dropPoint?: Point;
  requireCanvasPointer?: boolean;
  strictSelectionPath?: boolean;
  selectedNodeIdOverride?: string | null;
  preserveSelectionId?: string | null;
};

type PresetInsertOptions = {
  dropMeta?: DropTargetMeta;
  dropPoint?: Point;
  requireDropTarget?: boolean;
};

type DesignerTestApi = {
  insertComponent: (type: DesignerComponentType) => boolean;
  insertPreset: (id: string) => boolean;
  selectNode: (id: string | null) => void;
  simulateComponentDrop: (
    type: DesignerComponentType,
    targetNodeId?: string | 'canvas',
    dropPoint?: Point
  ) => boolean;
  simulatePresetDrop: (presetId: string, targetNodeId?: string | 'canvas', dropPoint?: Point) => boolean;
  setForcedDropTarget: (nodeId: string | 'canvas' | null) => void;
};

declare global {
  interface Window {
    __ALGA_INVOICE_DESIGNER_TEST_API__?: DesignerTestApi;
  }
}

const isPaletteDragData = (value: unknown): value is PaletteDragData =>
  typeof value === 'object' &&
  value !== null &&
  'source' in value &&
  ((value as { source?: unknown }).source === 'component' || (value as { source?: unknown }).source === 'preset');

const isNodeDragData = (value: unknown): value is NodeDragData =>
  typeof value === 'object' &&
  value !== null &&
  'dragKind' in value &&
  (value as { dragKind?: unknown }).dragKind === 'node' &&
  'nodeId' in value &&
  typeof (value as { nodeId?: unknown }).nodeId === 'string';

const isDropTargetMeta = (value: unknown): value is DropTargetMeta =>
  typeof value === 'object' &&
  value !== null &&
  'nodeId' in value &&
  typeof (value as { nodeId?: unknown }).nodeId === 'string' &&
  'nodeType' in value &&
  typeof (value as { nodeType?: unknown }).nodeType === 'string' &&
  'allowedChildren' in value &&
  Array.isArray((value as { allowedChildren?: unknown }).allowedChildren);

const getPracticalMinimumSizeForType = (type: DesignerComponentType): { width: number; height: number } => {
  switch (type) {
    case 'section':
      return { width: 160, height: 96 };
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
    default:
      return { width: 72, height: 24 };
  }
};

/** Every node below `rootId`, depth first. */
const collectDescendants = (nodesById: Record<string, DesignerNode>, rootId: string): DesignerNode[] => {
  const result: DesignerNode[] = [];
  const visit = (id: string) => {
    nodesById[id]?.children.forEach((childId) => {
      const child = nodesById[childId];
      if (!child) return;
      result.push(child);
      visit(childId);
    });
  };
  visit(rootId);
  return result;
};

const getSectionFitSizeFromChildren = (
  section: DesignerNode,
  nodesById: Map<string, DesignerNode>
): Size | null => {
  const sectionChildren = section.children
    .map((childId) => nodesById.get(childId))
    .filter((node): node is DesignerNode => Boolean(node));

  if (sectionChildren.length === 0) {
    return null;
  }

  const padding = resolveFlexPadding(getNodeLayout(section));
  const furthestRight = sectionChildren.reduce((max, child) => {
    const right = Math.max(0, child.position.x) + Math.max(0, child.size.width);
    return right > max ? right : max;
  }, 0);
  const furthestBottom = sectionChildren.reduce((max, child) => {
    const bottom = Math.max(0, child.position.y) + Math.max(0, child.size.height);
    return bottom > max ? bottom : max;
  }, 0);
  const minimum = getPracticalMinimumSizeForType('section');

  return {
    width: Math.max(minimum.width, Math.ceil(furthestRight + padding)),
    height: Math.max(minimum.height, Math.ceil(furthestBottom + padding)),
  };
};

type SectionFitIntent = { status: 'no-children' } | { status: 'already-fitted' } | { status: 'fit-needed'; size: Size };

const sizesAreEffectivelyEqual = (left: Size, right: Size) =>
  Math.abs(left.width - right.width) < 0.5 && Math.abs(left.height - right.height) < 0.5;

const getSectionFitIntent = (
  section: DesignerNode,
  nodesById: Map<string, DesignerNode>
): SectionFitIntent => {
  const fittedSize = getSectionFitSizeFromChildren(section, nodesById);
  if (!fittedSize) {
    return { status: 'no-children' };
  }
  if (sizesAreEffectivelyEqual(section.size, fittedSize)) {
    return { status: 'already-fitted' };
  }
  return { status: 'fit-needed', size: fittedSize };
};

const resolveNearestAncestorSection = (
  nodeId: string | null,
  nodesById: Map<string, DesignerNode>
): DesignerNode | null => {
  if (!nodeId) {
    return null;
  }
  let current: DesignerNode | null = nodesById.get(nodeId) ?? null;
  while (current) {
    if (current.type === 'section') {
      return current;
    }
    current = current.parentId ? nodesById.get(current.parentId) ?? null : null;
  }
  return null;
};

const wasSizeConstrainedFromDraft = (draft: Size, resolved: Size) => !sizesAreEffectivelyEqual(draft, resolved);

const getSectionFitNoopMessage = (_section: DesignerNode) => 'Section is already fitted.';

const shouldPromoteParentToCanvasForManualPosition = (
  node: DesignerNode | null,
  parent: DesignerNode | null,
  draft: { x: number; y: number }
) => {
  if (!node || node.type !== 'label') {
    return false;
  }
  if (!parent || getNodeLayout(parent)?.display !== 'flex') {
    return false;
  }
  if (!Number.isFinite(draft.x) || !Number.isFinite(draft.y)) {
    return false;
  }
  return Math.abs(draft.x - node.position.x) >= 0.5 || Math.abs(draft.y - node.position.y) >= 0.5;
};

const asTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

type IconToggleOption = {
  value: string;
  label: string;
  tooltip: string;
  icon: LucideIcon;
};

type GridColumnPreset = {
  id: string;
  label: string;
  template: string;
  tracks: number[];
};

type FlexItemPreset = 'natural' | 'fill' | 'share' | 'fixed' | 'custom';

const CONTAINER_LAYOUT_MODE_OPTIONS: IconToggleOption[] = [
  { value: 'flex', label: 'Stack', tooltip: 'Stack (Flex)', icon: AlignJustify },
  { value: 'grid', label: 'Grid', tooltip: 'Grid layout', icon: Grid3X3 },
];

const CONTAINER_FLEX_DIRECTION_OPTIONS: IconToggleOption[] = [
  { value: 'column', label: 'Vertical', tooltip: 'Vertical flow', icon: ArrowDown },
  { value: 'row', label: 'Horizontal', tooltip: 'Horizontal flow', icon: ArrowRight },
];

const CONTAINER_ALIGN_ITEMS_OPTIONS: IconToggleOption[] = [
  { value: 'stretch', label: 'Stretch', tooltip: 'Stretch children', icon: ArrowUpDown },
  { value: 'flex-start', label: 'Start', tooltip: 'Align to start', icon: AlignLeft },
  { value: 'center', label: 'Center', tooltip: 'Align to center', icon: AlignCenter },
  { value: 'flex-end', label: 'End', tooltip: 'Align to end', icon: AlignRight },
];

const CONTAINER_JUSTIFY_CONTENT_OPTIONS: IconToggleOption[] = [
  { value: 'flex-start', label: 'Start', tooltip: 'Pack at start', icon: AlignLeft },
  { value: 'center', label: 'Center', tooltip: 'Pack at center', icon: AlignCenter },
  { value: 'flex-end', label: 'End', tooltip: 'Pack at end', icon: AlignRight },
  {
    value: 'space-between',
    label: 'Between',
    tooltip: 'Distribute with space between',
    icon: AlignHorizontalSpaceBetween,
  },
  {
    value: 'space-around',
    label: 'Around',
    tooltip: 'Distribute with space around',
    icon: AlignHorizontalSpaceAround,
  },
  {
    value: 'space-evenly',
    label: 'Evenly',
    tooltip: 'Distribute with equal spacing',
    icon: AlignHorizontalDistributeCenter,
  },
];

const MEDIA_HORIZONTAL_ALIGN_OPTIONS: IconToggleOption[] = [
  { value: 'left', label: 'Left', tooltip: 'Align image to the left', icon: AlignLeft },
  { value: 'center', label: 'Center', tooltip: 'Center image horizontally', icon: AlignCenter },
  { value: 'right', label: 'Right', tooltip: 'Align image to the right', icon: AlignRight },
];

const MEDIA_VERTICAL_ALIGN_OPTIONS: IconToggleOption[] = [
  { value: 'top', label: 'Top', tooltip: 'Align image to the top', icon: ArrowUp },
  { value: 'center', label: 'Center', tooltip: 'Center image vertically', icon: ArrowUpDown },
  { value: 'bottom', label: 'Bottom', tooltip: 'Align image to the bottom', icon: ArrowDown },
];

const MEDIA_OBJECT_FIT_OPTIONS: IconToggleOption[] = [
  { value: 'contain', label: 'Contain', tooltip: 'Scale to fit inside the frame', icon: Scaling },
  { value: 'cover', label: 'Cover', tooltip: 'Fill the frame and crop overflow', icon: Maximize2 },
  { value: 'fill', label: 'Fill', tooltip: 'Stretch to fill the frame', icon: StretchHorizontal },
  { value: 'none', label: 'None', tooltip: 'Keep the intrinsic image size', icon: BoxSelect },
  { value: 'scale-down', label: 'Scale Down', tooltip: 'Use intrinsic size unless it needs shrinking', icon: Shrink },
];

const INSPECTOR_TABS: DesignerInspectorTab[] = ['content', 'style', 'layout'];
const INSPECTOR_TAB_LABELS: Record<DesignerInspectorTab, string> = {
  content: 'Content',
  style: 'Style',
  layout: 'Layout & size',
};
// Blocks whose content is edited by shell controls rather than schema panels.
const SHELL_CONTENT_TYPES = new Set<DesignerComponentType>(['image', 'logo', 'qr', 'attachment-list', 'field']);

type SizeMode = 'auto' | 'fill' | 'fit' | 'fixed';

const SIZE_WIDTH_MODE_OPTIONS: IconToggleOption[] = [
  { value: 'auto', label: 'Auto', tooltip: 'Let the container decide (stretches in a vertical stack)', icon: ArrowUpDown },
  { value: 'fill', label: 'Fill', tooltip: 'Fill the full width of the container', icon: Maximize2 },
  { value: 'fit', label: 'Fit', tooltip: 'Shrink to fit the content', icon: Shrink },
  { value: 'fixed', label: 'Fixed', tooltip: 'Use the exact width typed below', icon: BoxSelect },
];

const SIZE_HEIGHT_MODE_OPTIONS: IconToggleOption[] = [
  { value: 'auto', label: 'Auto', tooltip: 'Grow with the content', icon: ArrowUpDown },
  { value: 'fixed', label: 'Fixed', tooltip: 'Use the exact height typed below', icon: BoxSelect },
];

const resolveSizeMode = (value: string): SizeMode => {
  const normalized = value.trim().toLowerCase();
  if (normalized === '' || normalized === 'auto') return 'auto';
  if (normalized === '100%') return 'fill';
  if (normalized === 'fit-content' || normalized === 'max-content' || normalized === 'min-content') return 'fit';
  return 'fixed';
};


const FLEX_ITEM_PRESET_OPTIONS: Array<{
  value: Exclude<FlexItemPreset, 'custom'>;
  label: string;
  description: string;
}> = [
  {
    value: 'natural',
    label: 'Natural',
    description: 'Use the item content size, but allow it to shrink if space is tight.',
  },
  {
    value: 'fill',
    label: 'Fill',
    description: 'Expand into leftover space while keeping the item’s preferred size.',
  },
  {
    value: 'share',
    label: 'Share',
    description: 'Split available space evenly with other shared items.',
  },
  {
    value: 'fixed',
    label: 'Fixed',
    description: 'Keep the item size and do not let flexbox shrink it.',
  },
];

const GRID_COLUMN_PRESETS: GridColumnPreset[] = [
  { id: 'single', label: '1 column', template: '1fr', tracks: [1] },
  { id: 'two-equal', label: '2 equal columns', template: '1fr 1fr', tracks: [1, 1] },
  { id: 'sidebar-main', label: 'Sidebar + main', template: '1fr 2fr', tracks: [1, 2] },
  { id: 'main-sidebar', label: 'Main + sidebar', template: '2fr 1fr', tracks: [2, 1] },
  { id: 'three-equal', label: '3 equal columns', template: '1fr 1fr 1fr', tracks: [1, 1, 1] },
];

const normalizeGridTemplateColumns = (value: string | undefined): string =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';

const coerceFlexNumber = (value: unknown, fallback: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const numeric = Number(value.trim());
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return fallback;
};

const normalizeCssToken = (value: unknown): string => (typeof value === 'string' ? value.trim().toLowerCase() : '');

const inferFlexItemPreset = (style: Partial<DesignerNodeStyle> | undefined): FlexItemPreset => {
  const grow = coerceFlexNumber(style?.flexGrow, 0);
  const shrink = coerceFlexNumber(style?.flexShrink, 1);
  const basis = normalizeCssToken(style?.flexBasis);

  if (grow === 0 && shrink === 1 && (basis === '' || basis === 'auto')) {
    return 'natural';
  }
  if (grow === 1 && shrink === 1 && (basis === '' || basis === 'auto')) {
    return 'fill';
  }
  if (grow === 1 && shrink === 1 && (basis === '0' || basis === '0%' || basis === '0px')) {
    return 'share';
  }
  if (grow === 0 && shrink === 0 && (basis === '' || basis === 'auto')) {
    return 'fixed';
  }
  return 'custom';
};

const humanizeBindingToken = (input: string): string =>
  input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._\-/#:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((part) => {
      if (part.length <= 2) {
        return part.toUpperCase();
      }
      return `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`;
    })
    .join(' ');

const resolveFieldTypeLabel = (bindingKey: string): string => {
  const normalized = bindingKey.trim();
  if (!normalized) {
    return 'Unbound';
  }
  return resolveDocumentFieldLabel(normalized);
};

const resolveSelectedFieldType = (selectedNode: DesignerNode | null): { label: string; bindingKey: string } | null => {
  if (!selectedNode || selectedNode.type !== 'field') {
    return null;
  }
  const metadata = getNodeMetadata(selectedNode) as Record<string, unknown>;
  const bindingKey =
    asTrimmedString(metadata.bindingKey) ||
    asTrimmedString(metadata.binding) ||
    asTrimmedString(metadata.path);

  return {
    label: resolveFieldTypeLabel(bindingKey),
    bindingKey,
  };
};

const resolveSelectedNodeTypeLabel = (selectedNode: DesignerNode | null): string => {
  if (!selectedNode) {
    return '';
  }
  const definition = getDefinition(selectedNode.type);
  if (definition?.label) {
    return definition.label;
  }
  return humanizeBindingToken(selectedNode.type);
};

const resolveInsertModeFromTargetPath = (targetPath: string | null): ExpressionMode => {
  if (typeof targetPath === 'string' && targetPath.trim().toLowerCase().endsWith('bindingkey')) {
    return 'path-only';
  }
  return 'template';
};

const formatBindingInsertValue = (bindingPath: string, mode: ExpressionMode): string =>
  mode === 'path-only' ? bindingPath : `{{${bindingPath}}}`;

const tryInsertTemplateIntoFocusedInput = (
  bindingPath: string
): { insertedValue: string; mode: ExpressionMode } | null => {
  if (typeof document === 'undefined') {
    return null;
  }
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement)) {
    return null;
  }

  const targetPath = activeElement.getAttribute('data-template-insert-target');
  if (!targetPath) {
    return null;
  }

  const mode = resolveInsertModeFromTargetPath(targetPath);
  const insertValue = formatBindingInsertValue(bindingPath, mode);
  const result = insertTextIntoDomControl(activeElement, insertValue, { requireFocus: true });
  if (!result.didInsert) {
    return null;
  }
  return { insertedValue: insertValue, mode };
};

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

const resolveDesignerShellPrintSettings = (nodes: DesignerNode[]) => {
  const documentNode = nodes.find((node) => node.type === 'document');
  const pageNode = documentNode
    ? nodes.find((node) => node.type === 'page' && node.parentId === documentNode.id)
    : nodes.find((node) => node.type === 'page');
  const documentMetadata = documentNode ? getNodeMetadata(documentNode) : {};
  const pageLayout = pageNode ? getNodeLayout(pageNode) : undefined;
  const pageStyle = pageNode ? getNodeStyle(pageNode) : undefined;

  return resolveTemplatePrintSettings({
    printSettings:
      typeof documentMetadata.printSettings === 'object' && documentMetadata.printSettings !== null
        ? (documentMetadata.printSettings as Partial<TemplatePrintSettings>)
        : undefined,
    pageWidthPx: pageNode?.size.width ?? parsePxLength(pageStyle?.width),
    pageHeightPx: pageNode?.size.height ?? parsePxLength(pageStyle?.height),
    documentWidthPx: documentNode?.size.width,
    documentHeightPx: documentNode?.size.height,
    pagePaddingPx: parsePxLength(pageLayout?.padding),
  });
};

export const DesignerShell: React.FC = () => {
  const { t } = useTranslation('msp/invoicing');
  const nodes = useInvoiceDesignerStore((state) => state.nodes);
  const selectedNodeId = useInvoiceDesignerStore((state) => state.selectedNodeId);
  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId) ?? null, [nodes, selectedNodeId]);
  const documentKind = useMemo(() => resolveDesignerDocumentKind(nodes), [nodes]);
  const invoicePathOptions = useMemo(
    () =>
      buildDocumentExpressionPathOptions({
        includeRootPaths: false,
        documentKind,
      }),
    [documentKind]
  );
  const addNode = useInvoiceDesignerStore((state) => state.addNodeFromPalette);
  const insertPreset = useInvoiceDesignerStore((state) => state.insertPreset);
  const applyPrintSettings = useInvoiceDesignerStore((state) => state.applyPrintSettings);
  const moveNode = useInvoiceDesignerStore((state) => state.moveNode);
  const setNodeProp = useInvoiceDesignerStore((state) => state.setNodeProp);
  const unsetNodeProp = useInvoiceDesignerStore((state) => state.unsetNodeProp);
  const selectNode = useInvoiceDesignerStore((state) => state.selectNode);
  const toggleSnap = useInvoiceDesignerStore((state) => state.toggleSnap);
  const snapToGrid = useInvoiceDesignerStore((state) => state.snapToGrid);
  const toggleGuides = useInvoiceDesignerStore((state) => state.toggleGuides);
  const showGuides = useInvoiceDesignerStore((state) => state.showGuides);
  const toggleRulers = useInvoiceDesignerStore((state) => state.toggleRulers);
  const showRulers = useInvoiceDesignerStore((state) => state.showRulers);
  const setCanvasScale = useInvoiceDesignerStore((state) => state.setCanvasScale);
  const canvasScale = useInvoiceDesignerStore((state) => state.canvasScale);
  const gridSize = useInvoiceDesignerStore((state) => state.gridSize);
  const setGridSize = useInvoiceDesignerStore((state) => state.setGridSize);
  const undo = useInvoiceDesignerStore((state) => state.undo);
  const redo = useInvoiceDesignerStore((state) => state.redo);
  const metrics = useInvoiceDesignerStore((state) => state.metrics);
  const recordDropResult = useInvoiceDesignerStore((state) => state.recordDropResult);
  const currentPrintSettings = useMemo(() => resolveDesignerShellPrintSettings(nodes), [nodes]);
  const [printMarginDraft, setPrintMarginDraft] = useState(() => `${currentPrintSettings.marginMm}`);

  useEffect(() => {
    setPrintMarginDraft(`${currentPrintSettings.marginMm}`);
  }, [currentPrintSettings.marginMm]);

  const resizeNode = useCallback(
    (
      id: string,
      size: Size,
      commit: boolean = false,
      options: { widthMode?: DesignerWidthMode; heightMode?: DesignerHeightMode } = {}
    ) => {
      const node = useInvoiceDesignerStore.getState().nodesById[id];
      if (!node) return;

      const clamped = clampNodeSizeToPracticalMinimum(node.type, size);
      const rounded = {
        width: Math.round(clamped.width),
        height: Math.round(clamped.height),
      };
      const widthMode = options.widthMode ?? 'fixed';
      const heightMode = options.heightMode ?? 'fixed';

      // Batch updates without generating multiple history entries.
      setNodeProp(id, 'size.width', rounded.width, false);
      setNodeProp(id, 'size.height', rounded.height, false);
      setNodeProp(id, 'baseSize.width', rounded.width, false);
      setNodeProp(id, 'baseSize.height', rounded.height, false);
      setNodeProp(id, 'style.width', resolveWidthValueForMode(widthMode, { ...node, size: rounded }), false);
      setNodeProp(id, 'style.height', resolveHeightValueForMode(heightMode, { ...node, size: rounded }), commit);
    },
    [setNodeProp]
  );

  const handleTextEdit = useCallback(
    (id: string, text: string, commit: boolean) => {
      setNodeProp(id, 'metadata.text', text, commit);
    },
    [setNodeProp]
  );

  // Constraints were removed as part of the CSS-first layout cutover.
  const referenceNodeId = null;
  const selectedCounterpartNodeIds = useMemo(() => new Set<string>(), []);
  const selectedPreset = selectedNode?.layoutPresetId ? getPresetById(selectedNode.layoutPresetId) : null;
  const selectedNodeTypeLabel = useMemo(() => resolveSelectedNodeTypeLabel(selectedNode), [selectedNode]);
  const selectedFieldType = useMemo(() => resolveSelectedFieldType(selectedNode), [selectedNode]);
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node] as const)), [nodes]);
  const selectedContainerLayout = useMemo(() => {
    if (!selectedNode || (selectedNode.type !== 'container' && selectedNode.type !== 'section')) {
      return undefined;
    }
    return getNodeLayout(selectedNode);
  }, [selectedNode]);
  const selectedParentNode = useMemo(
    () => (selectedNode?.parentId ? nodesById.get(selectedNode.parentId) ?? null : null),
    [nodesById, selectedNode]
  );
  const selectedParentFlexLayout = useMemo(() => {
    if (!selectedParentNode) {
      return null;
    }
    const layout = getNodeLayout(selectedParentNode);
    return layout?.display === 'flex' ? layout : null;
  }, [selectedParentNode]);
  const selectedSizingStyle = useMemo(() => getNodeStyle(selectedNode ?? undefined), [selectedNode]);
  const selectedFlexItemPreset = useMemo(
    () => inferFlexItemPreset(selectedSizingStyle),
    [selectedSizingStyle]
  );
  const selectedFieldDisplayFormats = useMemo(() => {
    if (!selectedFieldType) {
      return [];
    }
    return getTemplateFieldDisplayFormats(selectedFieldType.bindingKey);
  }, [selectedFieldType]);
  const selectedMediaParentSection = useMemo(() => {
    if (!selectedNode || !['image', 'logo', 'qr'].includes(selectedNode.type)) {
      return null;
    }
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    return resolveNearestAncestorSection(selectedNode.id, nodesById);
  }, [nodes, selectedNode]);
  const selectedSectionFitSize = useMemo(() => {
    if (!selectedNode || selectedNode.type !== 'section') {
      return null;
    }
    return getSectionFitSizeFromChildren(selectedNode, new Map(nodes.map((node) => [node.id, node])));
  }, [nodes, selectedNode]);

	  useDesignerShortcuts();
	  const structureCommands = useStructureCommands();
	  const nameBeforeEditRef = useRef('');
	  const [renameSuggestion, setRenameSuggestion] = useState<{
	    nodeId: string;
	    plan: Array<{ from: string; to: string }>;
	  } | null>(null);
	  // Offer to carry a renamed copy's new name onto its inner layers (from-label-2 -> bill-to-label).
	  const suggestInnerLayerRename = useCallback((nodeId: string, previousName: string, nextName: string) => {
	    const { nodesById: liveNodesById } = useInvoiceDesignerStore.getState();
	    const descendantNames = collectDescendants(liveNodesById, nodeId)
	      .map((node) => getNodeName(node))
	      .filter((name) => name.length > 0);
	    const plan = planSubtreeRename(previousName, nextName.trim(), descendantNames);
	    setRenameSuggestion(plan ? { nodeId, plan } : null);
	  }, []);
	  const applyInnerLayerRename = useCallback(() => {
	    if (!renameSuggestion) return;
	    const renames = new Map(renameSuggestion.plan.map(({ from, to }) => [from, to] as const));
	    const targets = collectDescendants(useInvoiceDesignerStore.getState().nodesById, renameSuggestion.nodeId).filter(
	      (node) => renames.has(getNodeName(node))
	    );
	    targets.forEach((node, index) =>
	      setNodeProp(node.id, 'name', renames.get(getNodeName(node)) ?? getNodeName(node), index === targets.length - 1)
	    );
	    setRenameSuggestion(null);
	  }, [renameSuggestion, setNodeProp]);
	  useEffect(() => {
	    setRenameSuggestion((current) => (current && current.nodeId !== selectedNodeId ? null : current));
	  }, [selectedNodeId]);
	  const inspectorTab = useInvoiceDesignerStore((state) => state.inspectorTab);
	  const setInspectorTab = useInvoiceDesignerStore((state) => state.setInspectorTab);
	  const selectedHasContentTab = useMemo(
	    () =>
	      Boolean(selectedNode) &&
	      (SHELL_CONTENT_TYPES.has(selectedNode!.type) ||
	        (getComponentSchema(selectedNode!.type).inspector?.panels ?? []).some((panel) => (panel.tab ?? 'content') === 'content')),
	    [selectedNode]
	  );
	  // The tab sticks while moving between blocks; one with nothing to fill in opens on Style.
	  const activeInspectorTab: DesignerInspectorTab =
	    inspectorTab === 'content' && !selectedHasContentTab ? 'style' : inspectorTab;
	  const inspectorPanelRef = useRef<HTMLElement | null>(null);
	  // Each block's inspector starts at its top, not wherever the last one was scrolled.
	  useEffect(() => {
	    inspectorPanelRef.current?.scrollTo?.({ top: 0 });
	  }, [selectedNodeId]);
	
	  const [activeDrag, setActiveDrag] = useState<ActiveDragState>(null);
	  const [dropIndicator, setDropIndicator] = useState<DropIndicator>(null);
	  const [dropFeedback, setDropFeedback] = useState<DropFeedback | null>(null);
	  const [forcedDropTarget, setForcedDropTarget] = useState<string | 'canvas' | null>(null);
	  const pointerRef = useRef<{ x: number; y: number } | null>(null);
	  const dropFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	  
	  const sensors = useSensors(
	    useSensor(PointerSensor, {
	      activationConstraint: {
	        distance: 5,
      },
    }),
    useSensor(KeyboardSensor)
  );

  const collisionDetection = useCallback<CollisionDetection>(invoiceDesignerCollisionDetection, []);

  React.useEffect(() => {
    if (selectedNodeId && !selectedNode) {
      selectNode(null);
    }
  }, [selectedNode, selectedNodeId, selectNode]);

  const updatePointerLocation = useCallback((point: { x: number; y: number } | null) => {
    pointerRef.current = point;
  }, []);

  const clearDropFeedback = useCallback(() => {
    if (dropFeedbackTimeoutRef.current) {
      clearTimeout(dropFeedbackTimeoutRef.current);
      dropFeedbackTimeoutRef.current = null;
    }
    setDropFeedback(null);
  }, []);

  const showDropFeedback = useCallback((tone: DropFeedback['tone'], message: string) => {
    if (dropFeedbackTimeoutRef.current) {
      clearTimeout(dropFeedbackTimeoutRef.current);
    }
    setDropFeedback({ tone, message });
    dropFeedbackTimeoutRef.current = setTimeout(() => {
      setDropFeedback(null);
      dropFeedbackTimeoutRef.current = null;
    }, 2200);
  }, []);

  React.useEffect(() => {
    return () => {
      if (dropFeedbackTimeoutRef.current) {
        clearTimeout(dropFeedbackTimeoutRef.current);
      }
    };
  }, []);

  const snapModifier = useMemo<Modifier | null>(() => {
    if (!snapToGrid) {
      return null;
    }
    const pixelGrid = Math.max(1, gridSize * canvasScale);
    return createSnapModifier(pixelGrid);
  }, [snapToGrid, gridSize, canvasScale]);

  const modifiers = useMemo<Modifier[]>(() => {
    const base: Modifier[] = [restrictToWindowEdges];
    return snapModifier ? [...base, snapModifier] : base;
  }, [snapModifier]);

  const resolvePageForDrop = useCallback((nodesForDrop: DesignerNode[], startNodeId?: string): DesignerNode | null => {
    const nodesById = new Map(nodesForDrop.map((node) => [node.id, node]));
    let current = startNodeId ? nodesById.get(startNodeId) ?? null : null;
    while (current) {
      if (current.type === 'page') {
        return current;
      }
      current = current.parentId ? nodesById.get(current.parentId) ?? null : null;
    }

    const documentNode =
      nodesForDrop.find((node) => node.type === 'document' && node.parentId === null) ??
      nodesForDrop.find((node) => node.parentId === null);
    if (!documentNode) {
      return nodesForDrop.find((node) => node.type === 'page') ?? null;
    }

    return (
      documentNode.children
        .map((childId) => nodesById.get(childId))
        .find((node): node is DesignerNode => Boolean(node && node.type === 'page')) ??
      nodesForDrop.find((node) => node.type === 'page') ??
      null
    );
  }, []);

  const resolveCanvasDropMeta = useCallback((nodesForDrop: DesignerNode[]): DropTargetMeta | undefined => {
    const documentNode =
      nodesForDrop.find((node) => node.type === 'document' && node.parentId === null) ??
      nodesForDrop.find((node) => node.parentId === null);
    if (!documentNode) {
      return undefined;
    }
    const pageNode = nodesForDrop.find((node) => node.type === 'page' && node.parentId === documentNode.id);
    const root = pageNode ?? documentNode;
    return {
      nodeId: root.id,
      nodeType: root.type,
      allowedChildren: root.allowedChildren,
    };
  }, []);

  const resolveDropMetaFromTarget = useCallback(
    (targetNodeId?: string | 'canvas'): DropTargetMeta | undefined => {
      const nodesForDrop = useInvoiceDesignerStore.getState().nodes;
      if (!targetNodeId || targetNodeId === 'canvas') {
        return resolveCanvasDropMeta(nodesForDrop);
      }
      const node = nodesForDrop.find((candidate) => candidate.id === targetNodeId);
      if (!node) {
        return undefined;
      }
      return {
        nodeId: node.id,
        nodeType: node.type,
        allowedChildren: node.allowedChildren,
      };
    },
    [resolveCanvasDropMeta]
  );

  const resolveComponentDropParent = useCallback(
    (
      componentType: DesignerComponentType,
      dropMeta: DropTargetMeta | undefined,
      _dropPoint: Point,
      options: { strictSelectionPath?: boolean; selectedNodeIdOverride?: string | null } = {}
    ): ComponentDropResolution => {
      const state = useInvoiceDesignerStore.getState();
      const nodesForDrop = state.nodes;
      const nodesById = new Map(nodesForDrop.map((node) => [node.id, node]));
      const dropNode = dropMeta?.nodeId ? nodesById.get(dropMeta.nodeId) : undefined;
      const selectedNodeIdForResolution = options.selectedNodeIdOverride ?? state.selectedNodeId;

      const resolveFromNode = (start: DesignerNode | null | undefined): string | null => {
        let current = start ?? null;
        while (current) {
          if (canNestWithinParent(componentType, current.type)) {
            return current.id;
          }
          current = current.parentId ? nodesById.get(current.parentId) ?? null : null;
        }
        return null;
      };

      const resolvedFromDrop = resolveFromNode(dropNode);
      if (resolvedFromDrop) {
        return { ok: true, parentId: resolvedFromDrop };
      }

      const resolvedFromSelection = selectedNodeIdForResolution
        ? resolveFromNode(nodesById.get(selectedNodeIdForResolution))
        : null;
      if (resolvedFromSelection) {
        return { ok: true, parentId: resolvedFromSelection };
      }

      const pageNode = resolvePageForDrop(nodesForDrop, dropNode?.id ?? selectedNodeIdForResolution ?? undefined);
      if (pageNode && canNestWithinParent(componentType, pageNode.type)) {
        return { ok: true, parentId: pageNode.id };
      }

      const allowedParents = getAllowedParentsForType(componentType);
      const fallback = nodesForDrop.find((node) => allowedParents.includes(node.type)) ?? null;
      if (fallback) {
        return { ok: true, parentId: fallback.id };
      }

      return { ok: false, message: 'Drop target is not compatible for this component.' };
    },
    [resolvePageForDrop]
  );

  const getDefaultInsertionPoint = useCallback((options?: { preferSelectionAnchor?: boolean; selectionAnchorId?: string | null }): Point => {
    const preferSelectionAnchor = options?.preferSelectionAnchor ?? false;
    const anchorNodeId = options?.selectionAnchorId ?? selectedNodeId;

    if (!preferSelectionAnchor && pointerRef.current) {
      return pointerRef.current;
    }

    if (anchorNodeId) {
      const selected = nodes.find((node) => node.id === anchorNodeId);
      if (selected) {
        const absolute = getAbsolutePosition(selected.id, nodes);
        return {
          x: absolute.x + Math.min(24, Math.max(8, selected.size.width / 6)),
          y: absolute.y + Math.min(24, Math.max(8, selected.size.height / 6)),
        };
      }
    }

    const page = resolvePageForDrop(nodes, anchorNodeId ?? undefined);
    if (page) {
      const absolute = getAbsolutePosition(page.id, nodes);
      return { x: absolute.x + 64, y: absolute.y + 64 };
    }

    return { x: 120, y: 120 };
  }, [nodes, resolvePageForDrop, selectedNodeId]);

  const insertComponentWithResolution = useCallback(
    (componentType: DesignerComponentType, options: ComponentInsertOptions = {}) => {
      const dropMeta = options.dropMeta;
      const selectedNodeIdForResolution =
        options.selectedNodeIdOverride ?? useInvoiceDesignerStore.getState().selectedNodeId;
      const dropPoint =
        options.dropPoint ??
        getDefaultInsertionPoint({
          preferSelectionAnchor: Boolean(options.strictSelectionPath),
          selectionAnchorId: selectedNodeIdForResolution,
        });

      if (options.requireCanvasPointer && !dropMeta && !pointerRef.current) {
        recordDropResult(false);
        showDropFeedback('error', 'Drop on the canvas to add this component.');
        return false;
      }

      const resolution = resolveComponentDropParent(componentType, dropMeta, dropPoint, {
        strictSelectionPath: options.strictSelectionPath,
        selectedNodeIdOverride: selectedNodeIdForResolution,
      });
      if (!resolution.ok) {
        recordDropResult(false);
        showDropFeedback('error', 'message' in resolution ? resolution.message : 'Drop target is not compatible.');
        return false;
      }

      const existingNodeIds = new Set(useInvoiceDesignerStore.getState().nodes.map((node) => node.id));
      addNode(
        componentType,
        dropPoint,
        { parentId: resolution.parentId }
      );
      const inserted = useInvoiceDesignerStore
        .getState()
        .nodes.some((node) => !existingNodeIds.has(node.id));
      recordDropResult(inserted);
      if (!inserted) {
        showDropFeedback('error', 'Unable to add this component in the current context.');
        return false;
      }
      if (options.preserveSelectionId) {
        const preservedExists = useInvoiceDesignerStore
          .getState()
          .nodes.some((node) => node.id === options.preserveSelectionId);
        if (preservedExists) {
          selectNode(options.preserveSelectionId);
        }
      }
      return true;
    },
    [
      addNode,
      getDefaultInsertionPoint,
      recordDropResult,
      resolveComponentDropParent,
      selectNode,
      showDropFeedback,
    ]
  );

  const insertPresetWithResolution = useCallback(
    (presetId: string, options: PresetInsertOptions = {}) => {
      const presetDef = getPresetById(presetId);
      if (!presetDef) {
        recordDropResult(false);
        showDropFeedback('error', 'Preset definition is unavailable.');
        return false;
      }

      const dropPoint = options.dropPoint ?? getDefaultInsertionPoint();
      const dropMeta = options.dropMeta;
      if (options.requireDropTarget && !dropMeta) {
        recordDropResult(false);
        showDropFeedback('error', 'Drop target is not compatible for this preset.');
        return false;
      }

      const rootTypes = presetDef.nodes.filter((node) => !node.parentKey).map((node) => node.type);
      const nodesForDrop = useInvoiceDesignerStore.getState().nodes;
      const fallbackParent = resolvePageForDrop(nodesForDrop, selectedNodeId ?? undefined);
      const resolvedParent = dropMeta
        ? nodesForDrop.find((node) => node.id === dropMeta.nodeId) ?? null
        : fallbackParent;

      if (!resolvedParent) {
        recordDropResult(false);
        showDropFeedback('error', 'Unable to resolve where to place this preset.');
        return false;
      }

      const presetDropAllowed =
        rootTypes.length > 0
          ? rootTypes.every((type) => type === resolvedParent.type || canNestWithinParent(type, resolvedParent.type))
          : canNestWithinParent('section', resolvedParent.type);
      if (!presetDropAllowed) {
        recordDropResult(false);
        showDropFeedback('error', 'Drop target is not compatible for this preset.');
        return false;
      }

      const existingNodeIds = new Set(useInvoiceDesignerStore.getState().nodes.map((node) => node.id));
      insertPreset(presetId, dropPoint, resolvedParent.id);
      const inserted = useInvoiceDesignerStore
        .getState()
        .nodes.some((node) => !existingNodeIds.has(node.id));
      recordDropResult(inserted);
      if (!inserted) {
        showDropFeedback('error', 'Unable to add this preset in the current context.');
        return false;
      }
      return true;
	    },
	    [
	      getDefaultInsertionPoint,
	      insertPreset,
	      recordDropResult,
	      resolvePageForDrop,
      selectedNodeId,
      showDropFeedback,
    ]
  );

  const cleanupDragState = useCallback(() => {
    setActiveDrag(null);
    setDropIndicator(null);
    updatePointerLocation(null);
  }, [updatePointerLocation]);

  const renderIconButtonGroup = useCallback(
    (
      keyPrefix: string,
      label: string,
      options: IconToggleOption[],
      currentValue: string,
      onSelect: (value: string) => void,
      columns: number
    ) => (
      <div className="space-y-1.5">
        <p className="text-xs text-slate-500">{label}</p>
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {options.map((option) => {
            const Icon = option.icon;
            const isSelected = option.value === currentValue;
            return (
              <Tooltip key={option.value} content={option.tooltip}>
                <button
                  type="button"
                  onClick={() => onSelect(option.value)}
                  className={clsx(
                    'min-h-8 py-1 rounded border transition-colors inline-flex flex-col items-center justify-center gap-0.5',
                    isSelected
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                      : 'border-slate-200 dark:border-[rgb(var(--color-border-200))] text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                  )}
                  aria-pressed={isSelected}
                  aria-label={`${label}: ${option.label}`}
                  data-automation-id={`designer-icon-group-${keyPrefix}-${option.value}`}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  <span className="text-[10px] leading-none">{option.label}</span>
                </button>
              </Tooltip>
            );
          })}
        </div>
      </div>
    ),
    []
  );

  const renderContainerLayoutControls = () => {
    if (!selectedNode || (selectedNode.type !== 'container' && selectedNode.type !== 'section') || !selectedContainerLayout) {
      return null;
    }

    const layoutMode = selectedContainerLayout.display ?? 'flex';
    const direction = selectedContainerLayout.flexDirection ?? 'column';
    const alignItems = selectedContainerLayout.alignItems ?? 'stretch';
    const justifyContent = selectedContainerLayout.justifyContent ?? 'flex-start';
    const activeGridTemplateColumns = normalizeGridTemplateColumns(selectedContainerLayout.gridTemplateColumns);

    return (
      <div
        className="rounded border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-3 py-2 space-y-2"
        data-automation-id="designer-container-layout-controls"
      >
        <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t('designer.inspector.layoutControls', { defaultValue: 'Layout Controls' })}</p>
        {renderIconButtonGroup('layout-mode', 'Layout', CONTAINER_LAYOUT_MODE_OPTIONS, layoutMode, (value) => {
          setNodeProp(selectedNode.id, 'layout.display', value, true);
        }, 2)}
        {layoutMode === 'grid' && (
          <div className="space-y-1.5">
            <p className="text-xs text-slate-500">Columns</p>
            <div className="grid grid-cols-2 gap-2" data-automation-id="designer-container-layout-grid-presets">
              {GRID_COLUMN_PRESETS.map((preset) => {
                const isSelected = normalizeGridTemplateColumns(preset.template) === activeGridTemplateColumns;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setNodeProp(selectedNode.id, 'layout.gridTemplateColumns', preset.template, true);
                    }}
                    className={clsx(
                      'rounded border px-2 py-2 text-left transition-colors',
                      isSelected
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                        : 'border-slate-200 dark:border-[rgb(var(--color-border-200))] text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                    )}
                    aria-pressed={isSelected}
                    aria-label={`Columns: ${preset.label}`}
                    data-automation-id={`designer-container-layout-grid-preset-${preset.id}`}
                  >
                    <div
                      className="mb-2 grid h-8 gap-1"
                      style={{
                        gridTemplateColumns: preset.tracks.map((track) => `minmax(0, ${track}fr)`).join(' '),
                      }}
                    >
                      {preset.tracks.map((track, index) => (
                        <div
                          key={`${preset.id}-${index}`}
                          className={clsx(
                            'rounded-sm border',
                            isSelected
                              ? 'border-blue-300 bg-blue-200/70 dark:border-blue-700 dark:bg-blue-800/70'
                              : 'border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800'
                          )}
                          style={{ opacity: Math.max(0.6, track / Math.max(...preset.tracks)) }}
                        />
                      ))}
                    </div>
                    <div className="text-xs font-medium">{preset.label}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {layoutMode === 'flex' && (
          <>
            {renderIconButtonGroup('layout-direction', 'Direction', CONTAINER_FLEX_DIRECTION_OPTIONS, direction, (value) => {
              setNodeProp(selectedNode.id, 'layout.flexDirection', value, true);
            }, 2)}
            {renderIconButtonGroup('layout-align-items', 'Align Items', CONTAINER_ALIGN_ITEMS_OPTIONS, alignItems, (value) => {
              setNodeProp(selectedNode.id, 'layout.alignItems', value, true);
            }, 4)}
            {renderIconButtonGroup(
              'layout-justify-content',
              'Justify Content',
              CONTAINER_JUSTIFY_CONTENT_OPTIONS,
              justifyContent,
              (value) => {
                setNodeProp(selectedNode.id, 'layout.justifyContent', value, true);
              },
              3
            )}
          </>
        )}
      </div>
    );
  };

  const renderSizeControls = () => {
    if (!selectedNode || selectedNode.type === 'document' || selectedNode.type === 'page') {
      return null;
    }
    const style = getNodeStyle(selectedNode);
    const widthValue = typeof style?.width === 'string' ? style.width : '';
    const heightValue = typeof style?.height === 'string' ? style.height : '';
    const widthMode = resolveSizeMode(widthValue);
    const heightMode = resolveSizeMode(heightValue) === 'fixed' ? 'fixed' : 'auto';

    // Switching to Fixed keeps the block exactly as big as it currently renders.
    const measureRenderedSize = (): Size => {
      const element = typeof document !== 'undefined'
        ? document.querySelector(`[data-automation-id="designer-canvas-node-${selectedNode.id}"]`)
        : null;
      const rect = element?.getBoundingClientRect();
      return rect && rect.width > 0
        ? { width: rect.width / canvasScale, height: rect.height / canvasScale }
        : selectedNode.size;
    };

    const renderLimitInput = (
      path: 'style.minWidth' | 'style.maxWidth' | 'style.minHeight' | 'style.maxHeight',
      label: string
    ) => {
      const value = typeof style?.[path.slice('style.'.length) as 'minWidth'] === 'string'
        ? (style?.[path.slice('style.'.length) as 'minWidth'] as string)
        : '';
      const id = `designer-size-${path.slice('style.'.length)}`;
      return (
        <div>
          <label htmlFor={id} className="block text-[10px] text-slate-500 mb-0.5">{label}</label>
          <Input
            id={id}
            key={`${id}-${selectedNode.id}-${value}`}
            defaultValue={value}
            placeholder="—"
            aria-label={label}
            onBlur={(event) => applyLength(path, event.target.value, true)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') applyLength(path, event.currentTarget.value, true);
            }}
          />
        </div>
      );
    };

    const applyLength = (path: `style.${'width' | 'height' | 'minWidth' | 'maxWidth' | 'minHeight' | 'maxHeight'}`, raw: string, commit: boolean) => {
      const normalized = normalizeCssLength(raw);
      if (normalized === undefined) {
        unsetNodeProp(selectedNode.id, path, commit);
        return;
      }
      setNodeProp(selectedNode.id, path, normalized, commit);
    };

    const applyWidthMode = (mode: SizeMode) => {
      const value =
        mode === 'fill' ? '100%' : mode === 'fit' ? 'fit-content' : mode === 'auto' ? 'auto' : `${Math.round(measureRenderedSize().width)}px`;
      setNodeProp(selectedNode.id, 'style.width', value, true);
    };
    const applyHeightMode = (mode: SizeMode) => {
      const value = mode === 'fixed' ? `${Math.round(measureRenderedSize().height)}px` : 'auto';
      setNodeProp(selectedNode.id, 'style.height', value, true);
    };

    return (
      <div
        className="rounded border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-3 py-2 space-y-2"
        data-automation-id="designer-size-controls"
      >
        <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t('designer.inspector.size', { defaultValue: 'Size' })}</p>
        {renderIconButtonGroup(
          'width-mode',
          t('designer.inspector.width', { defaultValue: 'Width' }),
          SIZE_WIDTH_MODE_OPTIONS.map((option) => ({
            ...option,
            label: t(`designer.inspector.sizeModes.${option.value}.label`, { defaultValue: option.label }),
            tooltip: t(`designer.inspector.sizeModes.${option.value}.widthTooltip`, { defaultValue: option.tooltip }),
          })),
          widthMode,
          (value) => applyWidthMode(value as SizeMode),
          4
        )}
        <Input
          id="designer-size-width"
          key={`width-${selectedNode.id}-${widthValue}`}
          defaultValue={widthValue}
          placeholder="auto | 300px | 50%"
          aria-label={t('designer.inspector.widthValue', { defaultValue: 'Width value' })}
          onBlur={(event) => applyLength('style.width', event.target.value, true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') applyLength('style.width', event.currentTarget.value, true);
          }}
        />
        <div className="grid grid-cols-2 gap-2">
          {renderLimitInput('style.minWidth', t('designer.inspector.minWidth', { defaultValue: 'Min width' }))}
          {renderLimitInput('style.maxWidth', t('designer.inspector.maxWidth', { defaultValue: 'Max width' }))}
        </div>
        {renderIconButtonGroup(
          'height-mode',
          t('designer.inspector.height', { defaultValue: 'Height' }),
          SIZE_HEIGHT_MODE_OPTIONS.map((option) => ({
            ...option,
            label: t(`designer.inspector.sizeModes.${option.value}.label`, { defaultValue: option.label }),
            tooltip: t(`designer.inspector.sizeModes.${option.value}.heightTooltip`, { defaultValue: option.tooltip }),
          })),
          heightMode,
          (value) => applyHeightMode(value as SizeMode),
          2
        )}
        <Input
          id="designer-size-height"
          key={`height-${selectedNode.id}-${heightValue}`}
          defaultValue={heightValue}
          placeholder="auto | 120px"
          aria-label={t('designer.inspector.heightValue', { defaultValue: 'Height value' })}
          onBlur={(event) => applyLength('style.height', event.target.value, true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') applyLength('style.height', event.currentTarget.value, true);
          }}
        />
        <div className="grid grid-cols-2 gap-2">
          {renderLimitInput('style.minHeight', t('designer.inspector.minHeight', { defaultValue: 'Min height' }))}
          {renderLimitInput('style.maxHeight', t('designer.inspector.maxHeight', { defaultValue: 'Max height' }))}
        </div>
      </div>
    );
  };

  const renderArrangeControls = () => {
    if (!selectedNode || selectedNode.type === 'document' || selectedNode.type === 'page') {
      return null;
    }
    const buttons: Array<{ command: StructureCommand; label: string; hint: string; icon: LucideIcon; destructive?: boolean }> = [
      { command: 'moveEarlier', label: t('designer.arrange.up', { defaultValue: 'Up' }), hint: t('designer.arrange.upHint', { defaultValue: 'Move earlier in its container (↑)' }), icon: ArrowUp },
      { command: 'moveLater', label: t('designer.arrange.down', { defaultValue: 'Down' }), hint: t('designer.arrange.downHint', { defaultValue: 'Move later in its container (↓)' }), icon: ArrowDown },
      { command: 'moveOut', label: t('designer.arrange.out', { defaultValue: 'Out' }), hint: t('designer.arrange.outHint', { defaultValue: 'Move out of its container, placing it right after (Alt+←)' }), icon: CornerLeftUp },
      { command: 'moveInto', label: t('designer.arrange.into', { defaultValue: 'In' }), hint: t('designer.arrange.intoHint', { defaultValue: 'Move into the container just before it (Alt+→)' }), icon: CornerRightDown },
      { command: 'copy', label: t('designer.arrange.copy', { defaultValue: 'Copy' }), hint: t('designer.arrange.copyHint', { defaultValue: 'Copy (Ctrl/⌘+C). Paste with Ctrl/⌘+V after selecting where it should go.' }), icon: Copy },
      { command: 'paste', label: t('designer.arrange.paste', { defaultValue: 'Paste' }), hint: t('designer.arrange.pasteHint', { defaultValue: 'Paste into the selected container, or after the selected block (Ctrl/⌘+V)' }), icon: ClipboardPaste },
      { command: 'duplicate', label: t('designer.arrange.duplicate', { defaultValue: 'Duplicate' }), hint: t('designer.arrange.duplicateHint', { defaultValue: 'Duplicate right after itself (Ctrl/⌘+D)' }), icon: CopyPlus },
      { command: 'copyStyle', label: t('designer.arrange.copyStyle', { defaultValue: 'Copy style' }), hint: t('designer.arrange.copyStyleHint', { defaultValue: 'Copy colors, borders, spacing and text style (Ctrl/⌘+Alt+C)' }), icon: Paintbrush },
      { command: 'pasteStyle', label: t('designer.arrange.pasteStyle', { defaultValue: 'Paste style' }), hint: t('designer.arrange.pasteStyleHint', { defaultValue: 'Give this block the copied style (Ctrl/⌘+Alt+V)' }), icon: PaintBucket },
      { command: 'delete', label: t('designer.arrange.delete', { defaultValue: 'Delete' }), hint: t('designer.arrange.deleteHint', { defaultValue: 'Delete (Delete key)' }), icon: Trash2, destructive: true },
    ];
    return (
      <div
        className="rounded border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-3 py-2 space-y-1.5"
        data-automation-id="designer-arrange-controls"
      >
        <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t('designer.arrange.title', { defaultValue: 'Arrange' })}</p>
        <div className="grid grid-cols-5 gap-1">
          {buttons.map(({ command, label, hint, icon: Icon, destructive }) => (
            <Tooltip key={command} content={hint}>
              <button
                type="button"
                id={`designer-arrange-${command}`}
                disabled={!structureCommands.available[command]}
                onClick={() => structureCommands.run[command]()}
                aria-label={hint}
                className={clsx(
                  'flex h-12 flex-col items-center justify-center gap-0.5 rounded border text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                  destructive
                    ? 'border-slate-200 dark:border-[rgb(var(--color-border-200))] text-destructive hover:bg-destructive/10'
                    : 'border-slate-200 dark:border-[rgb(var(--color-border-200))] text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                <span>{label}</span>
              </button>
            </Tooltip>
          ))}
        </div>
      </div>
    );
  };

  const renderFlexItemControls = () => {
    if (!selectedNode || !selectedParentFlexLayout) {
      return null;
    }

    const mainAxisLabel = selectedParentFlexLayout.flexDirection === 'row' ? 'Width' : 'Height';
    const mainAxisNoun = selectedParentFlexLayout.flexDirection === 'row' ? 'width' : 'height';
    const currentFlexGrow = coerceFlexNumber(selectedSizingStyle?.flexGrow, 0);
    const currentFlexShrink = coerceFlexNumber(selectedSizingStyle?.flexShrink, 1);
    const currentFlexBasis = typeof selectedSizingStyle?.flexBasis === 'string' ? selectedSizingStyle.flexBasis : '';

    const applyFlexPreset = (preset: Exclude<FlexItemPreset, 'custom'>) => {
      const patch =
        preset === 'fill'
          ? { grow: 1, shrink: 1, basis: 'auto' }
          : preset === 'share'
            ? { grow: 1, shrink: 1, basis: '0%' }
            : preset === 'fixed'
              ? { grow: 0, shrink: 0, basis: 'auto' }
              : { grow: 0, shrink: 1, basis: 'auto' };
      setNodeProp(selectedNode.id, 'style.flexGrow', patch.grow, false);
      setNodeProp(selectedNode.id, 'style.flexShrink', patch.shrink, false);
      setNodeProp(selectedNode.id, 'style.flexBasis', patch.basis, true);
    };

    const applyFlexBasis = (raw: string, commit: boolean) => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        unsetNodeProp(selectedNode.id, 'style.flexBasis', commit);
        return;
      }
      setNodeProp(selectedNode.id, 'style.flexBasis', trimmed, commit);
    };

    const applyFlexNumber = (path: 'style.flexGrow' | 'style.flexShrink', raw: string, commit: boolean) => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        unsetNodeProp(selectedNode.id, path, commit);
        return;
      }
      const numeric = Number(trimmed);
      if (!Number.isFinite(numeric)) {
        return;
      }
      setNodeProp(selectedNode.id, path, numeric, commit);
    };

    return (
      <div
        className="rounded border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-3 py-2 space-y-2"
        data-automation-id="designer-flex-item-controls"
      >
        <div className="space-y-1">
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t('designer.inspector.flexItem', { defaultValue: 'Flex Item' })}</p>
          <p className="text-[11px] text-slate-500">
            In this {selectedParentFlexLayout.flexDirection === 'row' ? 'horizontal' : 'vertical'} stack, these settings control how the item shares {mainAxisNoun} with its siblings.
          </p>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs text-slate-500">{mainAxisLabel} Behavior</p>
          <div className="grid grid-cols-2 gap-2">
            {FLEX_ITEM_PRESET_OPTIONS.map((option) => {
              const isSelected = option.value === selectedFlexItemPreset;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => applyFlexPreset(option.value)}
                  className={clsx(
                    'rounded border px-2 py-2 text-left transition-colors',
                    isSelected
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                      : 'border-slate-200 dark:border-[rgb(var(--color-border-200))] text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                  )}
                  aria-pressed={isSelected}
                  aria-label={`${mainAxisLabel} behavior: ${option.label}`}
                  data-automation-id={`designer-flex-item-preset-${option.value}`}
                >
                  <div className="text-xs font-medium">{option.label}</div>
                  <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{option.description}</div>
                </button>
              );
            })}
          </div>
          {selectedFlexItemPreset === 'custom' && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              This item has custom flex values. Choose a preset to simplify it, or adjust the advanced values below.
            </p>
          )}
        </div>
        <details data-automation-id="designer-flex-item-advanced">
          <summary className="cursor-pointer text-xs font-medium text-slate-600 dark:text-slate-300">
            Advanced Flex Values
          </summary>
          <div className="mt-2 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-slate-500 block mb-1">Take extra space</label>
                <Input
                  value={String(currentFlexGrow)}
                  placeholder="0"
                  onChange={(event) => applyFlexNumber('style.flexGrow', event.target.value, false)}
                  onBlur={(event) => applyFlexNumber('style.flexGrow', event.target.value, true)}
                  data-automation-id="designer-flex-grow-input"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 block mb-1">Allow shrinking</label>
                <Input
                  value={String(currentFlexShrink)}
                  placeholder="1"
                  onChange={(event) => applyFlexNumber('style.flexShrink', event.target.value, false)}
                  onBlur={(event) => applyFlexNumber('style.flexShrink', event.target.value, true)}
                  data-automation-id="designer-flex-shrink-input"
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">Preferred {mainAxisNoun} size</label>
              <Input
                value={currentFlexBasis}
                placeholder="auto | 240px | 50%"
                onChange={(event) => applyFlexBasis(event.target.value, false)}
                onBlur={(event) => applyFlexBasis(event.target.value, true)}
                data-automation-id="designer-flex-basis-input"
              />
            </div>
          </div>
        </details>
      </div>
    );
  };

  const renderFieldDisplayControls = () => {
    if (!selectedNode || selectedNode.type !== 'field' || !selectedFieldType) {
      return null;
    }

    const fieldDefinition = getTemplateFieldDefinition(selectedFieldType.bindingKey);
    if (!fieldDefinition || selectedFieldDisplayFormats.length === 0) {
      return null;
    }

    const metadata = getNodeMetadata(selectedNode) as Record<string, unknown>;
    const selectedDisplayFormat = (
      metadata.displayFormat === 'single-line' ||
      metadata.displayFormat === 'multiline' ||
      metadata.displayFormat === 'raw'
        ? metadata.displayFormat
        : 'single-line'
    ) as TemplateFieldDisplayFormat;
    const optionLabels: Record<TemplateFieldDisplayFormat, string> = {
      'single-line': 'Single line',
      multiline: 'Multiline',
      raw: 'Raw',
    };
    const optionDescriptions: Record<TemplateFieldDisplayFormat, string> = {
      'single-line': 'Collapse the address onto one line.',
      multiline: 'Split the address into multiple lines.',
      raw: 'Use the stored value as-is.',
    };

    return (
      <div
        className="rounded border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-3 py-2 space-y-2"
        data-automation-id="designer-field-display-controls"
      >
        <div className="space-y-1">
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t('designer.inspector.displayFormat', { defaultValue: 'Display Format' })}</p>
          <p className="text-[11px] text-slate-500">
            {fieldDefinition.description} This only applies to Data Field nodes.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2">
          {selectedFieldDisplayFormats.map((option) => {
            const isSelected = option === selectedDisplayFormat;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setNodeProp(selectedNode.id, 'metadata.displayFormat', option, true)}
                className={clsx(
                  'rounded border px-2 py-2 text-left transition-colors',
                  isSelected
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                    : 'border-slate-200 dark:border-[rgb(var(--color-border-200))] text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                )}
                aria-pressed={isSelected}
                aria-label={`Display format: ${optionLabels[option]}`}
                data-automation-id={`designer-field-display-format-${option}`}
              >
                <div className="text-xs font-medium">{optionLabels[option]}</div>
                <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{optionDescriptions[option]}</div>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderMetadataInspector = () => {
    if (!selectedNode) {
      return null;
    }
    const metadata = getNodeMetadata(selectedNode) as Record<string, any>;
    const applyMetadata = (patch: Record<string, unknown>, commit: boolean) => {
      const entries = Object.entries(patch);
      if (entries.length === 0) return;
      entries.forEach(([key, value], index) => {
        setNodeProp(selectedNode.id, `metadata.${key}`, value, index === entries.length - 1 ? commit : false);
      });
    };

    if (selectedNode.type === 'attachment-list') {
      const items: Array<Record<string, any>> = Array.isArray(metadata.items) ? metadata.items : [];
      const updateItems = (next: Array<Record<string, any>>, commit: boolean) => applyMetadata({ items: next }, commit);
      const updateItem = (itemId: string, patch: Record<string, unknown>, commit: boolean) => {
        updateItems(items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)), commit);
      };
      const addItem = () => {
        updateItems(
          [
          ...items,
          {
            id: createLocalId(),
            label: 'Attachment',
            url: 'https://example.com',
          },
          ],
          true
        );
      };
      const removeItem = (itemId: string) => updateItems(items.filter((item) => item.id !== itemId), true);

      return (
        <div className="rounded border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-3 py-2 space-y-2">
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t('designer.inspector.attachments', { defaultValue: 'Attachments' })}</p>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Title</label>
            <Input
              id="designer-attachments-title"
              value={metadata.title ?? 'Attachments'}
              onChange={(event) => applyMetadata({ title: event.target.value }, false)}
              onBlur={(event) => applyMetadata({ title: event.target.value }, true)}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-slate-600">
            <span>Items</span>
            <Button id="designer-attachment-add" variant="outline" size="xs" onClick={addItem}>
              Add
            </Button>
          </div>
          {items.length === 0 && <p className="text-xs text-slate-500">No attachments defined.</p>}
          {items.map((item) => (
            <div key={item.id} className="border border-slate-100 dark:border-slate-700 rounded-md p-2 space-y-2 bg-slate-50 dark:bg-[rgb(var(--color-background))]">
              <div className="flex items-center justify-between">
                <Input
                  id={`attachment-label-${item.id}`}
                  value={item.label ?? ''}
                  onChange={(event) => updateItem(item.id, { label: event.target.value }, false)}
                  onBlur={(event) => updateItem(item.id, { label: event.target.value }, true)}
                  className="text-xs"
                />
                <Button
                  id={`designer-attachment-remove-${item.id}`}
                  variant="ghost"
                  size="icon"
                  onClick={() => removeItem(item.id)}
                >
                  ✕
                </Button>
              </div>
              <Input
                id={`attachment-url-${item.id}`}
                value={item.url ?? ''}
                onChange={(event) => updateItem(item.id, { url: event.target.value }, false)}
                onBlur={(event) => updateItem(item.id, { url: event.target.value }, true)}
                className="text-xs"
              />
            </div>
          ))}
        </div>
      );
    }

		    if (selectedNode.type === 'image' || selectedNode.type === 'logo' || selectedNode.type === 'qr') {
		      const fitMode = metadata.fitMode ?? metadata.fit ?? 'contain';
        const objectFit = getNodeStyle(selectedNode)?.objectFit ?? fitMode;
        const rawObjectPosition = getNodeStyle(selectedNode)?.objectPosition ?? 'center center';
        const parseObjectPosition = (
          value: string
        ): { horizontal: 'left' | 'center' | 'right'; vertical: 'top' | 'center' | 'bottom' } => {
          const tokens = value
            .trim()
            .split(/\s+/)
            .filter(Boolean);
          const horizontalToken = tokens.find((token) => token === 'left' || token === 'center' || token === 'right');
          const verticalToken = tokens.find((token) => token === 'top' || token === 'center' || token === 'bottom');
          return {
            horizontal: (horizontalToken as 'left' | 'center' | 'right' | undefined) ?? 'center',
            vertical: (verticalToken as 'top' | 'center' | 'bottom' | undefined) ?? 'center',
          };
        };
        const objectPosition = parseObjectPosition(rawObjectPosition);
        const applyObjectPosition = (
          patch: Partial<{ horizontal: 'left' | 'center' | 'right'; vertical: 'top' | 'center' | 'bottom' }>
        ) => {
          const nextHorizontal = patch.horizontal ?? objectPosition.horizontal;
          const nextVertical = patch.vertical ?? objectPosition.vertical;
          setNodeProp(selectedNode.id, 'style.objectPosition', `${nextHorizontal} ${nextVertical}`, true);
        };
        const applyAspectRatio = (raw: string, commit: boolean) => {
          const normalized = normalizeCssValue(raw);
          if (normalized === undefined) {
            unsetNodeProp(selectedNode.id, 'style.aspectRatio', commit);
            return;
          }
          setNodeProp(selectedNode.id, 'style.aspectRatio', normalized, commit);
        };
		      return (
		        <div className="rounded border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-3 py-2 space-y-2">
		          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t('designer.inspector.media', { defaultValue: 'Media' })}</p>
          {selectedNode.type !== 'qr' && (
            <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label={t('designer.inspector.mediaSource', { defaultValue: 'Image source' })}>
              {([
                ['logo', t('designer.inspector.mediaSourceLogo', { defaultValue: 'Company logo' })],
                ['custom', t('designer.inspector.mediaSourceCustom', { defaultValue: 'Custom image' })],
              ] as const).map(([value, label]) => {
                const isActive = (metadata.srcBinding === 'tenantLogo') === (value === 'logo');
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    id={`designer-media-source-${value}`}
                    className={clsx(
                      'h-8 rounded border text-xs transition-colors',
                      isActive
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                        : 'border-slate-200 dark:border-[rgb(var(--color-border-200))] text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    )}
                    onClick={() => {
                      if (value === 'logo') {
                        setNodeProp(selectedNode.id, 'metadata.srcBinding', 'tenantLogo', true);
                        return;
                      }
                      // Dropping the binding also drops an imported dynamic source,
                      // so the typed URL below is what gets saved.
                      unsetNodeProp(selectedNode.id, 'metadata.srcBinding', false);
                      unsetNodeProp(selectedNode.id, 'metadata.astSrcExpression', true);
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
          {metadata.srcBinding === 'tenantLogo' ? (
            <p className="text-[11px] text-slate-500 dark:text-slate-400" data-automation-id="designer-media-logo-hint">
              {t('designer.inspector.mediaSourceLogoHint', {
                defaultValue: 'Shows the logo from your company branding settings on every document.',
              })}
            </p>
          ) : (
	          <div>
            <label className="text-xs text-slate-500 dark:text-slate-400 block mb-1">{t('designer.inspector.mediaSourceUrl', { defaultValue: 'Source URL' })}</label>
            <Input
              id="designer-media-src"
              value={metadata.src ?? metadata.url ?? ''}
              onChange={(event) => applyMetadata({ src: event.target.value, url: event.target.value }, false)}
              onBlur={(event) => applyMetadata({ src: event.target.value, url: event.target.value }, true)}
            />
            <div className="mt-2">
              <DocumentImagePickerWidget
                currentSrc={metadata.src ?? metadata.url ?? ''}
                onSourceChange={(url, commit) => applyMetadata({ src: url, url }, commit)}
              />
            </div>
          </div>
          )}
          <div>
            <label className="text-xs text-slate-500 block mb-1">Alt text</label>
            <Input
              id="designer-media-alt"
              value={metadata.alt ?? ''}
              onChange={(event) => applyMetadata({ alt: event.target.value }, false)}
              onBlur={(event) => applyMetadata({ alt: event.target.value }, true)}
            />
	          </div>
            {renderIconButtonGroup(
              'media-object-fit',
              'Object Fit',
              MEDIA_OBJECT_FIT_OPTIONS,
              objectFit,
              (value) => {
                setNodeProp(selectedNode.id, 'style.objectFit', value, true);
                if (value === 'contain' || value === 'cover' || value === 'fill') {
                  applyMetadata({ fitMode: value, fit: value }, true);
                }
              },
              5
            )}
            <div className="grid grid-cols-2 gap-2">
              {renderIconButtonGroup(
                'media-horizontal-align',
                'Horizontal Align',
                MEDIA_HORIZONTAL_ALIGN_OPTIONS,
                objectPosition.horizontal,
                (value) => applyObjectPosition({ horizontal: value as 'left' | 'center' | 'right' }),
                3
              )}
              {renderIconButtonGroup(
                'media-vertical-align',
                'Vertical Align',
                MEDIA_VERTICAL_ALIGN_OPTIONS,
                objectPosition.vertical,
                (value) => applyObjectPosition({ vertical: value as 'top' | 'center' | 'bottom' }),
                3
              )}
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Aspect ratio</label>
	              <Input
	                id="designer-media-aspect-ratio"
	                value={getNodeStyle(selectedNode)?.aspectRatio ?? ''}
	                placeholder="e.g. 16 / 9 or 1 / 1"
	                onChange={(event) => applyAspectRatio(event.target.value, false)}
	                onBlur={(event) => applyAspectRatio(event.target.value, true)}
	              />
	            </div>
		          <div className="pt-2 border-t border-slate-100 space-y-1">
	            <Button
	              id="designer-fit-parent-section-to-media"
	              variant="outline"
              onClick={fitParentSectionFromMedia}
              disabled={!selectedMediaParentSection}
            >
              Fit Parent Section to Media
            </Button>
            {selectedMediaParentSection ? (
              <p className="text-[11px] text-slate-500">
                Reflows <span className="font-medium text-slate-600">{getNodeName(selectedMediaParentSection)}</span> to remove extra whitespace.
              </p>
            ) : (
              <p className="text-[11px] text-slate-500">This media block is not inside a section.</p>
            )}
          </div>
        </div>
      );
    }

    return null;
  };

  const handleDragStart = (event: DragStartEvent) => {
    clearDropFeedback();
    const data = event.active.data.current;
    if (isPaletteDragData(data)) {
      if (data.source === 'component') {
        setActiveDrag({ kind: 'component', componentType: data.componentType });
      } else if (data.source === 'preset') {
        setActiveDrag({ kind: 'preset', presetId: data.presetId });
      }
      return;
    }
    if (isNodeDragData(data)) {
      setActiveDrag({ kind: 'node', nodeId: data.nodeId });
    }
  };

	  const handleDragMove = (event: DragMoveEvent) => {
	    void event;
	  };

  const handleDragOver = (event: DragOverEvent) => {
    const activeData = event.active.data.current;
    if (!isNodeDragData(activeData) || activeData.layoutKind !== 'flow') {
      if (dropIndicator) {
        setDropIndicator(null);
      }
      return;
    }

    const over = event.over;
    if (!over) {
      if (dropIndicator) {
        setDropIndicator(null);
      }
      return;
    }

    const overData = over.data.current;
    const activeNode = nodesById.get(activeData.nodeId) ?? null;
    if (!activeNode) {
      if (dropIndicator) {
        setDropIndicator(null);
      }
      return;
    }

    const wouldCreateCycle = (targetParentId: string) => {
      let current: string | null = targetParentId;
      while (current) {
        if (current === activeNode.id) {
          return true;
        }
        current = nodesById.get(current)?.parentId ?? null;
      }
      return false;
    };

    if (isNodeDragData(overData)) {
      const overNode = nodesById.get(overData.nodeId) ?? null;
      if (!overNode || !overNode.parentId) {
        if (dropIndicator) {
          setDropIndicator(null);
        }
        return;
      }

      const parent = nodesById.get(overNode.parentId) ?? null;
      if (!parent) {
        if (dropIndicator) {
          setDropIndicator(null);
        }
        return;
      }

      const isValid =
        canNestWithinParent(activeNode.type, parent.type) && !wouldCreateCycle(parent.id);
      const parentLayout = getNodeLayout(parent);
      const axis = parentLayout?.display === 'flex' && parentLayout.flexDirection === 'row' ? 'x' : 'y';

      const activeRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
      const overRect = over.rect;
      if (!activeRect || !overRect) {
        return;
      }

      const position = resolveInsertPositionFromRects(activeRect, overRect, axis);
      setDropIndicator({
        kind: 'insert',
        overNodeId: overNode.id,
        position,
        tone: isValid ? 'valid' : 'invalid',
      });
      return;
    }

    if (isDropTargetMeta(overData)) {
      const target = nodesById.get(overData.nodeId) ?? null;
      if (!target) {
        if (dropIndicator) {
          setDropIndicator(null);
        }
        return;
      }
      const isValid = canNestWithinParent(activeNode.type, target.type) && !wouldCreateCycle(target.id);
      setDropIndicator(isValid ? null : { kind: 'container', containerId: target.id, tone: 'invalid' });
      return;
    }

    if (dropIndicator) {
      setDropIndicator(null);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    try {
      if (activeDrag?.kind === 'component' || activeDrag?.kind === 'preset') {
        const dropPoint = pointerRef.current ?? { x: 120, y: 120 };
        const dropMeta = event.over?.data?.current as DropTargetMeta | undefined;
        if (activeDrag.kind === 'component') {
          insertComponentWithResolution(activeDrag.componentType, {
            dropMeta,
            dropPoint,
            requireCanvasPointer: true,
          });
        } else if (activeDrag.kind === 'preset') {
          insertPresetWithResolution(activeDrag.presetId, {
            dropMeta,
            dropPoint,
            requireDropTarget: true,
          });
        }
      }
      if (activeDrag?.kind === 'node') {
        const activeData = event.active.data.current;
        if (isNodeDragData(activeData)) {
          const over = event.over;
          if (!over) {
            return;
          }
          const overData = over.data.current;
          const activeNode = nodesById.get(activeData.nodeId) ?? null;
          if (!activeNode) {
            return;
          }

          let targetParentId: string | null = null;
          let targetIndex = 0;

          if (isNodeDragData(overData)) {
            const overNode = nodesById.get(overData.nodeId) ?? null;
            if (!overNode || !overNode.parentId) {
              return;
            }
            const parent = nodesById.get(overNode.parentId) ?? null;
            if (!parent) {
              return;
            }
            targetParentId = overNode.parentId;
            const overIndex = parent.children.indexOf(overNode.id);
            let index = overIndex >= 0 ? overIndex : parent.children.length;

            const parentLayout = getNodeLayout(parent);
            if (parentLayout?.display === 'flex' && event.active.rect.current && over.rect) {
              const axis = parentLayout.flexDirection === 'row' ? 'x' : 'y';
              const activeRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
              const overRect = over.rect;
              if (activeRect && overRect) {
                const activeCenter =
                  axis === 'x' ? activeRect.left + activeRect.width / 2 : activeRect.top + activeRect.height / 2;
                const overCenter =
                  axis === 'x' ? overRect.left + overRect.width / 2 : overRect.top + overRect.height / 2;
                if (activeCenter >= overCenter) {
                  index += 1;
                }
              }
            }

            targetIndex = index;
          } else if (isDropTargetMeta(overData)) {
            const parent = nodesById.get(overData.nodeId) ?? null;
            if (!parent) {
              return;
            }
            targetParentId = overData.nodeId;
            targetIndex = parent.children.length;
          } else {
            return;
          }

          if (!targetParentId) {
            return;
          }

          const targetParent = nodesById.get(targetParentId) ?? null;
          const wouldCreateCycle = () => {
            let current: string | null = targetParentId;
            while (current) {
              if (current === activeNode.id) {
                return true;
              }
              current = nodesById.get(current)?.parentId ?? null;
            }
            return false;
          };

          if (!targetParent || !canNestWithinParent(activeNode.type, targetParent.type) || wouldCreateCycle()) {
            showDropFeedback('error', 'Invalid drop target.');
            recordDropResult(false);
            return;
          }

          moveNode(activeNode.id, targetParentId, targetIndex);
          recordDropResult(true);
          return;
        }
      }
    } finally {
      cleanupDragState();
    }
  };

  const handleDragCancel = () => {
    cleanupDragState();
  };

  const handleQuickInsertComponent = useCallback(
    (componentType: DesignerComponentType, options?: { after?: boolean }) => {
      clearDropFeedback();
      const state = useInvoiceDesignerStore.getState();
      const blockLabel = t(`designer.blocks.${componentType}.label`, {
        defaultValue: getDefinition(componentType)?.label ?? componentType,
      });
      const target = resolveInsertionTarget(
        state.nodes,
        state.selectedNodeId,
        componentType,
        options?.after ? 'after' : state.insertPlacement
      );
      if (!target) {
        recordDropResult(false);
        showDropFeedback(
          'error',
          t('designer.feedback.cannotInsert', { defaultValue: '{{block}} cannot be added here.', block: blockLabel })
        );
        return;
      }
      // The new block becomes the selection, so its properties are ready to edit
      // and the next insert lands right after it.
      addNode(componentType, getDefaultInsertionPoint({ preferSelectionAnchor: true }), {
        parentId: target.parentId,
        index: target.index,
      });
      recordDropResult(true);
      const parentNode = useInvoiceDesignerStore.getState().nodesById[target.parentId];
      showDropFeedback(
        'info',
        parentNode?.type === 'page'
          ? t('designer.feedback.insertedOnPage', { defaultValue: 'Added {{block}} to the page.', block: blockLabel })
          : t('designer.feedback.insertedInto', {
              defaultValue: 'Added {{block}} to {{parent}}.',
              block: blockLabel,
              parent: parentNode ? getNodeName(parentNode) : '',
            })
      );
    },
    [addNode, clearDropFeedback, getDefaultInsertionPoint, recordDropResult, showDropFeedback, t]
  );

  const handleQuickInsertPreset = useCallback(
    (presetId: string) => {
      clearDropFeedback();
      insertPresetWithResolution(presetId);
    },
    [clearDropFeedback, insertPresetWithResolution]
  );

  const handleInsertTemplateVariable = useCallback(
    (bindingPath: string) => {
      clearDropFeedback();
      const inserted = tryInsertTemplateIntoFocusedInput(bindingPath);
      if (inserted) {
        const validation = validateSourcePaths({
          source: inserted.insertedValue,
          mode: inserted.mode,
          options: invoicePathOptions,
        });
        if (validation.diagnostics.length > 0) {
          showDropFeedback('info', `Inserted ${inserted.insertedValue}. ${validation.diagnostics[0]?.message ?? ''}`);
          return;
        }
        showDropFeedback('info', `Inserted ${inserted.insertedValue}.`);
        return;
      }

      const liveState = useInvoiceDesignerStore.getState();
      const liveSelectedNodeId = liveState.selectedNodeId;
      if (!liveSelectedNodeId) {
        showDropFeedback('info', 'Select a text block, then focus a text field to insert variables.');
        return;
      }

      const liveSelectedNode = liveState.nodesById[liveSelectedNodeId];
      // A selected Data Field takes the clicked field as its binding.
      if (liveSelectedNode?.type === 'field') {
        liveState.rebindDataField(liveSelectedNode.id, bindingPath);
        showDropFeedback('info', t('designer.feedback.fieldRebound', {
          defaultValue: '{{name}} now shows {{path}}.',
          name: getNodeName(liveSelectedNode),
          path: bindingPath,
        }));
        return;
      }
      if (!liveSelectedNode || (liveSelectedNode.type !== 'text' && liveSelectedNode.type !== 'label')) {
        showDropFeedback('info', 'Focus a text field in the inspector to insert this variable.');
        return;
      }

      const metadata = getNodeMetadata(liveSelectedNode) as Record<string, unknown>;
      const existingText = typeof metadata.text === 'string' ? metadata.text : '';
      const token = formatBindingInsertValue(bindingPath, 'template');
      const joiner = existingText.length > 0 && !/\s$/.test(existingText) ? ' ' : '';
      const insertion = insertTextIntoValue(
        {
          value: existingText,
          selectionStart: existingText.length,
          selectionEnd: existingText.length,
        },
        `${joiner}${token}`
      );
      setNodeProp(liveSelectedNode.id, 'metadata.text', insertion.nextValue, true);
      const validation = validateSourcePaths({
        source: token,
        mode: 'template',
        options: invoicePathOptions,
      });
      if (validation.diagnostics.length > 0) {
        showDropFeedback('info', `Inserted ${token}. ${validation.diagnostics[0]?.message ?? ''}`);
        return;
      }
      showDropFeedback('info', `Inserted ${token}.`);
    },
    [clearDropFeedback, invoicePathOptions, setNodeProp, showDropFeedback, t]
  );

  const simulateComponentDrop = useCallback(
    (type: DesignerComponentType, targetNodeId?: string | 'canvas', dropPoint?: Point) => {
      clearDropFeedback();
      const dropMeta = resolveDropMetaFromTarget(targetNodeId);
      return insertComponentWithResolution(type, { dropMeta, dropPoint });
    },
    [clearDropFeedback, insertComponentWithResolution, resolveDropMetaFromTarget]
  );

  const simulatePresetDrop = useCallback(
    (presetId: string, targetNodeId?: string | 'canvas', dropPoint?: Point) => {
      clearDropFeedback();
      const dropMeta = resolveDropMetaFromTarget(targetNodeId);
      return insertPresetWithResolution(presetId, { dropMeta, dropPoint });
    },
    [clearDropFeedback, insertPresetWithResolution, resolveDropMetaFromTarget]
  );

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    if (!isLocalHost) {
      return;
    }
    const api: DesignerTestApi = {
      insertComponent: (type) => insertComponentWithResolution(type),
      insertPreset: (id) => insertPresetWithResolution(id),
      selectNode: (id) => selectNode(id),
      simulateComponentDrop: (type, targetNodeId, dropPoint) =>
        simulateComponentDrop(type, targetNodeId, dropPoint),
      simulatePresetDrop: (presetId, targetNodeId, dropPoint) =>
        simulatePresetDrop(presetId, targetNodeId, dropPoint),
      setForcedDropTarget: (nodeId) => {
        if (nodeId === null || nodeId === 'canvas') {
          setForcedDropTarget(nodeId);
          return;
        }
        const exists = useInvoiceDesignerStore.getState().nodes.some((node) => node.id === nodeId);
        setForcedDropTarget(exists ? nodeId : null);
      },
    };
    window.__ALGA_INVOICE_DESIGNER_TEST_API__ = api;
    return () => {
      if (window.__ALGA_INVOICE_DESIGNER_TEST_API__ === api) {
        delete window.__ALGA_INVOICE_DESIGNER_TEST_API__;
      }
      setForcedDropTarget(null);
    };
  }, [insertComponentWithResolution, insertPresetWithResolution, selectNode, simulateComponentDrop, simulatePresetDrop]);

  const runSectionFitAction = useCallback(
    (
      sectionId: string | null,
      options?: { missingSectionMessage?: string; autoSwitchFillToFixed?: boolean }
    ) => {
      const missingSectionMessage = options?.missingSectionMessage ?? 'Select a section to fit.';
      if (!sectionId) {
        showDropFeedback('info', missingSectionMessage);
        return;
      }

      let state = useInvoiceDesignerStore.getState();
      let nodesById = new Map(state.nodes.map((node) => [node.id, node]));
      const section = nodesById.get(sectionId);
      if (!section || section.type !== 'section') {
        showDropFeedback('info', missingSectionMessage);
        return;
      }
      const sectionNode = section;

      // Legacy behavior used to auto-switch sizing modes before fitting.
      // In the CSS-first model, section sizing is controlled via CSS props instead.
      const switchedFromFill = false;

      const intent = getSectionFitIntent(sectionNode, nodesById);
      if (intent.status === 'no-children') {
        showDropFeedback('info', 'Section has no child content to fit.');
        return;
      }
      if (intent.status === 'already-fitted') {
        showDropFeedback('info', getSectionFitNoopMessage(sectionNode));
        return;
      }

      const beforeSize = sectionNode.size;
      const resolvedSectionId = sectionNode.id;
      resizeNode(resolvedSectionId, intent.size, true);
      const afterSection = useInvoiceDesignerStore.getState().nodes.find((node) => node.id === resolvedSectionId);
      if (!afterSection || sizesAreEffectivelyEqual(beforeSize, afterSection.size)) {
        showDropFeedback('info', getSectionFitNoopMessage(sectionNode));
        return;
      }
      showDropFeedback(
        'info',
        switchedFromFill
          ? 'Section switched to Fixed sizing and fitted to contents.'
          : 'Section fitted to contents.'
      );
    },
    [showDropFeedback, resizeNode]
  );

  const fitSelectedSectionToContents = useCallback(() => {
    const sectionId = selectedNode?.type === 'section' ? selectedNode.id : null;
    runSectionFitAction(sectionId, {
      missingSectionMessage: 'Select a section to fit.',
      autoSwitchFillToFixed: false,
    });
  }, [runSectionFitAction, selectedNode]);

  const fitParentSectionFromMedia = useCallback(() => {
    runSectionFitAction(selectedMediaParentSection?.id ?? null, {
      missingSectionMessage: 'This media block is not inside a section.',
    });
  }, [runSectionFitAction, selectedMediaParentSection]);

  const normalizeCssValue = (raw: string): string | undefined => {
    // Allow advanced CSS values like `calc(100% - 2rem)`; only normalize empty/whitespace.
    const trimmed = raw.trim();
    return trimmed.length === 0 ? undefined : raw;
  };

  const handlePaperPresetChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    applyPrintSettings({
      paperPreset: event.target.value as TemplatePrintSettings['paperPreset'],
    });
  };

  const handleMarginDraftChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    setPrintMarginDraft(nextValue);
  };

  const commitMarginDraft = () => {
    if (printMarginDraft.trim().length === 0) {
      setPrintMarginDraft(`${currentPrintSettings.marginMm}`);
      return;
    }

    const numeric = Number(printMarginDraft);
    if (!Number.isFinite(numeric)) {
      setPrintMarginDraft(`${currentPrintSettings.marginMm}`);
      return;
    }

    const normalized = clampInvoiceMarginMm(numeric);
    setPrintMarginDraft(`${normalized}`);
    applyPrintSettings({
      marginMm: normalized,
    });
  };

  return (
    // Sized so the editor page fits the window: the page never scrolls, so nothing
    // shifts under the pointer while editing (panels scroll inside themselves).
    <div className="relative flex flex-col h-[calc(100vh-24.75rem)] min-h-[480px] border border-slate-200 rounded-lg overflow-hidden">
      <DesignerToolbar
        snapToGrid={snapToGrid}
        showGuides={showGuides}
        showRulers={showRulers}
        canvasScale={canvasScale}
        gridSize={gridSize}
        metrics={metrics}
        onToggleSnap={toggleSnap}
        onToggleGuides={toggleGuides}
        onToggleRulers={toggleRulers}
        onZoomChange={setCanvasScale}
        onUndo={undo}
        onRedo={redo}
        onGridSizeChange={setGridSize}
      />
      <div className="border-b border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-slate-50 dark:bg-[rgb(var(--color-card))] px-4 py-1.5 text-xs text-slate-600 dark:text-slate-400">
        <span className="font-semibold text-slate-700 dark:text-slate-300">{t('designer.shell.selectedLabel', { defaultValue: 'Selected:' })}</span>{' '}
        {selectedNode ? (
          <span data-automation-id="designer-selected-context">
            {getNodeName(selectedNode)} <span className="text-slate-500">({selectedNode.type})</span>
          </span>
        ) : (
          <>
            <span className="text-slate-500" data-automation-id="designer-selected-context">
              {t('designer.shell.selectedNone', { defaultValue: 'None' })}
            </span>
            <span className="ml-2 text-slate-400" data-automation-id="designer-no-selection-help">
              <span className="rounded-full border border-slate-300/70 dark:border-slate-600/70 bg-white/70 dark:bg-slate-800/70 px-1.5 py-0.5 text-slate-500 dark:text-slate-400">
                {t('designer.shell.clickBlockHint', { defaultValue: 'Click a block on canvas' })}
              </span>{' '}
              {t('designer.shell.orUse', { defaultValue: 'or use' })}{' '}
              <span className="rounded-full border border-slate-300/70 dark:border-slate-600/70 bg-white/70 dark:bg-slate-800/70 px-1.5 py-0.5 text-slate-500 dark:text-slate-400">
                {t('designer.shell.plusInLeftPanelHint', { defaultValue: '+ in the left panel' })}
              </span>
              .
            </span>
          </>
        )}
	      </div>
	      <DesignerBreadcrumbs nodes={nodes} selectedNodeId={selectedNodeId} onSelect={selectNode} />
	      {dropFeedback && (
	        // Floats over the designer: an in-flow banner would push the canvas down and back.
	        <div
	          className={clsx(
            'pointer-events-none absolute left-1/2 top-28 z-50 -translate-x-1/2 rounded-md border px-4 py-2 text-xs shadow-md',
            dropFeedback.tone === 'error'
              ? 'border-destructive/30 bg-[rgb(var(--color-card))] text-destructive'
              : 'border-primary/30 bg-[rgb(var(--color-card))] text-primary'
          )}
          role="status"
          aria-live="polite"
          data-automation-id="designer-drop-feedback"
        >
          {dropFeedback.message}
        </div>
      )}
	      <DndContext
          sensors={sensors}
          modifiers={modifiers}
          collisionDetection={collisionDetection}
          measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        >
	        <div
            className="flex flex-1 min-h-0 overflow-hidden bg-white dark:bg-[rgb(var(--color-background))]"
            data-automation-id="designer-shell-panels"
          >
	          <div
              className="w-72 shrink-0 min-h-0 overflow-hidden flex flex-col border-r border-slate-200 dark:border-[rgb(var(--color-border-200))]"
              data-automation-id="designer-shell-palette-panel"
            >
	              <ComponentPalette
	                onInsertComponent={handleQuickInsertComponent}
                onInsertPreset={handleQuickInsertPreset}
                onInsertTemplateVariable={handleInsertTemplateVariable}
              />
          </div>
	          <DesignerWorkspace
	            nodes={nodes}
	            selectedNodeId={selectedNodeId}
	            activeReferenceNodeId={referenceNodeId}
	            constrainedCounterpartNodeIds={selectedCounterpartNodeIds}
	            showGuides={showGuides}
	            showRulers={showRulers}
	            gridSize={gridSize}
	            canvasScale={canvasScale}
	            snapToGrid={snapToGrid}
	            guides={[]}
	            isDragActive={Boolean(activeDrag)}
              dropIndicator={dropIndicator}
	            forcedDropTarget={forcedDropTarget}
	            activeDrag={activeDrag}
	            modifiers={modifiers}
	            onPointerLocationChange={updatePointerLocation}
            onNodeSelect={selectNode}
	            onResize={resizeNode}
	            onTextEdit={handleTextEdit}
	            onDragStart={handleDragStart}
	            onDragMove={handleDragMove}
              onDragOver={handleDragOver}
	            onDragEnd={handleDragEnd}
	            onDragCancel={handleDragCancel}
	          />
          <aside
            ref={inspectorPanelRef}
            className="w-80 shrink-0 min-h-0 overflow-y-auto border-l border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-slate-50 dark:bg-[rgb(var(--color-card))] p-4 space-y-4"
            data-automation-id="designer-shell-inspector-panel"
            onKeyDown={(event) => {
              // Text inputs swallow editor shortcuts, so Escape there just leaves the field.
              const target = event.target as HTMLElement;
              if (event.key === 'Escape' && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
                target.blur();
              }
            }}
          >
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 uppercase tracking-wide">{t('designer.inspector.title', { defaultValue: 'Inspector' })}</h3>
          {selectedNode ? (
            <div className="space-y-3">
              {renderArrangeControls()}
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label htmlFor="selected-name" className="text-xs text-slate-500">{t('designer.inspector.layerName', { defaultValue: 'Layer Name' })}</label>
                  <span
                    className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300"
                    data-automation-id="designer-selected-node-type"
                  >
                    {selectedNodeTypeLabel}
                  </span>
                </div>
                <Input
                  id="selected-name"
                  value={getNodeName(selectedNode)}
                  onFocus={(event) => {
                    nameBeforeEditRef.current = event.target.value;
                  }}
                  onChange={(event) => setNodeProp(selectedNode.id, 'name', event.target.value, false)}
                  onBlur={(event) => {
                    setNodeProp(selectedNode.id, 'name', event.target.value, true);
                    suggestInnerLayerRename(selectedNode.id, nameBeforeEditRef.current, event.target.value);
                  }}
                />
                {renameSuggestion && renameSuggestion.nodeId === selectedNode.id && (
                  <div
                    className="mt-1 flex items-center justify-between gap-2 rounded border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 px-2 py-1 text-[11px] text-blue-700 dark:text-blue-300"
                    data-automation-id="designer-inner-rename-suggestion"
                  >
                    <span className="min-w-0 truncate">
                      {t('designer.inspector.renameInner', {
                        defaultValue: 'Rename {{count}} inner layers too ({{from}} → {{to}}…)?',
                        count: renameSuggestion.plan.length,
                        from: renameSuggestion.plan[0].from,
                        to: renameSuggestion.plan[0].to,
                      })}
                    </span>
                    <span className="flex shrink-0 gap-2">
                      <button type="button" id="designer-inner-rename-apply" className="font-medium underline" onClick={applyInnerLayerRename}>
                        {t('designer.inspector.renameInnerApply', { defaultValue: 'Rename' })}
                      </button>
                      <button type="button" id="designer-inner-rename-dismiss" className="underline" onClick={() => setRenameSuggestion(null)}>
                        {t('designer.inspector.renameInnerDismiss', { defaultValue: 'No' })}
                      </button>
                    </span>
                  </div>
                )}
              </div>
              <NodeOverridesSummary node={selectedNode} nodesById={nodesById} onJumpToTab={setInspectorTab} />
              <div
                className={clsx('grid gap-1 rounded-md bg-slate-100 dark:bg-slate-800 p-1', selectedHasContentTab ? 'grid-cols-3' : 'grid-cols-2')}
                role="tablist"
                aria-label={t('designer.inspector.tabsLabel', { defaultValue: 'Inspector sections' })}
              >
                {/* A block with nothing to fill in has no Content tab at all. */}
                {INSPECTOR_TABS.filter((tab) => tab !== 'content' || selectedHasContentTab).map((tab) => {
                  const active = activeInspectorTab === tab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      id={`designer-inspector-tab-${tab}`}
                      aria-selected={active}
                      onClick={() => setInspectorTab(tab)}
                      className={clsx(
                        'h-7 rounded text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                        active
                          ? 'bg-white dark:bg-[rgb(var(--color-card))] text-slate-900 dark:text-slate-100 shadow-sm'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      )}
                    >
                      {t(`designer.inspector.tabs.${tab}`, { defaultValue: INSPECTOR_TAB_LABELS[tab] })}
                    </button>
                  );
                })}
              </div>
              <div className="space-y-3" role="tabpanel" aria-labelledby={`designer-inspector-tab-${activeInspectorTab}`}>
                {activeInspectorTab === 'content' && (
                  <>
                    {selectedFieldType && (
                      <div
                        className="rounded border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-3 py-2 space-y-1"
                        data-automation-id="designer-selected-field-type-panel"
                      >
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t('designer.inspector.fieldTypeLabel', { defaultValue: 'Field Type' })}</p>
                        <p className="text-sm text-slate-700 dark:text-slate-300" data-automation-id="designer-selected-field-type">
                          {selectedFieldType.label}
                        </p>
                        <p className="text-[11px] text-slate-500">{selectedFieldType.bindingKey || t('designer.inspector.noBindingKey', { defaultValue: 'No binding key set' })}</p>
                      </div>
                    )}
                    <DesignerSchemaInspector node={selectedNode} nodesById={nodesById} tab="content" />
                    {renderFieldDisplayControls()}
                    {renderMetadataInspector()}
                  </>
                )}
                {activeInspectorTab === 'style' && (
                  <DesignerSchemaInspector node={selectedNode} nodesById={nodesById} tab="style" />
                )}
                {activeInspectorTab === 'layout' && (
                  <>
                    {renderContainerLayoutControls()}
                    <DesignerSchemaInspector node={selectedNode} nodesById={nodesById} tab="layout" />
                    {renderSizeControls()}
                    {renderFlexItemControls()}
                    {selectedNode.type === 'section' && (
                      <div className="space-y-1">
                        <Button
                          id="designer-fit-section-to-contents"
                          variant="outline"
                          onClick={fitSelectedSectionToContents}
                        >
                          {t('designer.inspector.fitSectionToContents', { defaultValue: 'Fit Section to Contents' })}
                        </Button>
                        {!selectedSectionFitSize && (
                          <p className="text-[11px] text-slate-500">{t('designer.inspector.sectionNoChildContent', { defaultValue: 'Section has no child content to fit.' })}</p>
                        )}
                      </div>
                    )}
                  </>
                )}
                {selectedPreset && (
                  <div className="rounded border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-3 py-2 text-xs text-slate-600 dark:text-slate-400 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">{t('designer.inspector.layoutPreset', { defaultValue: 'Layout Preset' })}</span>
                      <button
                        type="button"
                        className="text-blue-600 hover:underline"
                        onClick={() => unsetNodeProp(selectedNode.id, 'layoutPresetId', true)}
                      >
                        {t('designer.inspector.clear', { defaultValue: 'Clear' })}
                      </button>
                    </div>
                    <div className="text-slate-500 text-[11px]">{selectedPreset.label}</div>
                    <p className="text-[11px] text-slate-500">{selectedPreset.description}</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div
                className="rounded border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-3 py-3 space-y-3"
                data-automation-id="designer-page-setup-panel"
              >
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t('designer.pageSetup.title', { defaultValue: 'Page Setup' })}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    {t('designer.pageSetup.description', { defaultValue: 'Choose a paper preset and page margin without selecting the hidden page node.' })}
                  </p>
                </div>
                <div className="space-y-1">
                  <label htmlFor="designer-paper-preset-select" className="text-xs text-slate-500 block">
                    {t('designer.pageSetup.paperPreset', { defaultValue: 'Paper Preset' })}
                  </label>
                  <CustomSelect
                    showPlaceholderInDropdown={false}
                    id="designer-paper-preset-select"
                    value={currentPrintSettings.paperPreset}
                    onValueChange={(value) => applyPrintSettings({ paperPreset: value as TemplatePrintSettings['paperPreset'] })}
                    options={listInvoicePaperPresets().map((preset) => ({
                      value: preset.id,
                      label: preset.label,
                    }))}
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="designer-margin-mm-input" className="text-xs text-slate-500 block">
                    {t('designer.pageSetup.marginMm', { defaultValue: 'Margin (mm)' })}
                  </label>
                  <Input
                    id="designer-margin-mm-input"
                    type="number"
                    min={0}
                    max={50}
                    step={0.1}
                    value={printMarginDraft}
                    onChange={handleMarginDraftChange}
                    onBlur={commitMarginDraft}
                    data-automation-id="designer-margin-mm-input"
                  />
                </div>
              </div>
              <p className="text-sm text-slate-500">{t('designer.inspector.emptyHelp', { defaultValue: 'Select a component to edit its properties.' })}</p>
            </div>
          )}
        </aside>
        </div>
      </DndContext>
    </div>
  );
};

type DesignerWorkspaceProps = {
  nodes: DesignerNode[];
  selectedNodeId: string | null;
  activeReferenceNodeId: string | null;
  constrainedCounterpartNodeIds: Set<string>;
  showGuides: boolean;
  showRulers: boolean;
  gridSize: number;
  canvasScale: number;
  snapToGrid: boolean;
  guides: AlignmentGuide[];
  isDragActive: boolean;
  dropIndicator: DropIndicator;
  forcedDropTarget: string | 'canvas' | null;
  activeDrag: ActiveDragState;
  modifiers: Modifier[];
  onPointerLocationChange: (point: { x: number; y: number } | null) => void;
  onNodeSelect: (nodeId: string | null) => void;
  onResize: (nodeId: string, size: { width: number; height: number }, commit?: boolean) => void;
  onTextEdit: (nodeId: string, text: string, commit: boolean) => void;
  onDragStart: (event: DragStartEvent) => void;
  onDragMove: (event: DragMoveEvent) => void;
  onDragOver: (event: DragOverEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onDragCancel: () => void;
};

const DesignerWorkspace: React.FC<DesignerWorkspaceProps> = ({
  nodes,
  selectedNodeId,
  activeReferenceNodeId,
  constrainedCounterpartNodeIds,
  showGuides,
  showRulers,
  gridSize,
  canvasScale,
  snapToGrid,
  guides,
  isDragActive,
  dropIndicator,
  forcedDropTarget,
  activeDrag,
  modifiers,
  onPointerLocationChange,
  onNodeSelect,
  onResize,
  onTextEdit,
  onDragStart,
  onDragMove,
  onDragOver,
  onDragEnd,
  onDragCancel,
}) => {
  const { t } = useTranslation('msp/invoicing');
  useDndMonitor({
    onDragStart,
    onDragMove,
    onDragOver,
    onDragEnd,
    onDragCancel,
  });

  const isInvalidDrop =
    dropIndicator?.kind === 'container' ||
    (dropIndicator?.kind === 'insert' && dropIndicator.tone === 'invalid');

  return (
    <div className="flex min-h-0 min-w-0 flex-1" data-automation-id="designer-shell-canvas-panel">
	        <DesignCanvas
	          nodes={nodes}
	          selectedNodeId={selectedNodeId}
	          activeReferenceNodeId={activeReferenceNodeId}
	          constrainedCounterpartNodeIds={constrainedCounterpartNodeIds}
	          showGuides={showGuides}
	        showRulers={showRulers}
	        gridSize={gridSize}
	        canvasScale={canvasScale}
	        snapToGrid={snapToGrid}
	        guides={guides}
	        isDragActive={isDragActive}
          dropIndicator={dropIndicator}
	        forcedDropTarget={forcedDropTarget}
	        droppableId={DROPPABLE_CANVAS_ID}
	        onPointerLocationChange={onPointerLocationChange}
	        onNodeSelect={onNodeSelect}
	        onResize={onResize}
	        onTextEdit={onTextEdit}
	      />
	      <DragOverlay modifiers={modifiers}>
	        {activeDrag && (
	          <div
              className={clsx(
                'px-3 py-2 border rounded shadow-lg text-sm font-semibold',
                isInvalidDrop ? 'bg-destructive/10 border-destructive/30 text-destructive cursor-not-allowed' : 'bg-background cursor-grab'
              )}
            >
	            {activeDrag.kind === 'component'
	              ? t(`designer.blocks.${activeDrag.componentType}.label`, { defaultValue: getDefinition(activeDrag.componentType)?.label ?? 'Component' })
	              : activeDrag.kind === 'preset'
	                ? t(`designer.presets.${activeDrag.presetId}.label`, { defaultValue: getPresetById(activeDrag.presetId)?.label ?? 'Preset' })
	                : (() => {
                      const draggedNode = nodes.find((node) => node.id === activeDrag.nodeId);
                      return draggedNode ? getNodeName(draggedNode) : t('designer.dragOverlay.component', { defaultValue: 'Component' });
                    })()}
	          </div>
	        )}
	      </DragOverlay>
    </div>
  );
};

type DesignerBreadcrumbsProps = {
  nodes: DesignerNode[];
  selectedNodeId: string | null;
  onSelect: (nodeId: string | null) => void;
};

const computeBreadcrumbNodes = (nodes: DesignerNode[], selectedNodeId: string | null): DesignerNode[] => {
  if (!selectedNodeId) return [];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const parentById = new Map<string, string | null>();
  nodes.forEach((node) => {
    node.children.forEach((childId) => {
      if (!parentById.has(childId)) {
        parentById.set(childId, node.id);
      }
    });
  });
  const path: DesignerNode[] = [];
  let currentId: string | null = selectedNodeId;
  while (currentId) {
    const current = nodeMap.get(currentId);
    if (!current) break;
    if (current.type !== 'document') {
      path.push(current);
    }
    currentId = parentById.get(currentId) ?? null;
  }
  return path.reverse();
};

const DesignerBreadcrumbs: React.FC<DesignerBreadcrumbsProps> = ({ nodes, selectedNodeId, onSelect }) => {
  const { t } = useTranslation('msp/invoicing');
  const breadcrumbs = React.useMemo(() => {
    return computeBreadcrumbNodes(nodes, selectedNodeId);
  }, [nodes, selectedNodeId]);

  if (breadcrumbs.length === 0) {
    return (
      <div className="border-t border-b border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-slate-50 dark:bg-[rgb(var(--color-card))] px-4 py-2 text-xs text-slate-500 dark:text-slate-400">
        {t('designer.breadcrumbs.emptyHelp', { defaultValue: 'Select a component on the canvas to view its hierarchy.' })}
      </div>
    );
  }

  return (
    <div className="border-t border-b border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-slate-50 dark:bg-[rgb(var(--color-card))] px-4 py-2 text-xs text-slate-600 dark:text-slate-400 flex items-center flex-wrap gap-1">
      <span className="font-semibold text-slate-700 dark:text-slate-300 mr-1">{t('designer.breadcrumbs.hierarchy', { defaultValue: 'Hierarchy' })}</span>
      {breadcrumbs.map((node, index) => {
        const isActive = index === breadcrumbs.length - 1;
        return (
          <React.Fragment key={node.id}>
            {index > 0 && <span className="text-slate-400">/</span>}
            <button
              type="button"
              className={`px-1 py-0.5 rounded ${
                isActive ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 cursor-default' : 'hover:underline text-slate-600 dark:text-slate-400'
              }`}
              onClick={() => {
                if (!isActive) {
                  onSelect(node.id);
                }
              }}
              aria-current={isActive ? 'page' : undefined}
              disabled={isActive}
            >
              {getNodeName(node)}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
};

export const __designerShellTestUtils = {
  getSectionFitSizeFromChildren,
  getSectionFitIntent,
  resolveNearestAncestorSection,
  wasSizeConstrainedFromDraft,
  getSectionFitNoopMessage,
  shouldPromoteParentToCanvasForManualPosition,
  computeBreadcrumbNodes,
};

const createLocalId = () => generateUUID();
