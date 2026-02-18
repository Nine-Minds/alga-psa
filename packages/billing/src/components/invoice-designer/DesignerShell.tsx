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
import { clampNodeSizeToPracticalMinimum, getAbsolutePosition, useInvoiceDesignerStore } from './state/designerStore';
import { AlignmentGuide, resolveFlexPadding } from './utils/layout';
import { getDefinition } from './constants/componentCatalog';
import { getPresetById } from './constants/presets';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { useDesignerShortcuts } from './hooks/useDesignerShortcuts';
import { canNestWithinParent, getAllowedParentsForType } from './schema/componentSchema';
import { invoiceDesignerCollisionDetection } from './utils/dndCollision';
import { resolveInsertPositionFromRects } from './utils/dropIndicator';
import { DesignerSchemaInspector } from './inspector/DesignerSchemaInspector';
import { getNodeLayout, getNodeMetadata, getNodeName, getNodeStyle } from './utils/nodeProps';

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

export const DesignerShell: React.FC = () => {
  const nodes = useInvoiceDesignerStore((state) => state.nodes);
  const selectedNodeId = useInvoiceDesignerStore((state) => state.selectedNodeId);
  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId) ?? null, [nodes, selectedNodeId]);
  const addNode = useInvoiceDesignerStore((state) => state.addNodeFromPalette);
  const insertPreset = useInvoiceDesignerStore((state) => state.insertPreset);
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

  const resizeNode = useCallback(
    (id: string, size: Size, commit: boolean = false) => {
      const node = useInvoiceDesignerStore.getState().nodesById[id];
      if (!node) return;

      const clamped = clampNodeSizeToPracticalMinimum(node.type, size);
      const rounded = {
        width: Math.round(clamped.width),
        height: Math.round(clamped.height),
      };

      // Batch updates without generating multiple history entries.
      setNodeProp(id, 'size.width', rounded.width, false);
      setNodeProp(id, 'size.height', rounded.height, false);
      setNodeProp(id, 'baseSize.width', rounded.width, false);
      setNodeProp(id, 'baseSize.height', rounded.height, false);
      setNodeProp(id, 'style.width', `${rounded.width}px`, false);
      setNodeProp(id, 'style.height', `${rounded.height}px`, commit);
    },
    [setNodeProp]
  );

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

  const collisionDetection = useCallback<CollisionDetection>(invoiceDesignerCollisionDetection, []);

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
        <div className="rounded border border-slate-200 bg-white px-3 py-2 space-y-2">
          <p className="text-xs font-semibold text-slate-700">Attachments</p>
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
            <div key={item.id} className="border border-slate-100 rounded-md p-2 space-y-2 bg-slate-50">
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
        const applyAspectRatio = (raw: string, commit: boolean) => {
          const normalized = normalizeCssValue(raw);
          if (normalized === undefined) {
            unsetNodeProp(selectedNode.id, 'style.aspectRatio', commit);
            return;
          }
          setNodeProp(selectedNode.id, 'style.aspectRatio', normalized, commit);
        };
		      return (
		        <div className="rounded border border-slate-200 bg-white px-3 py-2 space-y-2">
		          <p className="text-xs font-semibold text-slate-700">Media</p>
	          <div>
            <label className="text-xs text-slate-500 block mb-1">Source URL</label>
            <Input
              id="designer-media-src"
              value={metadata.src ?? metadata.url ?? ''}
              onChange={(event) => applyMetadata({ src: event.target.value, url: event.target.value }, false)}
              onBlur={(event) => applyMetadata({ src: event.target.value, url: event.target.value }, true)}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Alt text</label>
            <Input
              id="designer-media-alt"
              value={metadata.alt ?? ''}
              onChange={(event) => applyMetadata({ alt: event.target.value }, false)}
              onBlur={(event) => applyMetadata({ alt: event.target.value }, true)}
            />
	          </div>
	          <div>
	            <label className="text-xs text-slate-500 block mb-1">Object fit</label>
	            <select
	              className="w-full border border-slate-300 rounded-md px-2 py-1 text-sm"
		              value={objectFit}
		              onChange={(event) => {
	                  const next = event.target.value;
	                  setNodeProp(selectedNode.id, 'style.objectFit', next, true);
	                  if (next === 'contain' || next === 'cover' || next === 'fill') {
	                    applyMetadata({ fitMode: next, fit: next }, true);
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
      resizeNode(section.id, intent.size, true);
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
    [showDropFeedback, resizeNode]
  );

  const commitPropertyChanges = () => {
    if (!selectedNodeId) return;
    const liveNodes = useInvoiceDesignerStore.getState().nodes;
    const liveSelectedNode = liveNodes.find((node) => node.id === selectedNodeId) ?? null;
    const liveParentNode =
      liveSelectedNode?.parentId ? liveNodes.find((node) => node.id === liveSelectedNode.parentId) ?? null : null;

    // Avoid creating a separate history entry just for position; the resize commit will snapshot both.
    setNodeProp(selectedNodeId, 'position.x', propertyDraft.x, false);
    setNodeProp(selectedNodeId, 'position.y', propertyDraft.y, false);
    resizeNode(selectedNodeId, { width: propertyDraft.width, height: propertyDraft.height }, true);

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
            {getNodeName(selectedNode)} <span className="text-slate-500">({selectedNode.type})</span>
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
	            onResize={resizeNode}
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
	                  value={getNodeName(selectedNode)}
	                  onChange={(event) => setNodeProp(selectedNode.id, 'name', event.target.value, false)}
	                  onBlur={(event) => setNodeProp(selectedNode.id, 'name', event.target.value, true)}
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
	                      onClick={() => unsetNodeProp(selectedNode.id, 'layoutPresetId', true)}
	                    >
	                      Clear
	                    </button>
	                  </div>
	                  <div className="text-slate-500 text-[11px]">{selectedPreset.label}</div>
	                  <p className="text-[11px] text-slate-500">{selectedPreset.description}</p>
	                </div>
		              )}
                  <DesignerSchemaInspector node={selectedNode} nodesById={nodesById} />
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
	                : (() => {
                      const draggedNode = nodes.find((node) => node.id === activeDrag.nodeId);
                      return draggedNode ? getNodeName(draggedNode) : 'Component';
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
  const breadcrumbs = React.useMemo(() => {
    return computeBreadcrumbNodes(nodes, selectedNodeId);
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

const createLocalId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
