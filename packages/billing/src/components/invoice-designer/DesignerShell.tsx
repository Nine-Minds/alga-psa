import React, { useCallback, useMemo, useRef, useState } from 'react';
import type { Modifier } from '@dnd-kit/core';
import {
  DndContext,
  DragEndEvent,
  DragMoveEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDndMonitor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import clsx from 'clsx';
import { restrictToWindowEdges, createSnapModifier } from '@dnd-kit/modifiers';
import { ComponentPalette } from './palette/ComponentPalette';
import { DesignCanvas } from './canvas/DesignCanvas';
import { DesignerToolbar } from './toolbar/DesignerToolbar';
import type { DesignerComponentType, DesignerConstraint, DesignerNode, Point, Size } from './state/designerStore';
import { getAbsolutePosition, useInvoiceDesignerStore } from './state/designerStore';
import { AlignmentGuide, calculateGuides, clampPositionToParent } from './utils/layout';
import { getDefinition } from './constants/componentCatalog';
import { getPresetById } from './constants/presets';
import {
  findNearestSectionAncestor,
  planSelectedPathInsertion,
  planForceSelectedInsertion,
  resolvePreferredParentFromSelection,
  resolveSectionParentForInsertion,
} from './utils/dropParentResolution';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { useDesignerShortcuts } from './hooks/useDesignerShortcuts';
import { canNestWithinParent, getAllowedParentsForType } from './state/hierarchy';
import { supportsAspectRatioLock } from './utils/aspectRatio';

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
  nodeId: string;
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

type InsertBlockCallout = {
  sectionId: string;
  message: string;
  nextAction: string;
};

type ComponentDropResolution =
  | { ok: true; parentId: string; notice?: string; reflowAdjustments?: Array<{ nodeId: string; width: number }> }
  | { ok: false; message: string; reason?: 'selected-section-no-room'; sectionId?: string; nextAction?: string };

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
  'nodeId' in value &&
  typeof (value as { nodeId?: unknown }).nodeId === 'string';

const createRestrictToParentBoundsModifier = (nodes: DesignerNode[]): Modifier => ({ active, transform }) => {
  if (!active || !transform) {
    return transform;
  }
  const data = active.data?.current;
  if (!isNodeDragData(data)) {
    return transform;
  }
  const node = nodes.find((candidate) => candidate.id === data.nodeId);
  if (!node) {
    return transform;
  }
  const boundedPosition = clampPositionToParent(node, nodes, {
    x: node.position.x + transform.x,
    y: node.position.y + transform.y,
  });
  return {
    ...transform,
    x: boundedPosition.x - node.position.x,
    y: boundedPosition.y - node.position.y,
  };
};

const buildDescendantPositionMap = (rootId: string, allNodes: DesignerNode[]) => {
  const positions = new Map<string, Point>();
  const nodesById = new Map(allNodes.map((node) => [node.id, node]));
  const walk = (id: string) => {
    const node = nodesById.get(id);
    if (!node) return;
    positions.set(id, { ...node.position });
    node.childIds.forEach((childId) => walk(childId));
  };
  walk(rootId);
  return positions;
};

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

  const padding = section.layout?.mode === 'flex' ? Math.max(0, section.layout.padding ?? 0) : 0;
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
  const sectionId = findNearestSectionAncestor(nodeId, nodesById);
  if (!sectionId) {
    return null;
  }
  const sectionNode = nodesById.get(sectionId);
  return sectionNode?.type === 'section' ? sectionNode : null;
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
  const constraints = useInvoiceDesignerStore((state) => state.constraints);
  const selectedNodeId = useInvoiceDesignerStore((state) => state.selectedNodeId);
  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId) ?? null, [nodes, selectedNodeId]);
  const addNode = useInvoiceDesignerStore((state) => state.addNodeFromPalette);
  const insertPreset = useInvoiceDesignerStore((state) => state.insertPreset);
  const setNodePosition = useInvoiceDesignerStore((state) => state.setNodePosition);
  const updateNodeSize = useInvoiceDesignerStore((state) => state.updateNodeSize);
  const selectNode = useInvoiceDesignerStore((state) => state.selectNode);
  const updateNodeName = useInvoiceDesignerStore((state) => state.updateNodeName);
  const updateNodeMetadata = useInvoiceDesignerStore((state) => state.updateNodeMetadata);
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
  const toggleAspectRatioLock = useInvoiceDesignerStore((state) => state.toggleAspectRatioLock);
  const constraintError = useInvoiceDesignerStore((state) => state.constraintError);
  const aspectConstraint = selectedNodeId
    ? constraints.find(
        (constraint): constraint is Extract<DesignerConstraint, { type: 'aspect-ratio' }> =>
          constraint.type === 'aspect-ratio' && constraint.id === `aspect-${selectedNodeId}`
      )
    : undefined;
  const clearLayoutPreset = useInvoiceDesignerStore((state) => state.clearLayoutPreset);
  const setLayoutMode = useInvoiceDesignerStore((state) => state.setLayoutMode);
  const selectedPreset = selectedNode?.layoutPresetId ? getPresetById(selectedNode.layoutPresetId) : null;
  const canLockAspectRatio = selectedNode ? supportsAspectRatioLock(selectedNode.type) : false;
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

  const [activeDrag, setActiveDrag] = useState<ActiveDragState>(null);
  const [guides, setGuides] = useState<AlignmentGuide[]>([]);
  const [previewPositions, setPreviewPositions] = useState<Record<string, Point>>({});
  const [dropFeedback, setDropFeedback] = useState<DropFeedback | null>(null);
  const [insertBlockCallout, setInsertBlockCallout] = useState<InsertBlockCallout | null>(null);
  const [forcedDropTarget, setForcedDropTarget] = useState<string | 'canvas' | null>(null);
  const blockedSectionName = useMemo(() => {
    if (!insertBlockCallout) {
      return null;
    }
    return nodes.find((node) => node.id === insertBlockCallout.sectionId)?.name ?? null;
  }, [insertBlockCallout, nodes]);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const dropFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Fail-safe: Clear guides when no drag is active
  React.useEffect(() => {
    if (!activeDrag && guides.length > 0) {
      setGuides([]);
    }
  }, [activeDrag, guides.length]);

  const dragSessionRef = useRef<{
    nodeId: string;
    origin: Point;
    originalPositions: Map<string, Point>;
    lastDelta: Point;
  } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor)
  );

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

  const clearInsertBlockCallout = useCallback(() => {
    setInsertBlockCallout(null);
  }, []);

  const showInsertBlockCallout = useCallback((callout: InsertBlockCallout) => {
    setInsertBlockCallout(callout);
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

  React.useEffect(() => {
    if (!insertBlockCallout) {
      return;
    }
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const selectedSectionId = findNearestSectionAncestor(selectedNodeId, nodesById);
    if (!selectedSectionId || selectedSectionId !== insertBlockCallout.sectionId) {
      setInsertBlockCallout(null);
    }
  }, [insertBlockCallout, nodes, selectedNodeId]);

  const snapModifier = useMemo<Modifier | null>(() => {
    if (!snapToGrid) {
      return null;
    }
    const pixelGrid = Math.max(1, gridSize * canvasScale);
    return createSnapModifier(pixelGrid);
  }, [snapToGrid, gridSize, canvasScale]);

  const restrictToParentBoundsModifier = useMemo<Modifier>(
    () => createRestrictToParentBoundsModifier(nodes),
    [nodes]
  );

  const modifiers = useMemo<Modifier[]>(() => {
    const base: Modifier[] = [restrictToParentBoundsModifier, restrictToWindowEdges];
    return snapModifier ? [...base, snapModifier] : base;
  }, [restrictToParentBoundsModifier, snapModifier]);

  const renderedNodes = useMemo(() => {
    if (!previewPositions || Object.keys(previewPositions).length === 0) {
      return nodes;
    }
    return nodes.map((node) => {
      const override = previewPositions[node.id];
      return override ? { ...node, position: override } : node;
    });
  }, [nodes, previewPositions]);

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
      dropPoint: Point,
      options: { strictSelectionPath?: boolean; selectedNodeIdOverride?: string | null } = {}
    ): ComponentDropResolution => {
      const state = useInvoiceDesignerStore.getState();
      const nodesForDrop = state.nodes;
      const nodesById = new Map(nodesForDrop.map((node) => [node.id, node]));
      const dropNode = dropMeta?.nodeId ? nodesById.get(dropMeta.nodeId) : undefined;
      const allowedParents = getAllowedParentsForType(componentType);
      const componentDefinition = getDefinition(componentType);
      const liveSelectedNodeId = options.selectedNodeIdOverride ?? state.selectedNodeId;
      const selectedSectionId = findNearestSectionAncestor(liveSelectedNodeId, nodesById);

      if (dropNode && canNestWithinParent(componentType, dropNode.type)) {
        return { ok: true, parentId: dropNode.id };
      }

      let ancestor = dropNode;
      while (ancestor?.parentId) {
        const parent = nodesById.get(ancestor.parentId);
        if (!parent) {
          break;
        }
        if (canNestWithinParent(componentType, parent.type)) {
          return { ok: true, parentId: parent.id };
        }
        ancestor = parent;
      }

      const pageNode = resolvePageForDrop(nodesForDrop, dropNode?.id ?? selectedSectionId ?? undefined);
      if (componentType === 'section') {
        if (pageNode && canNestWithinParent('section', pageNode.type)) {
          return { ok: true, parentId: pageNode.id };
        }
        return { ok: false, message: 'Unable to place section here.' };
      }

      if (!dropNode && pageNode) {
        if (options.strictSelectionPath) {
          const selectedPathPlan = planSelectedPathInsertion({
            selectedNodeId: liveSelectedNodeId,
            nodesById,
            componentType,
            desiredSize: componentDefinition?.defaultSize,
          });
          if (!selectedPathPlan) {
            return {
              ok: false,
              message: 'Select a parent in OUTLINE before using quick insert.',
            };
          }
          if (!selectedPathPlan.ok) {
            return {
              ok: false,
              message: selectedPathPlan.message,
              reason: 'selected-section-no-room',
              sectionId: selectedPathPlan.sectionId,
              nextAction: selectedPathPlan.nextAction,
            };
          }
          return {
            ok: true,
            parentId: selectedPathPlan.parentId,
            reflowAdjustments: selectedPathPlan.reflowAdjustments,
            notice:
              selectedPathPlan.reflowAdjustments.length > 0
                ? 'Inserted in selected parent with local reflow.'
                : undefined,
          };
        }

        const forcePlan = planForceSelectedInsertion({
          selectedNodeId: liveSelectedNodeId,
          pageNode,
          nodesById,
          componentType,
          desiredSize: componentDefinition?.defaultSize,
        });
        if (forcePlan) {
          if (!forcePlan.ok) {
            return {
              ok: false,
              message: forcePlan.message,
              reason: 'selected-section-no-room',
              sectionId: forcePlan.sectionId,
              nextAction: forcePlan.nextAction,
            };
          }
          return {
            ok: true,
            parentId: forcePlan.parentId,
            reflowAdjustments: forcePlan.reflowAdjustments,
            notice:
              forcePlan.reflowAdjustments.length > 0
                ? 'Inserted in selected section with local reflow.'
                : undefined,
          };
        }

        const preferredParent = resolvePreferredParentFromSelection({
          selectedNodeId: liveSelectedNodeId,
          pageNode,
          nodesById,
          componentType,
          desiredSize: componentDefinition?.defaultSize,
        });
        if (preferredParent) {
          return { ok: true, parentId: preferredParent.id };
        }
      }

      if (allowedParents.includes('section') && pageNode) {
        const existingSection = resolveSectionParentForInsertion({
          pageNode,
          nodesById,
          componentType,
          desiredSize: componentDefinition?.defaultSize,
          preferredSectionId: selectedSectionId,
        });
        if (existingSection) {
          return { ok: true, parentId: existingSection.id };
        }

        const existingNodeIds = new Set(nodesForDrop.map((node) => node.id));
        const sectionDefinition = getDefinition('section');
        addNode(
          'section',
          dropPoint,
          sectionDefinition
            ? {
                parentId: pageNode.id,
                defaults: {
                  size: sectionDefinition.defaultSize,
                  layout: {
                    mode: 'flex',
                    direction: 'column',
                    gap: 12,
                    padding: 12,
                    justify: 'start',
                    align: 'stretch',
                    sizing: 'fixed',
                  },
                },
              }
            : { parentId: pageNode.id }
        );

        const nodesAfterScaffold = useInvoiceDesignerStore.getState().nodes;
        const createdSection = nodesAfterScaffold.find(
          (node) => node.type === 'section' && node.parentId === pageNode.id && !existingNodeIds.has(node.id)
        );
        if (createdSection) {
          return { ok: true, parentId: createdSection.id, notice: 'Added a section scaffold for this drop.' };
        }

        const fallbackNodesById = new Map(nodesAfterScaffold.map((node) => [node.id, node]));
        const nextPageNode = fallbackNodesById.get(pageNode.id) ?? pageNode;
        const fallbackSection = resolveSectionParentForInsertion({
          pageNode: nextPageNode,
          nodesById: fallbackNodesById,
          componentType,
          desiredSize: componentDefinition?.defaultSize,
          preferredSectionId: selectedSectionId,
        });
        if (fallbackSection) {
          return { ok: true, parentId: fallbackSection.id };
        }
      }

      return { ok: false, message: 'Drop target is not compatible for this component.' };
    },
    [addNode, resolvePageForDrop]
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
        if (resolution.reason === 'selected-section-no-room' && resolution.sectionId) {
          showInsertBlockCallout({
            sectionId: resolution.sectionId,
            message: resolution.message,
            nextAction: resolution.nextAction ?? 'Resize the selected section or choose another section.',
          });
        }
        return false;
      }

      clearInsertBlockCallout();

      if (resolution.reflowAdjustments && resolution.reflowAdjustments.length > 0) {
        const nodesById = new Map(useInvoiceDesignerStore.getState().nodes.map((node) => [node.id, node]));
        resolution.reflowAdjustments.forEach((adjustment) => {
          const node = nodesById.get(adjustment.nodeId);
          if (!node) {
            return;
          }
          const minimum = getPracticalMinimumSizeForType(node.type);
          updateNodeSize(
            adjustment.nodeId,
            {
              width: Math.max(minimum.width, adjustment.width),
              height: Math.max(minimum.height, node.size.height),
            },
            false
          );
        });
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
      if (resolution.notice) {
        showDropFeedback('info', resolution.notice);
      }
      return true;
    },
    [
      addNode,
      clearInsertBlockCallout,
      getDefaultInsertionPoint,
      recordDropResult,
      resolveComponentDropParent,
      selectNode,
      showDropFeedback,
      showInsertBlockCallout,
      updateNodeSize,
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

      clearInsertBlockCallout();

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
      clearInsertBlockCallout,
      getDefaultInsertionPoint,
      insertPreset,
      recordDropResult,
      resolvePageForDrop,
      selectedNodeId,
      showDropFeedback,
    ]
  );

  const cleanupDragState = useCallback(() => {
    dragSessionRef.current = null;
    setPreviewPositions({});
    setGuides([]);
    setActiveDrag(null);
    updatePointerLocation(null);
  }, [updatePointerLocation]);

  const renderLayoutInspector = () => {
    if (!selectedNode) return null;
    
    // Show layout controls for containers (sections, columns, pages)
    const isContainer = ['section', 'column', 'page', 'container'].includes(selectedNode.type);
    // Also show sizing controls for children of flex containers
    const parent = nodes.find(n => n.id === selectedNode.parentId);
    const isFlexChild = parent?.layout?.mode === 'flex';

    if (!isContainer && !isFlexChild) return null;

    const layout = selectedNode.layout ?? {
      mode: 'canvas',
      direction: 'column',
      gap: 0,
      padding: 0,
      justify: 'start',
      align: 'start',
      sizing: 'fixed'
    };

    return (
      <div className="rounded border border-slate-200 bg-white px-3 py-2 space-y-3">
        <p className="text-xs font-semibold text-slate-700">Layout</p>
        
        {isContainer && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Mode</span>
              <div className="flex bg-slate-100 rounded p-0.5">
                <button
                  className={`px-2 py-0.5 text-[10px] rounded ${layout.mode === 'canvas' ? 'bg-white shadow text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
                  onClick={() => setLayoutMode(selectedNode.id, 'canvas')}
                >
                  Canvas
                </button>
                <button
                  className={`px-2 py-0.5 text-[10px] rounded ${layout.mode === 'flex' ? 'bg-white shadow text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
                  onClick={() => setLayoutMode(selectedNode.id, 'flex')}
                >
                  Stack
                </button>
              </div>
            </div>

            {layout.mode === 'flex' && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">Direction</label>
                    <select
                      className="w-full border border-slate-300 rounded px-1 py-1 text-xs"
                      value={layout.direction}
                      onChange={(e) => setLayoutMode(selectedNode.id, 'flex', { direction: e.target.value as 'row' | 'column' })}
                    >
                      <option value="column">Vertical ↓</option>
                      <option value="row">Horizontal →</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">Gap (px)</label>
                    <input
                      type="number"
                      className="w-full border border-slate-300 rounded px-1 py-1 text-xs"
                      value={layout.gap}
                      onChange={(e) => setLayoutMode(selectedNode.id, 'flex', { gap: Number(e.target.value) })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">Padding</label>
                    <input
                      type="number"
                      className="w-full border border-slate-300 rounded px-1 py-1 text-xs"
                      value={layout.padding}
                      onChange={(e) => setLayoutMode(selectedNode.id, 'flex', { padding: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">Align Items</label>
                    <select
                      className="w-full border border-slate-300 rounded px-1 py-1 text-xs"
                      value={layout.align}
                      onChange={(e) => setLayoutMode(selectedNode.id, 'flex', { align: e.target.value as any })}
                    >
                      <option value="start">Start</option>
                      <option value="center">Center</option>
                      <option value="end">End</option>
                      <option value="stretch">Stretch</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">Justify Content</label>
                    <select
                      className="w-full border border-slate-300 rounded px-1 py-1 text-xs"
                      value={layout.justify}
                      onChange={(e) => setLayoutMode(selectedNode.id, 'flex', { justify: e.target.value as any })}
                    >
                      <option value="start">Start</option>
                      <option value="center">Center</option>
                      <option value="end">End</option>
                      <option value="space-between">Space Between</option>
                    </select>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        <div className="pt-2 border-t border-slate-100">
          <label className="text-[10px] text-slate-500 block mb-1">Sizing</label>
          <div className="flex gap-1">
            {(['fixed', 'hug', 'fill'] as const).map((mode) => (
              <button
                key={mode}
                className={`flex-1 py-1 text-[10px] border rounded ${
                  layout.sizing === mode
                    ? 'bg-blue-50 border-blue-200 text-blue-700 font-medium'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
                onClick={() => setLayoutMode(selectedNode.id, layout.mode ?? 'canvas', { sizing: mode })}
                title={
                  mode === 'fixed' ? 'Fixed dimensions' :
                  mode === 'hug' ? 'Hug contents' :
                  'Fill available space'
                }
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
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
            <label className="text-xs text-slate-500 block mb-1">Fit mode</label>
            <select
              className="w-full border border-slate-300 rounded-md px-2 py-1 text-sm"
              value={fitMode}
              onChange={(event) => applyMetadata({ fitMode: event.target.value, fit: event.target.value })}
            >
              <option value="contain">Contain</option>
              <option value="cover">Cover</option>
              <option value="fill">Fill</option>
            </select>
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
      const node = nodes.find((candidate) => candidate.id === data.nodeId);
      if (node) {
        dragSessionRef.current = {
          nodeId: data.nodeId,
          origin: { ...node.position },
          originalPositions: buildDescendantPositionMap(data.nodeId, nodes),
          lastDelta: { x: 0, y: 0 },
        };
      }
    }
  };

  const handleDragMove = (event: DragMoveEvent) => {
    if (!dragSessionRef.current || activeDrag?.kind !== 'node') {
      return;
    }
    const session = dragSessionRef.current;
    const { nodeId, origin } = session;
    const nextPosition = {
      x: origin.x + event.delta.x,
      y: origin.y + event.delta.y,
    };
    const activeNode = nodes.find((node) => node.id === nodeId);
    if (!activeNode) return;
    const boundedPosition = clampPositionToParent(activeNode, nodes, nextPosition);
    const delta = {
      x: boundedPosition.x - origin.x,
      y: boundedPosition.y - origin.y,
    };
    if (delta.x !== session.lastDelta.x || delta.y !== session.lastDelta.y) {
      const nextPreview: Record<string, Point> = {};
      session.originalPositions.forEach((point, id) => {
        nextPreview[id] = {
          x: point.x + delta.x,
          y: point.y + delta.y,
        };
      });
      setPreviewPositions(nextPreview);
      session.lastDelta = delta;
    }
    if (showGuides) {
      const projectedPosition = {
        x: origin.x + session.lastDelta.x,
        y: origin.y + session.lastDelta.y,
      };
      const ghostNode = {
        ...activeNode,
        position: projectedPosition,
      };
      const guideNodes = nodes.map((node) => {
        if (session.originalPositions.has(node.id)) {
          const original = session.originalPositions.get(node.id) ?? node.position;
          return {
            ...node,
            position: {
              x: original.x + session.lastDelta.x,
              y: original.y + session.lastDelta.y,
            },
          };
        }
        return node;
      });
      setGuides(calculateGuides(ghostNode, guideNodes));
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
      if (activeDrag?.kind === 'node' && dragSessionRef.current) {
        const session = dragSessionRef.current;
        const activeNode = nodes.find((node) => node.id === session.nodeId);
        if (activeNode) {
          const desiredPosition = {
            x: session.origin.x + session.lastDelta.x,
            y: session.origin.y + session.lastDelta.y,
          };
          const boundedPosition = clampPositionToParent(activeNode, nodes, desiredPosition);
          setNodePosition(session.nodeId, boundedPosition, true);
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
      const autoSwitchFillToFixed = options?.autoSwitchFillToFixed ?? true;
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

      let switchedFromFill = false;
      if (autoSwitchFillToFixed && section.layout?.mode === 'flex' && section.layout.sizing === 'fill') {
        setLayoutMode(section.id, 'flex', { sizing: 'fixed' });
        switchedFromFill = true;
        state = useInvoiceDesignerStore.getState();
        nodesById = new Map(state.nodes.map((node) => [node.id, node]));
        const refreshed = nodesById.get(section.id);
        if (refreshed && refreshed.type === 'section') {
          section = refreshed;
        }
      }

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
    [setLayoutMode, showDropFeedback, updateNodeSize]
  );

  const commitPropertyChanges = () => {
    if (!selectedNodeId) return;
    const liveNodes = useInvoiceDesignerStore.getState().nodes;
    const liveSelectedNode = liveNodes.find((node) => node.id === selectedNodeId) ?? null;
    const liveParentNode =
      liveSelectedNode?.parentId ? liveNodes.find((node) => node.id === liveSelectedNode.parentId) ?? null : null;

    if (
      shouldPromoteParentToCanvasForManualPosition(liveSelectedNode, liveParentNode, {
        x: propertyDraft.x,
        y: propertyDraft.y,
      }) &&
      liveParentNode
    ) {
      setLayoutMode(liveParentNode.id, 'canvas');
    }

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
      if (aspectConstraint) {
        showDropFeedback('info', 'Size constrained by aspect ratio lock. Disable "Lock aspect ratio" to resize freely.');
      } else {
        showDropFeedback('info', 'Size constrained to valid bounds.');
      }
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
      {insertBlockCallout && (
        <div
          className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800"
          data-automation-id="designer-insert-blocked-callout"
        >
          <span className="font-semibold">
            {blockedSectionName ? `${blockedSectionName}: ` : ''}
            {insertBlockCallout.message}
          </span>{' '}
          <span className="text-amber-700/90">{insertBlockCallout.nextAction}</span>
        </div>
      )}
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
      <DndContext sensors={sensors} modifiers={modifiers}>
        <div className="flex flex-1 min-h-[560px] bg-white">
          <div className="w-72">
            <ComponentPalette
              onInsertComponent={handleQuickInsertComponent}
              onInsertPreset={handleQuickInsertPreset}
            />
          </div>
          <DesignerWorkspace
            nodes={renderedNodes}
            selectedNodeId={selectedNodeId}
            showGuides={showGuides}
            showRulers={showRulers}
            gridSize={gridSize}
            canvasScale={canvasScale}
            snapToGrid={snapToGrid}
            guides={guides}
            isDragActive={Boolean(activeDrag)}
            forcedDropTarget={forcedDropTarget}
            activeDrag={activeDrag}
            modifiers={modifiers}
            onPointerLocationChange={updatePointerLocation}
            onNodeSelect={selectNode}
            onResize={updateNodeSize}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          />
          <aside className="w-72 border-l border-slate-200 bg-slate-50 p-4 space-y-4">
            <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wide">Inspector</h3>
          {selectedNode ? (
            <div className="space-y-3">
              {constraintError && (
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {constraintError}
                </div>
              )}
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
              {(canLockAspectRatio || aspectConstraint) && (
                <div className="pt-2 border-t border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">Lock aspect ratio</span>
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300"
                      checked={Boolean(aspectConstraint)}
                      onChange={() => toggleAspectRatioLock(selectedNode.id)}
                    />
                  </div>
                  {aspectConstraint && (
                    <p className="text-[11px] text-slate-500">
                      Preserves width/height ratio ≈ {aspectConstraint.ratio.toFixed(2)}
                    </p>
                  )}
                  {!canLockAspectRatio && aspectConstraint && (
                    <p className="text-[11px] text-amber-700">
                      This node type is best resized freely. Turn this off if dimensions keep snapping.
                    </p>
                  )}
                </div>
              )}
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
  showGuides: boolean;
  showRulers: boolean;
  gridSize: number;
  canvasScale: number;
  snapToGrid: boolean;
  guides: AlignmentGuide[];
  isDragActive: boolean;
  forcedDropTarget: string | 'canvas' | null;
  activeDrag: ActiveDragState;
  modifiers: Modifier[];
  onPointerLocationChange: (point: { x: number; y: number } | null) => void;
  onNodeSelect: (nodeId: string | null) => void;
  onResize: (nodeId: string, size: { width: number; height: number }, commit?: boolean) => void;
  onDragStart: (event: DragStartEvent) => void;
  onDragMove: (event: DragMoveEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onDragCancel: () => void;
};

const DesignerWorkspace: React.FC<DesignerWorkspaceProps> = ({
  nodes,
  selectedNodeId,
  showGuides,
  showRulers,
  gridSize,
  canvasScale,
  snapToGrid,
  guides,
  isDragActive,
  forcedDropTarget,
  activeDrag,
  modifiers,
  onPointerLocationChange,
  onNodeSelect,
  onResize,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
}) => {
  useDndMonitor({
    onDragStart,
    onDragMove,
    onDragEnd,
    onDragCancel,
  });

  return (
    <div className="flex-1 flex">
      <DesignCanvas
        nodes={nodes}
        selectedNodeId={selectedNodeId}
        showGuides={showGuides}
        showRulers={showRulers}
        gridSize={gridSize}
        canvasScale={canvasScale}
        snapToGrid={snapToGrid}
        guides={guides}
        isDragActive={isDragActive}
        forcedDropTarget={forcedDropTarget}
        droppableId={DROPPABLE_CANVAS_ID}
        onPointerLocationChange={onPointerLocationChange}
        onNodeSelect={onNodeSelect}
        onResize={onResize}
      />
      <DragOverlay modifiers={modifiers}>
        {activeDrag && (
          <div className="px-3 py-2 bg-white border rounded shadow-lg text-sm font-semibold">
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
