import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

import { solveConstraints } from '../utils/constraintSolver';
import { getDefinition } from '../constants/componentCatalog';
import { LAYOUT_PRESETS, getPresetById, LayoutPresetConstraintDefinition } from '../constants/presets';
import { DESIGNER_CANVAS_BOUNDS } from '../constants/layout';
import { clampPositionToParent } from '../utils/layout';
import { canNestWithinParent, getAllowedChildrenForType, getAllowedParentsForType } from './hierarchy';

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

export interface DesignerNode {
  id: string;
  type: DesignerComponentType;
  name: string;
  position: Point;
  size: Size;
  canRotate?: boolean;
  rotation?: number;
  allowResize?: boolean;
  metadata?: Record<string, unknown>;
  layoutPresetId?: string;
  parentId: string | null;
  childIds: string[];
  allowedChildren: DesignerComponentType[];
  layout?: {
    mode: 'canvas' | 'flex';
    direction: 'row' | 'column';
    gap: number;
    padding: number;
    justify: 'start' | 'center' | 'end' | 'space-between';
    align: 'start' | 'center' | 'end' | 'stretch';
    sizing: 'fixed' | 'hug' | 'fill';
  };
}

export type ConstraintStrength = 'required' | 'strong' | 'medium' | 'weak';

export type DesignerConstraint =
  | {
      id: string;
      type: 'align-left' | 'align-top' | 'match-width' | 'match-height';
      nodes: [string, string];
      strength?: ConstraintStrength;
    }
  | {
      id: string;
      type: 'aspect-ratio';
      nodeId: string;
      ratio: number;
      strength?: ConstraintStrength;
    };

interface DesignerMetrics {
  totalDrags: number;
  completedDrops: number;
  failedDrops: number;
  totalSelections: number;
}

interface DesignerState {
  nodes: DesignerNode[];
  constraints: DesignerConstraint[];
  selectedNodeId: string | null;
  hoverNodeId: string | null;
  snapToGrid: boolean;
  gridSize: number;
  showGuides: boolean;
  showRulers: boolean;
  canvasScale: number;
  metrics: DesignerMetrics;
  history: DesignerNode[][];
  historyIndex: number;
  constraintError: string | null;
  addNodeFromPalette: (
    type: DesignerComponentType,
    dropPoint: Point,
    options?: { defaults?: Partial<DesignerNode>; parentId?: string }
  ) => void;
  insertPreset: (presetId: string, dropPoint?: Point, parentId?: string) => void;
  moveNode: (id: string, delta: Point, commit?: boolean) => void;
  setNodePosition: (id: string, position: Point, commit?: boolean) => void;
  updateNodeSize: (id: string, size: Size, commit?: boolean) => void;
  updateNodeName: (id: string, name: string) => void;
  updateNodeMetadata: (id: string, metadata: Record<string, unknown>) => void;
  selectNode: (id: string | null) => void;
  setHoverNode: (id: string | null) => void;
  deleteSelectedNode: () => void;
  addConstraint: (constraint: DesignerConstraint) => void;
  removeConstraint: (constraintId: string) => void;
  toggleAspectRatioLock: (nodeId: string) => void;
  clearLayoutPreset: (nodeId: string) => void;
  toggleSnap: () => void;
  setGridSize: (size: number) => void;
  setCanvasScale: (scale: number) => void;
  toggleGuides: () => void;
  toggleRulers: () => void;
  undo: () => void;
  redo: () => void;
  resetWorkspace: () => void;
  loadNodes: (nodes: DesignerNode[]) => void;
  recordDropResult: (success: boolean) => void;
  setLayoutMode: (nodeId: string, mode: 'canvas' | 'flex', options?: Partial<DesignerNode['layout']>) => void;
}

