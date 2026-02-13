import React, { useCallback, useMemo, useRef, useState } from 'react';
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
  closestCenter,
  pointerWithin,
  type CollisionDetection,
  useDndMonitor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import clsx from 'clsx';
import { restrictToWindowEdges, createSnapModifier } from '@dnd-kit/modifiers';
import { ComponentPalette } from './palette/ComponentPalette';
import { DesignCanvas } from './canvas/DesignCanvas';
import { DesignerToolbar } from './toolbar/DesignerToolbar';
import type { DesignerComponentType, DesignerNode, Point, Size } from './state/designerStore';
import { getAbsolutePosition, useInvoiceDesignerStore } from './state/designerStore';
import { AlignmentGuide, resolveFlexPadding } from './utils/layout';
import { getDefinition } from './constants/componentCatalog';
import { getPresetById } from './constants/presets';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { useDesignerShortcuts } from './hooks/useDesignerShortcuts';
import { canNestWithinParent, getAllowedParentsForType } from './state/hierarchy';

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

const getSectionFitSizeFromChildren = (
  section: DesignerNode,
  nodesById: Map<string, DesignerNode>
): Size | null => {
  const sectionChildren = section.childIds
    .map((childId) => nodesById.get(childId))
    .filter((node): node is DesignerNode => Boolean(node));

  if (sectionChildren.length === 0) {
    return null;
  }

  const padding = resolveFlexPadding(section);
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

const getSectionFitNoopMessage = (section: DesignerNode) =>
  section.layout?.sizing === 'fill'
    ? 'Section is already fitted in Fill mode. Switch section sizing to Fixed to shrink dimensions.'
    : 'Section is already fitted.';

const shouldPromoteParentToCanvasForManualPosition = (
  node: DesignerNode | null,
  parent: DesignerNode | null,
  draft: { x: number; y: number }
) => {
  if (!node || node.type !== 'label') {
    return false;
  }
  if (!parent || parent.layout?.mode !== 'flex') {
    return false;
  }
  if (!Number.isFinite(draft.x) || !Number.isFinite(draft.y)) {
    return false;
  }
  return Math.abs(draft.x - node.position.x) >= 0.5 || Math.abs(draft.y - node.position.y) >= 0.5;
};

export const DesignerShell: React.FC = () => {
  const nodes = useInvoiceDesignerStore((state) => state.nodes);
  const selectedNodeId = useInvoiceDesignerStore((state) => state.selectedNodeId);
  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId) ?? null, [nodes, selectedNodeId]);
  const addNode = useInvoiceDesignerStore((state) => state.addNodeFromPalette);
  const insertPreset = useInvoiceDesignerStore((state) => state.insertPreset);
  const setNodePosition = useInvoiceDesignerStore((state) => state.setNodePosition);
  const updateNodeSize = useInvoiceDesignerStore((state) => state.updateNodeSize);
  const moveNodeToParentAtIndex = useInvoiceDesignerStore((state) => state.moveNodeToParentAtIndex);
  const selectNode = useInvoiceDesignerStore((state) => state.selectNode);
  const updateNodeName = useInvoiceDesignerStore((state) => state.updateNodeName);
  const updateNodeMetadata = useInvoiceDesignerStore((state) => state.updateNodeMetadata);
  const updateNodeLayout = useInvoiceDesignerStore((state) => state.updateNodeLayout);
  const updateNodeStyle = useInvoiceDesignerStore((state) => state.updateNodeStyle);
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

  const clearLayoutPreset = useInvoiceDesignerStore((state) => state.clearLayoutPreset);

  // Constraints were removed as part of the CSS-first layout cutover.
  const referenceNodeId = null;
  const selectedCounterpartNodeIds = useMemo(() => new Set<string>(), []);
  const selectedPreset = selectedNode?.layoutPresetId ? getPresetById(selectedNode.layoutPresetId) : null;
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
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node] as const)), [nodes]);

	  useDesignerShortcuts();
	
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

  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      // Prefer the smallest rect under the pointer as a proxy for "deepest" nesting.
      return [...pointerCollisions].sort((a, b) => {
        const rectA = args.droppableRects.get(a.id);
        const rectB = args.droppableRects.get(b.id);
        const areaA = rectA ? rectA.width * rectA.height : Number.POSITIVE_INFINITY;
        const areaB = rectB ? rectB.width * rectB.height : Number.POSITIVE_INFINITY;
        return areaA - areaB;
      });
    }
    return closestCenter(args);
  }, []);

  const [propertyDraft, setPropertyDraft] = useState(() => ({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  }));

  React.useEffect(() => {
    if (selectedNode) {
      setPropertyDraft({
        x: selectedNode.position.x,
        y: selectedNode.position.y,
        width: selectedNode.size.width,
        height: selectedNode.size.height,
      });
    }
  }, [selectedNode]);

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
      documentNode.childIds
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
        showDropFeedback('error', resolution.message);
        return false;
      }

      const def = getDefinition(componentType);
      const defaultMetadata = def ? buildDefaultMetadata(componentType, def.defaultMetadata) : undefined;
      const existingNodeIds = new Set(useInvoiceDesignerStore.getState().nodes.map((node) => node.id));
      addNode(
        componentType,
        dropPoint,
        def
          ? {
              parentId: resolution.parentId,
              defaults: { size: def.defaultSize, metadata: defaultMetadata },
            }
          : { parentId: resolution.parentId }
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

  const renderLayoutInspector = () => {
    if (!selectedNode) return null;

    const isContainer = selectedNode.allowedChildren.length > 0;
    if (!isContainer) return null;

    const layout = selectedNode.layout ?? {
      display: 'flex' as const,
      flexDirection: 'column' as const,
      gap: '0px',
      padding: '0px',
      justifyContent: 'flex-start' as const,
      alignItems: 'stretch' as const,
    };
    const isFlexLayout = layout.display === 'flex';
    const isGridLayout = layout.display === 'grid';

    const parsePx = (value: unknown, fallback = 0) => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value !== 'string') return fallback;
      const trimmed = value.trim();
      if (!trimmed.endsWith('px')) return fallback;
      const parsed = Number.parseFloat(trimmed.slice(0, -2));
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    const gapPx = parsePx(layout.gap, 0);
    const paddingPx = parsePx(layout.padding, 0);

    return (
      <div className="rounded border border-slate-200 bg-white px-3 py-2 space-y-3">
        <p className="text-xs font-semibold text-slate-700">Layout</p>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-slate-500 block mb-1">Mode</label>
            <select
              className="w-full border border-slate-300 rounded px-1 py-1 text-xs"
              value={layout.display}
              onChange={(e) => {
                const next = e.target.value as 'flex' | 'grid';
                if (next === 'flex') {
                  updateNodeLayout(selectedNode.id, {
                    display: 'flex',
                    flexDirection: layout.flexDirection ?? 'column',
                    justifyContent: layout.justifyContent ?? 'flex-start',
                    alignItems: layout.alignItems ?? 'stretch',
                  });
                  return;
                }
                updateNodeLayout(selectedNode.id, {
                  display: 'grid',
                  gridTemplateColumns: layout.gridTemplateColumns ?? 'repeat(2, minmax(0, 1fr))',
                  gridTemplateRows: layout.gridTemplateRows,
                  gridAutoFlow: layout.gridAutoFlow ?? 'row',
                });
              }}
            >
              <option value="flex">Stack (Flex)</option>
              <option value="grid">Grid</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-slate-500 block mb-1">Gap (px)</label>
            <input
              type="number"
              className="w-full border border-slate-300 rounded px-1 py-1 text-xs"
              value={gapPx}
              onChange={(e) => updateNodeLayout(selectedNode.id, { gap: `${Number(e.target.value) || 0}px` })}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {isFlexLayout && (
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">Direction</label>
              <select
                className="w-full border border-slate-300 rounded px-1 py-1 text-xs"
                value={layout.flexDirection ?? 'column'}
                onChange={(e) =>
                  updateNodeLayout(selectedNode.id, {
                    display: 'flex',
                    flexDirection: e.target.value as 'row' | 'column',
                  })
                }
              >
                <option value="column">Vertical ↓</option>
                <option value="row">Horizontal →</option>
              </select>
            </div>
          )}
          <div>
            <label className="text-[10px] text-slate-500 block mb-1">Padding (px)</label>
            <input
              type="number"
              className="w-full border border-slate-300 rounded px-1 py-1 text-xs"
              value={paddingPx}
              onChange={(e) => updateNodeLayout(selectedNode.id, { padding: `${Number(e.target.value) || 0}px` })}
            />
          </div>
          {isGridLayout && (
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">Auto Flow</label>
              <select
                className="w-full border border-slate-300 rounded px-1 py-1 text-xs"
                value={layout.gridAutoFlow ?? 'row'}
                onChange={(e) => updateNodeLayout(selectedNode.id, { gridAutoFlow: e.target.value as any })}
              >
                <option value="row">row</option>
                <option value="column">column</option>
                <option value="dense">dense</option>
                <option value="row dense">row dense</option>
                <option value="column dense">column dense</option>
              </select>
            </div>
          )}
          {isFlexLayout && (
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">Align Items</label>
              <select
                className="w-full border border-slate-300 rounded px-1 py-1 text-xs"
                value={layout.alignItems ?? 'stretch'}
                onChange={(e) => updateNodeLayout(selectedNode.id, { alignItems: e.target.value as any })}
              >
                <option value="flex-start">Start</option>
                <option value="center">Center</option>
                <option value="flex-end">End</option>
                <option value="stretch">Stretch</option>
              </select>
            </div>
          )}
          {isFlexLayout && (
            <div className="col-span-2">
              <label className="text-[10px] text-slate-500 block mb-1">Justify Content</label>
              <select
                className="w-full border border-slate-300 rounded px-1 py-1 text-xs"
                value={layout.justifyContent ?? 'flex-start'}
                onChange={(e) => updateNodeLayout(selectedNode.id, { justifyContent: e.target.value as any })}
              >
                <option value="flex-start">Start</option>
                <option value="center">Center</option>
                <option value="flex-end">End</option>
                <option value="space-between">Space Between</option>
                <option value="space-around">Space Around</option>
                <option value="space-evenly">Space Evenly</option>
              </select>
            </div>
          )}
          {isGridLayout && (
            <div className="col-span-2">
              <label className="text-[10px] text-slate-500 block mb-1">Template Columns</label>
              <Input
                id="designer-grid-template-columns"
                value={layout.gridTemplateColumns ?? ''}
                placeholder="repeat(2, minmax(0, 1fr))"
                onChange={(event) =>
                  updateNodeLayout(selectedNode.id, {
                    gridTemplateColumns: normalizeCssValue(event.target.value),
                  })
                }
              />
            </div>
          )}
          {isGridLayout && (
            <div className="col-span-2">
              <label className="text-[10px] text-slate-500 block mb-1">Template Rows</label>
              <Input
                id="designer-grid-template-rows"
                value={layout.gridTemplateRows ?? ''}
                placeholder="auto"
                onChange={(event) =>
                  updateNodeLayout(selectedNode.id, {
                    gridTemplateRows: normalizeCssValue(event.target.value),
                  })
                }
              />
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderFlexItemInspector = () => {
    if (!selectedNode) return null;
    if (!selectedNode.parentId) return null;
    const parent = nodesById.get(selectedNode.parentId) ?? null;
    if (!parent || parent.layout?.display !== 'flex') {
      return null;
    }

    const parseNumber = (value: unknown): string => {
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
      return '';
    };

    const normalizeNumber = (raw: string): number | undefined => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) return undefined;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : undefined;
    };

    return (
      <div className="rounded border border-slate-200 bg-white px-3 py-2 space-y-2">
        <p className="text-xs font-semibold text-slate-700">Flex Item</p>
        <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
          <div>
            <label htmlFor="designer-style-flex-grow" className="text-[10px] text-slate-500 block mb-1">
              flex-grow
            </label>
            <Input
              id="designer-style-flex-grow"
              type="number"
              value={parseNumber(selectedNode.style?.flexGrow)}
              placeholder="0"
              onChange={(event) =>
                updateNodeStyle(selectedNode.id, { flexGrow: normalizeNumber(event.target.value) })
              }
            />
          </div>
          <div>
            <label htmlFor="designer-style-flex-shrink" className="text-[10px] text-slate-500 block mb-1">
              flex-shrink
            </label>
            <Input
              id="designer-style-flex-shrink"
              type="number"
              value={parseNumber(selectedNode.style?.flexShrink)}
              placeholder="1"
              onChange={(event) =>
                updateNodeStyle(selectedNode.id, { flexShrink: normalizeNumber(event.target.value) })
              }
            />
          </div>
          <div className="col-span-2">
            <label htmlFor="designer-style-flex-basis" className="text-[10px] text-slate-500 block mb-1">
              flex-basis
            </label>
            <Input
              id="designer-style-flex-basis"
              value={selectedNode.style?.flexBasis ?? ''}
              placeholder="auto | 240px | 50%"
              onChange={(event) =>
                updateNodeStyle(selectedNode.id, { flexBasis: normalizeCssValue(event.target.value) })
              }
            />
          </div>
        </div>
      </div>
    );
  };

  const renderMetadataInspector = () => {
    if (!selectedNode) {
      return null;
    }
    const metadata = (selectedNode.metadata ?? {}) as Record<string, any>;
    const applyMetadata = (patch: Record<string, unknown>) => updateNodeMetadata(selectedNode.id, patch);

    if (selectedNode.type === 'section') {
      return (
        <div className="rounded border border-slate-200 bg-white px-3 py-2 space-y-2">
          <p className="text-xs font-semibold text-slate-700">Section Border</p>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Border style</label>
            <select
              id="designer-section-border-style"
              className="w-full border border-slate-300 rounded-md px-2 py-1 text-sm"
              value={metadata.sectionBorderStyle ?? 'light'}
              onChange={(event) => applyMetadata({ sectionBorderStyle: event.target.value })}
            >
              <option value="none">None</option>
              <option value="light">Light</option>
              <option value="strong">Strong</option>
            </select>
          </div>
        </div>
      );
    }

    if (selectedNode.type === 'field') {
      return (
        <div className="rounded border border-slate-200 bg-white px-3 py-2 space-y-2">
          <p className="text-xs font-semibold text-slate-700">Field Binding</p>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Binding key</label>
            <Input
              id="designer-field-binding"
              value={metadata.bindingKey ?? ''}
              onChange={(event) => applyMetadata({ bindingKey: event.target.value })}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Format</label>
            <select
              className="w-full border border-slate-300 rounded-md px-2 py-1 text-sm"
              value={metadata.format ?? 'text'}
              onChange={(event) => applyMetadata({ format: event.target.value })}
            >
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="currency">Currency</option>
              <option value="date">Date</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Placeholder</label>
            <Input
              id="designer-field-placeholder"
              value={metadata.placeholder ?? ''}
              onChange={(event) => applyMetadata({ placeholder: event.target.value })}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Border style</label>
            <select
              id="designer-field-border-style"
              className="w-full border border-slate-300 rounded-md px-2 py-1 text-sm"
              value={metadata.fieldBorderStyle ?? 'underline'}
              onChange={(event) => applyMetadata({ fieldBorderStyle: event.target.value })}
            >
              <option value="none">None</option>
              <option value="underline">Underline</option>
              <option value="box">Box</option>
            </select>
          </div>
        </div>
      );
    }

    if (selectedNode.type === 'label') {
      return (
        <div className="rounded border border-slate-200 bg-white px-3 py-2 space-y-2">
          <p className="text-xs font-semibold text-slate-700">Label Text</p>
          <Input
            id="designer-label-text"
            value={selectedNode.name ?? ''}
            onChange={(event) => updateNodeName(selectedNode.id, event.target.value)}
          />
          <div>
            <label className="text-xs text-slate-500 block mb-1">Weight</label>
            <select
              id="designer-label-weight"
              className="w-full border border-slate-300 rounded-md px-2 py-1 text-sm"
              value={metadata.fontWeight ?? metadata.labelFontWeight ?? 'semibold'}
              onChange={(event) => applyMetadata({ fontWeight: event.target.value })}
            >
              <option value="normal">Normal</option>
              <option value="medium">Medium</option>
              <option value="semibold">Semibold</option>
              <option value="bold">Bold</option>
            </select>
          </div>
        </div>
      );
    }

    if (selectedNode.type === 'table' || selectedNode.type === 'dynamic-table') {
      const columns: Array<Record<string, any>> = Array.isArray(metadata.columns) ? metadata.columns : [];
      const tableBorderPreset =
        metadata.tableBorderPreset === 'list' ||
        metadata.tableBorderPreset === 'boxed' ||
        metadata.tableBorderPreset === 'grid' ||
        metadata.tableBorderPreset === 'none'
          ? metadata.tableBorderPreset
          : 'custom';
      const tableBorderConfig =
        tableBorderPreset === 'list'
          ? { outer: false, rowDividers: true, columnDividers: false }
          : tableBorderPreset === 'boxed'
            ? { outer: true, rowDividers: true, columnDividers: false }
            : tableBorderPreset === 'grid'
              ? { outer: true, rowDividers: true, columnDividers: true }
              : tableBorderPreset === 'none'
                ? { outer: false, rowDividers: false, columnDividers: false }
                : {
                    outer: metadata.tableOuterBorder !== false,
                    rowDividers: metadata.tableRowDividers !== false,
                    columnDividers: metadata.tableColumnDividers === true,
                  };
      const tableOuterBorder = tableBorderConfig.outer;
      const tableRowDividers = tableBorderConfig.rowDividers;
      const tableColumnDividers = tableBorderConfig.columnDividers;
      const updateColumns = (next: Array<Record<string, any>>) => applyMetadata({ columns: next });
      const updateColumn = (columnId: string, patch: Record<string, unknown>) => {
        updateColumns(
          columns.map((column) => (column.id === columnId ? { ...column, ...patch } : column))
        );
      };
      const handleAddColumn = () => {
        updateColumns([
          ...columns,
          {
            id: createLocalId(),
            header: 'New Column',
            key: 'data.field',
            type: 'text',
            width: 120,
          },
        ]);
      };
      const handleRemoveColumn = (columnId: string) => {
        updateColumns(columns.filter((column) => column.id !== columnId));
      };
      const applyTableBorderPreset = (preset: 'list' | 'boxed' | 'grid' | 'none' | 'custom') => {
        if (preset === 'list') {
          applyMetadata({
            tableBorderPreset: 'list',
            tableOuterBorder: false,
            tableRowDividers: true,
            tableColumnDividers: false,
          });
          return;
        }
        if (preset === 'boxed') {
          applyMetadata({
            tableBorderPreset: 'boxed',
            tableOuterBorder: true,
            tableRowDividers: true,
            tableColumnDividers: false,
          });
          return;
        }
        if (preset === 'grid') {
          applyMetadata({
            tableBorderPreset: 'grid',
            tableOuterBorder: true,
            tableRowDividers: true,
            tableColumnDividers: true,
          });
          return;
        }
        if (preset === 'none') {
          applyMetadata({
            tableBorderPreset: 'none',
            tableOuterBorder: false,
            tableRowDividers: false,
            tableColumnDividers: false,
          });
          return;
        }
        applyMetadata({ tableBorderPreset: 'custom' });
      };

      return (
        <div className="rounded border border-slate-200 bg-white px-3 py-2 space-y-3">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
            <span>Table Columns</span>
            <Button id="designer-add-column" variant="outline" size="xs" onClick={handleAddColumn}>
              Add column
            </Button>
          </div>
          <div className="rounded border border-slate-100 bg-slate-50 px-2 py-2 space-y-1 text-xs text-slate-600">
            <p className="font-semibold text-slate-700">Borders</p>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Preset</label>
              <select
                id="designer-table-border-preset"
                className="w-full border border-slate-300 rounded-md px-2 py-1 text-sm"
                value={tableBorderPreset}
                onChange={(event) =>
                  applyTableBorderPreset(event.target.value as 'list' | 'boxed' | 'grid' | 'none' | 'custom')
                }
              >
                <option value="list">List</option>
                <option value="boxed">Boxed</option>
                <option value="grid">Grid</option>
                <option value="none">None</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <label className="flex items-center gap-2">
              <input
                id="designer-table-border-outer"
                type="checkbox"
                checked={tableOuterBorder}
                onChange={(event) =>
                  applyMetadata({ tableBorderPreset: 'custom', tableOuterBorder: event.target.checked })
                }
              />
              Outer border
            </label>
            <label className="flex items-center gap-2">
              <input
                id="designer-table-border-rows"
                type="checkbox"
                checked={tableRowDividers}
                onChange={(event) =>
                  applyMetadata({ tableBorderPreset: 'custom', tableRowDividers: event.target.checked })
                }
              />
              Row dividers
            </label>
            <label className="flex items-center gap-2">
              <input
                id="designer-table-border-columns"
                type="checkbox"
                checked={tableColumnDividers}
                onChange={(event) =>
                  applyMetadata({ tableBorderPreset: 'custom', tableColumnDividers: event.target.checked })
                }
              />
              Column dividers
            </label>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Header weight</label>
              <select
                id="designer-table-header-weight"
                className="w-full border border-slate-300 rounded-md px-2 py-1 text-sm"
                value={metadata.tableHeaderFontWeight ?? 'semibold'}
                onChange={(event) => applyMetadata({ tableHeaderFontWeight: event.target.value })}
              >
                <option value="normal">Normal</option>
                <option value="medium">Medium</option>
                <option value="semibold">Semibold</option>
                <option value="bold">Bold</option>
              </select>
            </div>
          </div>
          {columns.length === 0 && (
            <p className="text-xs text-slate-500">No columns defined. Add at least one column.</p>
          )}
          {columns.map((column) => (
            <div key={column.id} className="border border-slate-100 rounded-md p-2 space-y-2 bg-slate-50">
              <div className="flex items-center justify-between">
                <Input
                  id={`column-header-${column.id}`}
                  value={column.header ?? ''}
                  onChange={(event) => updateColumn(column.id, { header: event.target.value })}
                  className="text-xs"
                />
                <Button
                  id={`designer-remove-column-${column.id}`}
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemoveColumn(column.id)}
                >
                  ✕
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                <div>
                  <label className="block mb-1">Binding key</label>
                  <Input
                    id={`column-key-${column.id}`}
                    value={column.key ?? ''}
                    onChange={(event) => updateColumn(column.id, { key: event.target.value })}
                    className="text-xs"
                  />
                </div>
                <div>
                  <label className="block mb-1">Type</label>
                  <select
                    className="w-full border border-slate-300 rounded-md px-2 py-1 text-xs"
                    value={column.type ?? 'text'}
                    onChange={(event) => updateColumn(column.id, { type: event.target.value })}
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="currency">Currency</option>
                    <option value="date">Date</option>
                  </select>
                </div>
                <div>
                  <label className="block mb-1">Width (px)</label>
                  <Input
                    id={`column-width-${column.id}`}
                    type="number"
                    value={column.width ?? 120}
                    onChange={(event) => updateColumn(column.id, { width: Number(event.target.value) })}
                    className="text-xs"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (['subtotal', 'tax', 'discount', 'custom-total'].includes(selectedNode.type)) {
      return (
        <div className="rounded border border-slate-200 bg-white px-3 py-2 space-y-2">
          <p className="text-xs font-semibold text-slate-700">Totals Row</p>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Label</label>
            <Input
              id="designer-total-label"
              value={metadata.label ?? selectedNode.name ?? ''}
              onChange={(event) => applyMetadata({ label: event.target.value })}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Binding key</label>
            <Input
              id="designer-total-binding"
              value={metadata.bindingKey ?? ''}
              onChange={(event) => applyMetadata({ bindingKey: event.target.value })}
            />
          </div>
          {selectedNode.type === 'custom-total' && (
            <div>
              <label className="text-xs text-slate-500 block mb-1">Computation notes</label>
              <textarea
                className="w-full border border-slate-300 rounded-md px-2 py-1 text-sm"
                value={metadata.notes ?? ''}
                onChange={(event) => applyMetadata({ notes: event.target.value })}
              />
            </div>
          )}
        </div>
      );
    }

    if (selectedNode.type === 'action-button') {
      return (
        <div className="rounded border border-slate-200 bg-white px-3 py-2 space-y-2">
          <p className="text-xs font-semibold text-slate-700">Button</p>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Label</label>
            <Input
              id="designer-button-label"
              value={metadata.label ?? 'Button'}
              onChange={(event) => applyMetadata({ label: event.target.value })}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Action type</label>
            <select
              className="w-full border border-slate-300 rounded-md px-2 py-1 text-sm"
              value={metadata.actionType ?? 'url'}
              onChange={(event) => applyMetadata({ actionType: event.target.value })}
            >
              <option value="url">URL</option>
              <option value="mailto">Email</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Action value</label>
            <Input
              id="designer-button-action"
              value={metadata.actionValue ?? ''}
              onChange={(event) => applyMetadata({ actionValue: event.target.value })}
            />
          </div>
        </div>
      );
    }

    if (selectedNode.type === 'signature') {
      return (
        <div className="rounded border border-slate-200 bg-white px-3 py-2 space-y-2">
          <p className="text-xs font-semibold text-slate-700">Signature Block</p>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Signer label</label>
            <Input
              id="designer-signature-label"
              value={metadata.signerLabel ?? 'Authorized Signature'}
              onChange={(event) => applyMetadata({ signerLabel: event.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={Boolean(metadata.includeDate)}
              onChange={(event) => applyMetadata({ includeDate: event.target.checked })}
            />
            Include signing date
          </label>
        </div>
      );
    }

    if (selectedNode.type === 'attachment-list') {
      const items: Array<Record<string, any>> = Array.isArray(metadata.items) ? metadata.items : [];
      const updateItems = (next: Array<Record<string, any>>) => applyMetadata({ items: next });
      const updateItem = (itemId: string, patch: Record<string, unknown>) => {
        updateItems(items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)));
      };
      const addItem = () => {
        updateItems([
          ...items,
          {
            id: createLocalId(),
            label: 'Attachment',
            url: 'https://example.com',
          },
        ]);
      };
      const removeItem = (itemId: string) => updateItems(items.filter((item) => item.id !== itemId));

      return (
        <div className="rounded border border-slate-200 bg-white px-3 py-2 space-y-2">
          <p className="text-xs font-semibold text-slate-700">Attachments</p>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Title</label>
            <Input
              id="designer-attachments-title"
              value={metadata.title ?? 'Attachments'}
              onChange={(event) => applyMetadata({ title: event.target.value })}
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
            <div key={item.id} className="border border-slate-100 rounded-md p-2 space-y-2 bg-slate-50">
              <div className="flex items-center justify-between">
                <Input
                  id={`attachment-label-${item.id}`}
                  value={item.label ?? ''}
                  onChange={(event) => updateItem(item.id, { label: event.target.value })}
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
                onChange={(event) => updateItem(item.id, { url: event.target.value })}
                className="text-xs"
              />
            </div>
          ))}
        </div>
      );
    }

	    if (selectedNode.type === 'image' || selectedNode.type === 'logo' || selectedNode.type === 'qr') {
	      const fitMode = metadata.fitMode ?? metadata.fit ?? 'contain';
        const objectFit = selectedNode.style?.objectFit ?? fitMode;
	      return (
	        <div className="rounded border border-slate-200 bg-white px-3 py-2 space-y-2">
	          <p className="text-xs font-semibold text-slate-700">Media</p>
	          <div>
            <label className="text-xs text-slate-500 block mb-1">Source URL</label>
            <Input
              id="designer-media-src"
              value={metadata.src ?? metadata.url ?? ''}
              onChange={(event) => applyMetadata({ src: event.target.value, url: event.target.value })}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Alt text</label>
            <Input
              id="designer-media-alt"
              value={metadata.alt ?? ''}
              onChange={(event) => applyMetadata({ alt: event.target.value })}
            />
	          </div>
	          <div>
	            <label className="text-xs text-slate-500 block mb-1">Object fit</label>
	            <select
	              className="w-full border border-slate-300 rounded-md px-2 py-1 text-sm"
	              value={objectFit}
	              onChange={(event) => {
                  const next = event.target.value;
                  updateNodeStyle(selectedNode.id, { objectFit: next as any });
                  if (next === 'contain' || next === 'cover' || next === 'fill') {
                    applyMetadata({ fitMode: next, fit: next });
                  }
                }}
	            >
	              <option value="contain">Contain</option>
	              <option value="cover">Cover</option>
	              <option value="fill">Fill</option>
                <option value="none">None</option>
                <option value="scale-down">Scale Down</option>
	            </select>
	          </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Aspect ratio</label>
              <Input
                id="designer-media-aspect-ratio"
                value={selectedNode.style?.aspectRatio ?? ''}
                placeholder="e.g. 16 / 9 or 1 / 1"
                onChange={(event) => updateNodeStyle(selectedNode.id, { aspectRatio: normalizeCssValue(event.target.value) })}
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
                Reflows <span className="font-medium text-slate-600">{selectedMediaParentSection.name}</span> to remove extra whitespace.
                {selectedMediaParentSection.layout?.sizing === 'fill' && (
                  <> In Fill mode, this will switch section sizing to Fixed before fitting.</>
                )}
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
      const axis = parent.layout?.display === 'flex' && parent.layout.flexDirection === 'row' ? 'x' : 'y';

      const activeRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
      const overRect = over.rect;
      if (!activeRect || !overRect) {
        return;
      }

      const activeCenter = axis === 'x' ? activeRect.left + activeRect.width / 2 : activeRect.top + activeRect.height / 2;
      const overCenter = axis === 'x' ? overRect.left + overRect.width / 2 : overRect.top + overRect.height / 2;
      const position: 'before' | 'after' = activeCenter < overCenter ? 'before' : 'after';
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
            const overIndex = parent.childIds.indexOf(overNode.id);
            let index = overIndex >= 0 ? overIndex : parent.childIds.length;

            if (parent.layout?.display === 'flex' && event.active.rect.current && over.rect) {
              const axis = parent.layout.flexDirection === 'row' ? 'x' : 'y';
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
            targetIndex = parent.childIds.length;
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

          moveNodeToParentAtIndex(activeNode.id, targetParentId, targetIndex);
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
    (componentType: DesignerComponentType) => {
      clearDropFeedback();
      const selectionAnchorId = useInvoiceDesignerStore.getState().selectedNodeId;
      insertComponentWithResolution(componentType, {
        strictSelectionPath: true,
        selectedNodeIdOverride: selectionAnchorId,
        preserveSelectionId: selectionAnchorId,
      });
    },
    [clearDropFeedback, insertComponentWithResolution]
  );

  const handleQuickInsertPreset = useCallback(
    (presetId: string) => {
      clearDropFeedback();
      insertPresetWithResolution(presetId);
    },
    [clearDropFeedback, insertPresetWithResolution]
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

  const handlePropertyInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    setPropertyDraft((prev) => ({ ...prev, [name]: Number(value) }));
  };

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
      let section = nodesById.get(sectionId);
      if (!section || section.type !== 'section') {
        showDropFeedback('info', missingSectionMessage);
        return;
      }

      // Legacy behavior used to auto-switch sizing modes before fitting.
      // In the CSS-first model, section sizing is controlled via CSS props instead.
      const switchedFromFill = false;

      const intent = getSectionFitIntent(section, nodesById);
      if (intent.status === 'no-children') {
        showDropFeedback('info', 'Section has no child content to fit.');
        return;
      }
      if (intent.status === 'already-fitted') {
        showDropFeedback('info', getSectionFitNoopMessage(section));
        return;
      }

      const beforeSize = section.size;
      updateNodeSize(section.id, intent.size, true);
      const afterSection = useInvoiceDesignerStore.getState().nodes.find((node) => node.id === section.id);
      if (!afterSection || sizesAreEffectivelyEqual(beforeSize, afterSection.size)) {
        showDropFeedback('info', getSectionFitNoopMessage(section));
        return;
      }
      showDropFeedback(
        'info',
        switchedFromFill
          ? 'Section switched to Fixed sizing and fitted to contents.'
          : 'Section fitted to contents.'
      );
    },
    [showDropFeedback, updateNodeSize]
  );

  const commitPropertyChanges = () => {
    if (!selectedNodeId) return;
    const liveNodes = useInvoiceDesignerStore.getState().nodes;
    const liveSelectedNode = liveNodes.find((node) => node.id === selectedNodeId) ?? null;
    const liveParentNode =
      liveSelectedNode?.parentId ? liveNodes.find((node) => node.id === liveSelectedNode.parentId) ?? null : null;

    setNodePosition(selectedNodeId, { x: propertyDraft.x, y: propertyDraft.y }, true);
    updateNodeSize(selectedNodeId, { width: propertyDraft.width, height: propertyDraft.height }, true);

    const resolvedNode = useInvoiceDesignerStore.getState().nodes.find((node) => node.id === selectedNodeId);
    if (!resolvedNode) {
      return;
    }

    const draftSize = {
      width: Number.isFinite(propertyDraft.width) ? propertyDraft.width : resolvedNode.size.width,
      height: Number.isFinite(propertyDraft.height) ? propertyDraft.height : resolvedNode.size.height,
    };
    if (wasSizeConstrainedFromDraft(draftSize, resolvedNode.size)) {
      showDropFeedback('info', 'Size constrained to valid bounds.');
    }
  };

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

  return (
    <div className="flex flex-col h-full border border-slate-200 rounded-lg overflow-hidden">
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
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-1.5 text-xs text-slate-600">
        <span className="font-semibold text-slate-700">Selected:</span>{' '}
        {selectedNode ? (
          <span data-automation-id="designer-selected-context">
            {selectedNode.name} <span className="text-slate-500">({selectedNode.type})</span>
          </span>
        ) : (
          <>
            <span className="text-slate-500" data-automation-id="designer-selected-context">
              None
            </span>
            <span className="ml-2 text-slate-400" data-automation-id="designer-no-selection-help">
              <span className="rounded-full border border-slate-300/70 bg-white/70 px-1.5 py-0.5 text-slate-500">
                Click a block on canvas
              </span>{' '}
              or use{' '}
              <span className="rounded-full border border-slate-300/70 bg-white/70 px-1.5 py-0.5 text-slate-500">
                + in the left panel
              </span>
              .
            </span>
          </>
        )}
	      </div>
	      <DesignerBreadcrumbs nodes={nodes} selectedNodeId={selectedNodeId} onSelect={selectNode} />
	      {dropFeedback && (
	        <div
	          className={clsx(
            'border-b px-4 py-2 text-xs',
            dropFeedback.tone === 'error'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-blue-200 bg-blue-50 text-blue-700'
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
	        <div className="flex flex-1 min-h-[560px] bg-white">
	          <div className="w-72">
	            <ComponentPalette
	              onInsertComponent={handleQuickInsertComponent}
              onInsertPreset={handleQuickInsertPreset}
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
	            onResize={updateNodeSize}
	            onDragStart={handleDragStart}
	            onDragMove={handleDragMove}
              onDragOver={handleDragOver}
	            onDragEnd={handleDragEnd}
	            onDragCancel={handleDragCancel}
	          />
          <aside className="w-72 border-l border-slate-200 bg-slate-50 p-4 space-y-4">
            <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wide">Inspector</h3>
	          {selectedNode ? (
	            <div className="space-y-3">
	              <div>
	                <label htmlFor="selected-name" className="text-xs text-slate-500 block mb-1">Name</label>
	                <Input
                  id="selected-name"
                  value={selectedNode.name}
                  onChange={(event) => updateNodeName(selectedNode.id, event.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs text-slate-500">
                <div>
                  <label htmlFor="prop-x" className="block mb-1">X</label>
                  <Input id="prop-x" name="x" type="number" value={propertyDraft.x} onChange={handlePropertyInput} onBlur={commitPropertyChanges} />
                </div>
                <div>
                  <label htmlFor="prop-y" className="block mb-1">Y</label>
                  <Input id="prop-y" name="y" type="number" value={propertyDraft.y} onChange={handlePropertyInput} onBlur={commitPropertyChanges} />
                </div>
                <div>
                  <label htmlFor="prop-width" className="block mb-1">Width</label>
                  <Input id="prop-width" name="width" type="number" value={propertyDraft.width} onChange={handlePropertyInput} onBlur={commitPropertyChanges} />
                </div>
                <div>
                  <label htmlFor="prop-height" className="block mb-1">Height</label>
                  <Input id="prop-height" name="height" type="number" value={propertyDraft.height} onChange={handlePropertyInput} onBlur={commitPropertyChanges} />
                </div>
              </div>
              {selectedPreset && (
                <div className="rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-700">Layout Preset</span>
                    <button
                      type="button"
                      className="text-blue-600 hover:underline"
                      onClick={() => clearLayoutPreset(selectedNode.id)}
                    >
                      Clear
                    </button>
                  </div>
	                  <div className="text-slate-500 text-[11px]">{selectedPreset.label}</div>
	                  <p className="text-[11px] text-slate-500">{selectedPreset.description}</p>
	                </div>
		              )}
		              {renderLayoutInspector()}
                  <div className="rounded border border-slate-200 bg-white px-3 py-2 space-y-2">
                    <p className="text-xs font-semibold text-slate-700">Sizing (CSS)</p>
                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                      <div>
                        <label htmlFor="designer-style-width" className="text-[10px] text-slate-500 block mb-1">
                          width
                        </label>
                        <Input
                          id="designer-style-width"
                          value={selectedNode.style?.width ?? ''}
                          placeholder="auto | 320px | 50% | 10rem"
                          onChange={(event) =>
                            updateNodeStyle(selectedNode.id, { width: normalizeCssValue(event.target.value) })
                          }
                        />
                      </div>
                      <div>
                        <label htmlFor="designer-style-height" className="text-[10px] text-slate-500 block mb-1">
                          height
                        </label>
                        <Input
                          id="designer-style-height"
                          value={selectedNode.style?.height ?? ''}
                          placeholder="auto | 180px | 12rem"
                          onChange={(event) =>
                            updateNodeStyle(selectedNode.id, { height: normalizeCssValue(event.target.value) })
                          }
                        />
                      </div>
                      <div>
                        <label htmlFor="designer-style-min-width" className="text-[10px] text-slate-500 block mb-1">
                          min-width
                        </label>
                        <Input
                          id="designer-style-min-width"
                          value={selectedNode.style?.minWidth ?? ''}
                          placeholder="0 | 200px"
                          onChange={(event) =>
                            updateNodeStyle(selectedNode.id, { minWidth: normalizeCssValue(event.target.value) })
                          }
                        />
                      </div>
                      <div>
                        <label htmlFor="designer-style-min-height" className="text-[10px] text-slate-500 block mb-1">
                          min-height
                        </label>
                        <Input
                          id="designer-style-min-height"
                          value={selectedNode.style?.minHeight ?? ''}
                          placeholder="0 | 120px"
                          onChange={(event) =>
                            updateNodeStyle(selectedNode.id, { minHeight: normalizeCssValue(event.target.value) })
                          }
                        />
                      </div>
                      <div>
                        <label htmlFor="designer-style-max-width" className="text-[10px] text-slate-500 block mb-1">
                          max-width
                        </label>
                        <Input
                          id="designer-style-max-width"
                          value={selectedNode.style?.maxWidth ?? ''}
                          placeholder="none | 600px"
                          onChange={(event) =>
                            updateNodeStyle(selectedNode.id, { maxWidth: normalizeCssValue(event.target.value) })
                          }
                        />
                      </div>
                      <div>
                        <label htmlFor="designer-style-max-height" className="text-[10px] text-slate-500 block mb-1">
                          max-height
                        </label>
                        <Input
                          id="designer-style-max-height"
                          value={selectedNode.style?.maxHeight ?? ''}
                          placeholder="none | 400px"
                          onChange={(event) =>
                            updateNodeStyle(selectedNode.id, { maxHeight: normalizeCssValue(event.target.value) })
                          }
                        />
                      </div>
	                    </div>
	                  </div>
                {renderFlexItemInspector()}
			              {selectedNode.type === 'section' && (
			                <div className="space-y-1">
			                  <Button
		                    id="designer-fit-section-to-contents"
                    variant="outline"
                    onClick={fitSelectedSectionToContents}
                  >
                    Fit Section to Contents
                  </Button>
                  {!selectedSectionFitSize && (
                    <p className="text-[11px] text-slate-500">Section has no child content to fit.</p>
                  )}
                </div>
              )}
              {renderMetadataInspector()}
              <Button id="designer-inspector-apply" variant="outline" onClick={commitPropertyChanges}>
                Apply
              </Button>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Select a component to edit its properties.</p>
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
  onDragStart,
  onDragMove,
  onDragOver,
  onDragEnd,
  onDragCancel,
}) => {
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
    <div className="flex-1 flex">
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
	      />
	      <DragOverlay modifiers={modifiers}>
	        {activeDrag && (
	          <div
              className={clsx(
                'px-3 py-2 border rounded shadow-lg text-sm font-semibold',
                isInvalidDrop ? 'bg-red-50 border-red-200 text-red-800 cursor-not-allowed' : 'bg-white cursor-grab'
              )}
            >
	            {activeDrag.kind === 'component'
	              ? getDefinition(activeDrag.componentType)?.label ?? 'Component'
	              : activeDrag.kind === 'preset'
	                ? getPresetById(activeDrag.presetId)?.label ?? 'Preset'
	                : nodes.find((node) => node.id === activeDrag.nodeId)?.name ?? 'Component'}
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

const DesignerBreadcrumbs: React.FC<DesignerBreadcrumbsProps> = ({ nodes, selectedNodeId, onSelect }) => {
  const breadcrumbs = React.useMemo(() => {
    if (!selectedNodeId) return [];
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const path: DesignerNode[] = [];
    let currentId: string | null = selectedNodeId;
    while (currentId) {
      const current = nodeMap.get(currentId);
      if (!current) break;
      if (current.type !== 'document') {
        path.push(current);
      }
      currentId = current.parentId ?? null;
    }
    return path.reverse();
  }, [nodes, selectedNodeId]);

  if (breadcrumbs.length === 0) {
    return (
      <div className="border-t border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-500">
        Select a component on the canvas to view its hierarchy.
      </div>
    );
  }

  return (
    <div className="border-t border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600 flex items-center flex-wrap gap-1">
      <span className="font-semibold text-slate-700 mr-1">Hierarchy</span>
      {breadcrumbs.map((node, index) => {
        const isActive = index === breadcrumbs.length - 1;
        return (
          <React.Fragment key={node.id}>
            {index > 0 && <span className="text-slate-400">/</span>}
            <button
              type="button"
              className={`px-1 py-0.5 rounded ${
                isActive ? 'bg-blue-100 text-blue-700 cursor-default' : 'hover:underline text-slate-600'
              }`}
              onClick={() => {
                if (!isActive) {
                  onSelect(node.id);
                }
              }}
              aria-current={isActive ? 'page' : undefined}
              disabled={isActive}
            >
              {node.name}
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
};

const createLocalId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);

const deepClone = <T,>(value: T): T => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
};

const buildDefaultMetadata = (
  componentType: DesignerComponentType,
  metadata?: Record<string, unknown>
): Record<string, unknown> | undefined => {
  if (!metadata) {
    return undefined;
  }
  const clone = deepClone(metadata);
  if (componentType === 'table' && Array.isArray((clone as { columns?: unknown }).columns)) {
    (clone as { columns: Array<Record<string, unknown>> }).columns = (
      (clone as { columns: Array<Record<string, unknown>> }).columns ?? []
    ).map((column) => ({
      ...column,
      id: column.id ? `${column.id}-${createLocalId()}` : createLocalId(),
    }));
  }
  if (componentType === 'attachment-list' && Array.isArray((clone as { items?: unknown }).items)) {
    (clone as { items: Array<Record<string, unknown>> }).items = (
      (clone as { items: Array<Record<string, unknown>> }).items ?? []
    ).map((item) => ({
      ...item,
      id: item.id ? `${item.id}-${createLocalId()}` : createLocalId(),
    }));
  }
  return clone;
};