const MAX_HISTORY_LENGTH = 50;
const DEFAULT_SIZE: Size = { width: 160, height: 64 };
export const DOCUMENT_NODE_ID = 'designer-document-root';
const DEFAULT_PAGE_NODE_ID = 'designer-page-default';
const generateId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
const snapToGridValue = (value: number, gridSize: number) => Math.round(value / gridSize) * gridSize;

const createDocumentNode = (): DesignerNode => ({
  id: DOCUMENT_NODE_ID,
  type: 'document',
  name: 'Document',
  position: { x: 0, y: 0 },
  size: { width: DESIGNER_CANVAS_BOUNDS.width, height: DESIGNER_CANVAS_BOUNDS.height },
  canRotate: false,
  allowResize: false,
  rotation: 0,
  metadata: {},
  layoutPresetId: undefined,
  parentId: null,
  childIds: [],
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
});

const createPageNode = (parentId: string, index = 1): DesignerNode => ({
  id: `${DEFAULT_PAGE_NODE_ID}-${index}-${generateId()}`,
  type: 'page',
  name: `Page ${index}`,
  position: { x: 0, y: 0 },
  size: { width: DESIGNER_CANVAS_BOUNDS.width, height: DESIGNER_CANVAS_BOUNDS.height },
  canRotate: false,
  allowResize: false,
  rotation: 0,
  metadata: {},
  layoutPresetId: undefined,
  parentId,
  childIds: [],
  allowedChildren: getAllowedChildrenForType('page'),
  layout: {
    mode: 'flex',
    direction: 'column',
    gap: 32,
    padding: 40, // Page margins
    justify: 'start',
    align: 'stretch',
    sizing: 'hug',
  },
});

const createInitialNodes = (): DesignerNode[] => {
  const documentNode = createDocumentNode();
  const pageNode = createPageNode(documentNode.id);
  documentNode.childIds = [pageNode.id];
  return [documentNode, pageNode];
};

const attachChild = (nodes: DesignerNode[], parentId: string, childId: string) =>
  nodes.map((node) => {
    if (node.id !== parentId) return node;
    if (node.childIds.includes(childId)) {
      return node;
    }
    return { ...node, childIds: [...node.childIds, childId] };
  });

const detachChild = (nodes: DesignerNode[], parentId: string | null, childId: string) =>
  parentId
    ? nodes.map((node) =>
        node.id === parentId ? { ...node, childIds: node.childIds.filter((id) => id !== childId) } : node
      )
    : nodes;

const collectDescendants = (nodes: DesignerNode[], rootId: string): Set<string> => {
  const map = new Map(nodes.map((node) => [node.id, node]));
  const toRemove = new Set<string>();
  const dfs = (id: string) => {
    toRemove.add(id);
    const node = map.get(id);
    node?.childIds.forEach(dfs);
  };
  dfs(rootId);
  return toRemove;
};

const snapshotNodes = (nodes: DesignerNode[]): DesignerNode[] =>
  nodes.map((node) => ({
    ...node,
    position: { ...node.position },
    size: { ...node.size },
    childIds: [...node.childIds],
    allowedChildren: [...node.allowedChildren],
    layout: node.layout ? { ...node.layout } : undefined,
  }));

const resolveWithConstraints = (nodes: DesignerNode[], constraints: DesignerConstraint[]) => {
  try {
    return {
      nodes: solveConstraints(nodes, constraints),
      constraintError: null as string | null,
    };
  } catch (error) {
    console.warn('[Designer] constraint solver conflict', error);
    return {
      nodes,
      constraintError:
        error instanceof Error ? error.message : 'Constraint conflict detected. Try relaxing or removing constraints.',
    };
  }
};

// --- Auto-Layout Engine ---

const computeLayout = (nodes: DesignerNode[]): DesignerNode[] => {
  const nodeMap = new Map(nodes.map((n) => [n.id, { ...n }]));

  // Top-down pass (recursively layout children)
  const layoutNode = (nodeId: string) => {
    const node = nodeMap.get(nodeId);
    if (!node) return;

    // 1. Sizing Pass (if 'hug', calculate size based on content/children)
    // For simplicity in this iteration, we assume 'hug' relies on children's aggregated size.
    // In a real engine, this requires a bottom-up measurement pass first.
    // We'll stick to a simpler model: Parents dictate available space, Children fill/hug.

    if (node.layout?.mode === 'flex' && node.childIds.length > 0) {
      const {
        direction = 'column',
        gap = 0,
        padding = 0,
        align = 'stretch',
      } = node.layout;

      let currentX = padding;
      let currentY = padding;
      let maxCrossSize = 0; // Track max width (col) or height (row) for container sizing

      // We need to operate on fresh copies of children from the map
      const children = node.childIds.map((id) => nodeMap.get(id)).filter((n): n is DesignerNode => !!n);

      children.forEach((child) => {
        // Apply Sizing Logic
        const childLayout = child.layout ?? { sizing: 'fixed' }; // Default if missing
        let newWidth = child.size.width;
        let newHeight = child.size.height;

        if (direction === 'column') {
          // Cross axis: Width
          if (childLayout.sizing === 'fill' || align === 'stretch') {
            newWidth = Math.max(0, node.size.width - padding * 2);
          }
          // Main axis: Height (Fixed for now, unless we implement true 'hug' content measuring)
        } else {
          // Row
          // Cross axis: Height
          if (childLayout.sizing === 'fill' || align === 'stretch') {
            newHeight = Math.max(0, node.size.height - padding * 2);
          }
        }
        
        // Update child size in map
        child.size = { width: newWidth, height: newHeight };

        // Recursively layout this child first (if it's also a container)
        // This allows nested stack calculations to propagate
        layoutNode(child.id);

        // Update position relative to parent
        child.position = {
          x: node.position.x + currentX,
          y: node.position.y + currentY,
        };
        
        // Advance cursor
        if (direction === 'column') {
          currentY += child.size.height + gap;
          maxCrossSize = Math.max(maxCrossSize, child.size.width);
        } else {
          currentX += child.size.width + gap;
          maxCrossSize = Math.max(maxCrossSize, child.size.height);
        }
      });

      // Parent 'Hug' Logic: Resize parent to fit children
      if (node.layout.sizing === 'hug') {
        if (direction === 'column') {
          node.size.height = currentY + padding - gap; 
        } else {
          node.size.width = currentX + padding - gap;
        }
        // If parent resized, we might need to re-layout siblings? 
        // For this simple single-pass, we assume 'hug' parents are laid out *before* their parents read their size.
        // But we are traversing Top-Down.
        // Limitation: Top-Down is good for 'fill', Bad for 'hug'.
        // Correct approach: Bottom-Up Measure -> Top-Down Arrange.
        // Let's add a simple Bottom-Up size adjustment here.
      }
    } else {
      // Canvas Mode: Children layout is manual, but we might still need to recurse
      node.childIds.forEach((childId) => layoutNode(childId));
    }
  };

  // Start from roots (Document)
  const roots = Array.from(nodeMap.values()).filter((n) => !n.parentId);
  roots.forEach((root) => layoutNode(root.id));

  return Array.from(nodeMap.values());
};

// Wrapper to combine Constraint Solver + Auto Layout
const resolveLayout = (nodes: DesignerNode[], constraints: DesignerConstraint[]) => {
  // 1. Run Auto-Layout (Flex) to establish base positions
  const layoutNodes = computeLayout(nodes);
  
  // 2. Run Constraint Solver (Cassowary) for any specific overrides or "Canvas" mode internal constraints
  // Note: If everything is Flex, we might not need Cassowary as heavily.
  // But let's keep it for specific alignments (e.g. "Match Width" across different sub-trees).
  return resolveWithConstraints(layoutNodes, constraints);
};

const appendHistory = (state: DesignerState, nodes: DesignerNode[]) => {
  const nextHistory = [...state.history.slice(0, state.historyIndex + 1), snapshotNodes(nodes)];
  if (nextHistory.length > MAX_HISTORY_LENGTH) {
    nextHistory.shift();
  }
  return {
    history: nextHistory,
    historyIndex: nextHistory.length - 1,
  };
};

export const useInvoiceDesignerStore = create<DesignerState>()(
  devtools((set, get) => ({
    nodes: createInitialNodes(),
    constraints: [],
    selectedNodeId: null,
    hoverNodeId: null,
    snapToGrid: true,
    gridSize: 8,
    showGuides: true,
    showRulers: true,
    canvasScale: 1,
    history: [],
    historyIndex: -1,
    constraintError: null,
    metrics: {
      totalDrags: 0,
      completedDrops: 0,
      failedDrops: 0,
      totalSelections: 0,
    },
    addNodeFromPalette: (type, dropPoint, options = {}) => {
      const { snapToGrid: shouldSnap, gridSize } = get();
      const position = shouldSnap
        ? {
            x: snapToGridValue(dropPoint.x, gridSize),
            y: snapToGridValue(dropPoint.y, gridSize),
          }
        : dropPoint;

      const resolvedParentId =
        options.parentId ??
        (() => {
          const allowedParents = getAllowedParentsForType(type);
          if (!allowedParents.length) {
            return null;
          }
          const fallbackParent = get()
            .nodes.filter((node) => allowedParents.includes(node.type))
            .at(0);
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

      const node: DesignerNode = {
        id: generateId(),
        type,
        name: `${type} ${get().nodes.length + 1}`,
        position,
        size: options.defaults?.size ?? DEFAULT_SIZE,
        rotation: 0,
        canRotate: true,
        allowResize: true,
        ...options.defaults,
        metadata: options.defaults?.metadata ?? {},
        parentId: resolvedParentId,
        childIds: [],
        allowedChildren: getAllowedChildrenForType(type),
        layout: {
            mode: 'flex', // Default to flex for new nodes if applicable
            direction: 'column',
            gap: 0,
            padding: 0,
            justify: 'start',
            align: 'stretch',
            sizing: 'fixed',
        }
      };

      set((state) => {
        const appendedNodes = [...state.nodes, node];
        const withParentLink = attachChild(appendedNodes, resolvedParentId, node.id);
        const { nodes: resolvedNodes, constraintError } = resolveLayout(withParentLink, state.constraints);
        const { history, historyIndex } = appendHistory(state, resolvedNodes);
        return {
          nodes: resolvedNodes,
          history,
          historyIndex,
          constraintError,
          selectedNodeId: node.id,
          metrics: {
            ...state.metrics,
            completedDrops: state.metrics.completedDrops + 1,
          },
        };
      }, false, 'designer/addNodeFromPalette');
    },
    insertPreset: (presetId, dropPoint = { x: 120, y: 120 }, parentId) => {
      const preset = getPresetById(presetId);
      if (!preset) {
        console.warn('[Designer] unknown layout preset', presetId);
        return;
      }

      set((state) => {
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
        const parentAssignments: Array<{ parentId: string; childId: string }> = [];
        const createdNodes: DesignerNode[] = [];
        const dropParentNode = nodesById.get(resolvedParentId);
        if (!dropParentNode) {
          return state;
        }

        for (let index = 0; index < preset.nodes.length; index += 1) {
          const nodeDef = preset.nodes[index];
          if (!nodeDef.parentKey && nodeDef.type === dropParentNode.type) {
            keyToId.set(nodeDef.key, resolvedParentId);
            continue;
          }

          const parentKey = nodeDef.parentKey ? keyToId.get(nodeDef.parentKey) : resolvedParentId;
          if (!parentKey) {
            console.warn('[Designer] preset parent resolution failed', nodeDef.key);
            return state;
          }

          const parentNode = nodesById.get(parentKey);
          if (!parentNode || !canNestWithinParent(nodeDef.type, parentNode.type)) {
            console.warn('[Designer] invalid preset parent assignment', { nodeDef, parentNode });
            return state;
          }

          const newId = generateId();
          keyToId.set(nodeDef.key, newId);

          const catalogSize = getDefinition(nodeDef.type)?.defaultSize ?? DEFAULT_SIZE;
          const size = nodeDef.size ?? catalogSize;
          const node: DesignerNode = {
            id: newId,
            type: nodeDef.type,
            name: nodeDef.name ?? `${nodeDef.type} ${state.nodes.length + index + 1}`,
            position: {
              x: origin.x + nodeDef.offset.x,
              y: origin.y + nodeDef.offset.y,
            },
            size,
            rotation: 0,
            canRotate: true,
            allowResize: true,
            layoutPresetId: preset.id,
            metadata: {},
            parentId: parentKey,
            childIds: [],
            allowedChildren: getAllowedChildrenForType(nodeDef.type),
            layout: nodeDef.layout
              ? {
                  mode: 'flex',
                  direction: 'column',
                  gap: 0,
                  padding: 0,
                  justify: 'start',
                  align: 'stretch',
                  sizing: 'fixed',
                  ...nodeDef.layout,
                }
              : {
                  mode: 'flex',
                  direction: 'column',
                  gap: 0,
                  padding: 0,
                  justify: 'start',
                  align: 'stretch',
                  sizing: 'fixed',
                },
          };

          createdNodes.push(node);
          parentAssignments.push({ parentId: parentKey, childId: node.id });
          nodesById.set(node.id, node);
        }

        let nodes = [...state.nodes, ...createdNodes];
        parentAssignments.forEach(({ parentId: assignedParent, childId }) => {
          nodes = attachChild(nodes, assignedParent, childId);
        });
        const presetConstraints = preset.constraints
          .map((constraint) => {
            if (constraint.type === 'aspect-ratio') {
              const nodeId = keyToId.get(constraint.node);
              if (!nodeId) return null;
              return {
                id: generateId(),
                type: 'aspect-ratio',
                nodeId,
                ratio: constraint.ratio,
                strength: constraint.strength,
              } satisfies DesignerConstraint;
            }
            const first = keyToId.get(constraint.nodes[0]);
            const second = keyToId.get(constraint.nodes[1]);
            if (!first || !second) return null;
            return {
              id: generateId(),
              type: constraint.type,
              nodes: [first, second],
              strength: constraint.strength,
            } satisfies DesignerConstraint;
          })
          .filter((constraint): constraint is DesignerConstraint => Boolean(constraint));

        const constraints = [...state.constraints, ...presetConstraints];
        const { nodes: resolvedNodes, constraintError } = resolveLayout(nodes, constraints);
        const { history, historyIndex } = appendHistory(state, resolvedNodes);

        return {
          nodes: resolvedNodes,
          constraints,
          history,
          historyIndex,
          constraintError,
          metrics: {
            ...state.metrics,
            totalDrags: state.metrics.totalDrags + createdNodes.length,
            completedDrops: state.metrics.completedDrops + createdNodes.length,
          },
        };
      }, false, 'designer/insertPreset');
    },
    moveNode: (id, delta, commit = false) => {
      const { snapToGrid: shouldSnap, gridSize } = get();
      set((state) => {
        // If in Auto-Layout, moving might mean REORDERING, not changing X/Y.
        // For this iteration, we will stick to position updates, but the computeLayout
        // will OVERWRITE them if the parent is flex.
        // To support reordering, we would need to detect if delta crosses a sibling threshold.
        
        const rootNode = state.nodes.find((node) => node.id === id);
        if (!rootNode) return state;
        const descendantIds = collectDescendants(state.nodes, id);
        descendantIds.delete(id);
        const rawNext = {
          x: rootNode.position.x + delta.x,
          y: rootNode.position.y + delta.y,
        };
        const snappedNext = shouldSnap
          ? {
              x: snapToGridValue(rawNext.x, gridSize),
              y: snapToGridValue(rawNext.y, gridSize),
            }
          : rawNext;
        const boundedNext = clampPositionToParent(rootNode, state.nodes, snappedNext);
        const appliedDelta = {
          x: boundedNext.x - rootNode.position.x,
          y: boundedNext.y - rootNode.position.y,
        };
        if (appliedDelta.x === 0 && appliedDelta.y === 0) {
          return state;
        }
        const nodes = state.nodes.map((node) => {
          if (node.id === id) {
            return { ...node, position: boundedNext };
          }
          if (descendantIds.has(node.id)) {
            return {
              ...node,
              position: {
                x: node.position.x + appliedDelta.x,
                y: node.position.y + appliedDelta.y,
              },
            };
          }
          return node;
        });

        if (!commit) {
            // During drag, we might want to disable auto-layout temporarily?
            // Or we run it to show the "snap back"?
            // For now, let's NOT run auto-layout during drag move, only on commit.
          return { nodes };
        }

        const { nodes: resolvedNodes, constraintError } = resolveLayout(nodes, state.constraints);
        const { history, historyIndex } = appendHistory(state, resolvedNodes);
        return {
          nodes: resolvedNodes,
          history,
          historyIndex,
          constraintError,
        };
      }, false, commit ? 'designer/moveNodeCommit' : 'designer/moveNode');
    },
    setNodePosition: (id, position, commit = true) => {
      const { snapToGrid: shouldSnap, gridSize } = get();

      set((state) => {
        const rootNode = state.nodes.find((node) => node.id === id);
        if (!rootNode) return state;
        const nextPosition = shouldSnap
          ? {
              x: snapToGridValue(position.x, gridSize),
              y: snapToGridValue(position.y, gridSize),
            }
          : position;
        const boundedNext = clampPositionToParent(rootNode, state.nodes, nextPosition);
        const appliedDelta = {
          x: boundedNext.x - rootNode.position.x,
          y: boundedNext.y - rootNode.position.y,
        };
        if (appliedDelta.x === 0 && appliedDelta.y === 0) {
          return state;
        }
        const descendantIds = collectDescendants(state.nodes, id);
        descendantIds.delete(id);
        const nodes = state.nodes.map((node) => {
          if (node.id === id) {
            return { ...node, position: boundedNext };
          }
          if (descendantIds.has(node.id)) {
            return {
              ...node,
              position: {
                x: node.position.x + appliedDelta.x,
                y: node.position.y + appliedDelta.y,
              },
            };
          }
          return node;
        });
        if (!commit) {
          return { nodes };
        }
        const { nodes: resolvedNodes, constraintError } = resolveLayout(nodes, state.constraints);
        const { history, historyIndex } = appendHistory(state, resolvedNodes);
        return {
          nodes: resolvedNodes,
          history,
          historyIndex,
          constraintError,
        };
      }, false, 'designer/setNodePosition');
    },
    updateNodeSize: (id, size, commit = true) => {
      set((state) => {
        const nodes = state.nodes.map((node) => (node.id === id ? { ...node, size } : node));
        if (!commit) {
          return { nodes };
        }
        const { nodes: resolvedNodes, constraintError } = resolveLayout(nodes, state.constraints);
        const { history, historyIndex } = appendHistory(state, resolvedNodes);
        return {
          nodes: resolvedNodes,
          history,
          historyIndex,
          constraintError,
        };
      }, false, 'designer/updateNodeSize');
    },
    updateNodeName: (id, name) => {
      set((state) => {
        const nodes = state.nodes.map((node) => (node.id === id ? { ...node, name } : node));
        const nextHistory = [...state.history.slice(0, state.historyIndex + 1), snapshotNodes(nodes)];
        if (nextHistory.length > MAX_HISTORY_LENGTH) {
          nextHistory.shift();
        }
        return {
          nodes,
          history: nextHistory,
          historyIndex: nextHistory.length - 1,
        };
      }, false, 'designer/updateNodeName');
    },
    updateNodeMetadata: (id, metadata) => {
      set((state) => {
        const nodes = state.nodes.map((node) =>
          node.id === id ? { ...node, metadata: { ...(node.metadata ?? {}), ...metadata } } : node
        );
        const nextHistory = [...state.history.slice(0, state.historyIndex + 1), snapshotNodes(nodes)];
        if (nextHistory.length > MAX_HISTORY_LENGTH) {
          nextHistory.shift();
        }
        return {
          nodes,
          history: nextHistory,
          historyIndex: nextHistory.length - 1,
        };
      }, false, 'designer/updateNodeMetadata');
    },
    selectNode: (id) => {
      set((state) => ({
        selectedNodeId: id,
        metrics: {
          ...state.metrics,
          totalSelections: state.metrics.totalSelections + (id ? 1 : 0),
        },
      }), false, 'designer/selectNode');
    },
    setHoverNode: (id) => {
      set(() => ({ hoverNodeId: id }), false, 'designer/hoverNode');
    },
    deleteSelectedNode: () => {
      const selected = get().selectedNodeId;
      if (!selected) return;
      const nodeToDelete = get().nodes.find((node) => node.id === selected);
      if (!nodeToDelete || nodeToDelete.type === 'document') {
        return;
      }
      set((state) => {
        const idsToRemove = collectDescendants(state.nodes, selected);
        let nodes = state.nodes.filter((node) => !idsToRemove.has(node.id));
        nodes = detachChild(nodes, nodeToDelete.parentId, nodeToDelete.id);
        const { nodes: resolvedNodes, constraintError } = resolveLayout(nodes, state.constraints);
        const { history, historyIndex } = appendHistory(state, resolvedNodes);
        return {
          nodes: resolvedNodes,
          selectedNodeId: null,
          history,
          historyIndex,
          constraintError,
        };
      }, false, 'designer/deleteNode');
    },
    addConstraint: (constraint) =>
      set((state) => {
        const constraints = [...state.constraints.filter((existing) => existing.id !== constraint.id), constraint];
        const { nodes, constraintError } = resolveLayout(state.nodes, constraints);
        const { history, historyIndex } = appendHistory(state, nodes);
        return {
          constraints,
          nodes,
          history,
          historyIndex,
          constraintError,
        };
      }, false, 'designer/addConstraint'),
    removeConstraint: (constraintId) =>
      set((state) => {
        const constraints = state.constraints.filter((constraint) => constraint.id !== constraintId);
        const { nodes, constraintError } = resolveLayout(state.nodes, constraints);
        const { history, historyIndex } = appendHistory(state, nodes);
        return {
          constraints,
          nodes,
          history,
          historyIndex,
          constraintError,
        };
      }, false, 'designer/removeConstraint'),
    toggleAspectRatioLock: (nodeId) =>
      set((state) => {
        const constraintId = `aspect-${nodeId}`;
        const hasConstraint = state.constraints.some((constraint) => constraint.id === constraintId);
        let constraints = state.constraints;
        if (hasConstraint) {
          constraints = state.constraints.filter((constraint) => constraint.id !== constraintId);
        } else {
          const node = state.nodes.find((candidate) => candidate.id === nodeId);
          if (!node || node.size.height === 0) {
            return state;
          }
          constraints = [
            ...state.constraints,
            {
              id: constraintId,
              type: 'aspect-ratio',
              nodeId,
              ratio: Number((node.size.width / node.size.height).toFixed(4)),
              strength: 'strong',
            },
          ];
        }
        const { nodes, constraintError } = resolveLayout(state.nodes, constraints);
        const { history, historyIndex } = appendHistory(state, nodes);
        return {
          constraints,
          nodes,
          history,
          historyIndex,
          constraintError,
        };
      }, false, 'designer/toggleAspectRatio'),
    clearLayoutPreset: (nodeId) =>
      set((state) => ({
        nodes: state.nodes.map((node) => (node.id === nodeId ? { ...node, layoutPresetId: undefined } : node)),
      }), false, 'designer/clearLayoutPreset'),
    toggleSnap: () => set((state) => ({ snapToGrid: !state.snapToGrid }), false, 'designer/toggleSnap'),
    setGridSize: (size) => set(() => ({ gridSize: Math.max(2, Math.min(size, 64)) }), false, 'designer/setGridSize'),
    setCanvasScale: (scale) => set(() => ({ canvasScale: Math.min(Math.max(scale, 0.5), 3) }), false, 'designer/setCanvasScale'),
    toggleGuides: () => set((state) => ({ showGuides: !state.showGuides }), false, 'designer/toggleGuides'),
    toggleRulers: () => set((state) => ({ showRulers: !state.showRulers }), false, 'designer/toggleRulers'),
    undo: () => {
      set((state) => {
        if (state.historyIndex <= 0) {
          return state;
        }
        const previousNodes = snapshotNodes(state.history[state.historyIndex - 1]);
        return {
          nodes: previousNodes,
          historyIndex: state.historyIndex - 1,
        };
      }, false, 'designer/undo');
    },
    redo: () => {
      set((state) => {
        if (state.historyIndex >= state.history.length - 1) {
          return state;
        }
        const nextNodes = snapshotNodes(state.history[state.historyIndex + 1]);
        return {
          nodes: nextNodes,
          historyIndex: state.historyIndex + 1,
        };
      }, false, 'designer/redo');
    },
    resetWorkspace: () => {
      set(() => ({
        nodes: createInitialNodes(),
        constraints: [],
        selectedNodeId: null,
        history: [],
        historyIndex: -1,
        constraintError: null,
        metrics: {
          totalDrags: 0,
          completedDrops: 0,
          failedDrops: 0,
          totalSelections: 0,
        },
      }), false, 'designer/resetWorkspace');
    },
    loadNodes: (nodes) => {
      set(() => ({
        nodes: snapshotNodes(nodes),
        history: [snapshotNodes(nodes)],
        historyIndex: 0,
      }), false, 'designer/loadNodes');
    },
    recordDropResult: (success) => {
      set((state) => ({
        metrics: {
          ...state.metrics,
          totalDrags: state.metrics.totalDrags + 1,
          completedDrops: state.metrics.completedDrops + (success ? 1 : 0),
          failedDrops: state.metrics.failedDrops + (success ? 0 : 1),
        },
      }), false, 'designer/recordDropResult');
    },
    setLayoutMode: (nodeId, mode, options = {}) => {
      set((state) => {
        const nodes = state.nodes.map((node) => {
          if (node.id !== nodeId) return node;
          const updated = {
            ...node,
            layout: {
              direction: 'column',
              gap: 0,
              padding: 0,
              justify: 'start',
              align: 'stretch',
              sizing: 'fixed',
              ...node.layout,
              ...options,
              mode,
            },
          };
          return updated;
        });
        
        const { nodes: resolvedNodes, constraintError } = resolveLayout(nodes, state.constraints);
        const { history, historyIndex } = appendHistory(state, resolvedNodes);
        return {
          nodes: resolvedNodes,
          history,
          historyIndex,
          constraintError,
        };
      }, false, 'designer/setLayoutMode');
    },
  }))
);

export const selectNodes = (state: DesignerState) => state.nodes;
export const selectSelectedNodeId = (state: DesignerState) => state.selectedNodeId;

if (typeof window !== 'undefined') {
  (window as typeof window & { __ALGA_INVOICE_DESIGNER_STORE__?: typeof useInvoiceDesignerStore }).__ALGA_INVOICE_DESIGNER_STORE__ =
    useInvoiceDesignerStore;
}
