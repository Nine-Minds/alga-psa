import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

import { solveConstraints } from '../utils/constraintSolver';
import { getDefinition } from '../constants/componentCatalog';
import { LAYOUT_PRESETS, getPresetById, LayoutPresetConstraintDefinition } from '../constants/presets';

export type DesignerComponentType =
  | 'page'
  | 'section'
  | 'column'
  | 'text'
  | 'totals'
  | 'table'
  | 'image'
  | 'logo'
  | 'qr'
  | 'dynamic-table';

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
  addNodeFromPalette: (type: DesignerComponentType, dropPoint: Point, defaults?: Partial<DesignerNode>) => void;
  insertPreset: (presetId: string, dropPoint?: Point) => void;
  moveNode: (id: string, delta: Point, commit?: boolean) => void;
  setNodePosition: (id: string, position: Point, commit?: boolean) => void;
  updateNodeSize: (id: string, size: Size, commit?: boolean) => void;
  updateNodeName: (id: string, name: string) => void;
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
}

const MAX_HISTORY_LENGTH = 50;
const DEFAULT_SIZE: Size = { width: 160, height: 64 };
const snapToGrid = (value: number, gridSize: number) => Math.round(value / gridSize) * gridSize;
const generateId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const snapshotNodes = (nodes: DesignerNode[]): DesignerNode[] =>
  nodes.map((node) => ({
    ...node,
    position: { ...node.position },
    size: { ...node.size },
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
    nodes: [],
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
    addNodeFromPalette: (type, dropPoint, defaults = {}) => {
      const { snapToGrid: shouldSnap, gridSize } = get();
      const position = shouldSnap
        ? {
            x: snapToGrid(dropPoint.x, gridSize),
            y: snapToGrid(dropPoint.y, gridSize),
          }
        : dropPoint;

      const node: DesignerNode = {
        id: generateId(),
        type,
        name: `${type} ${get().nodes.length + 1}`,
        position,
        size: defaults.size ?? DEFAULT_SIZE,
        rotation: 0,
        canRotate: true,
        allowResize: true,
        ...defaults,
      };

      set((state) => {
        const nextNodes = [...state.nodes, node];
        const { nodes: resolvedNodes, constraintError } = resolveWithConstraints(nextNodes, state.constraints);
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
    insertPreset: (presetId, dropPoint = { x: 120, y: 120 }) => {
      const preset = getPresetById(presetId);
      if (!preset) {
        console.warn('[Designer] unknown layout preset', presetId);
        return;
      }

      set((state) => {
        const origin = dropPoint ?? { x: 120, y: 120 };
        const keyToId = new Map<string, string>();
        const createdNodes = preset.nodes.map((nodeDef, index) => {
          const id = generateId();
          keyToId.set(nodeDef.key, id);
          const catalogSize = getDefinition(nodeDef.type)?.defaultSize ?? DEFAULT_SIZE;
          const size = nodeDef.size ?? catalogSize;
          return {
            id,
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
          } satisfies DesignerNode;
        });

        const nodes = [...state.nodes, ...createdNodes];
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
        const { nodes: resolvedNodes, constraintError } = resolveWithConstraints(nodes, constraints);
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
        const nodes = state.nodes.map((node) => {
          if (node.id !== id) return node;
          const nextPosition = {
            x: node.position.x + delta.x,
            y: node.position.y + delta.y,
          };
          return {
            ...node,
            position: shouldSnap
              ? {
                  x: snapToGrid(nextPosition.x, gridSize),
                  y: snapToGrid(nextPosition.y, gridSize),
                }
              : nextPosition,
          };
        });

        if (!commit) {
          return { nodes };
        }

        const { nodes: resolvedNodes, constraintError } = resolveWithConstraints(nodes, state.constraints);
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
      const nextPosition = shouldSnap
        ? {
            x: snapToGrid(position.x, gridSize),
            y: snapToGrid(position.y, gridSize),
          }
        : position;

      set((state) => {
        const nodes = state.nodes.map((node) => (node.id === id ? { ...node, position: nextPosition } : node));
        if (!commit) {
          return { nodes };
        }
        const { nodes: resolvedNodes, constraintError } = resolveWithConstraints(nodes, state.constraints);
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
        const { nodes: resolvedNodes, constraintError } = resolveWithConstraints(nodes, state.constraints);
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
      set((state) => {
        const nodes = state.nodes.filter((node) => node.id !== selected);
        const { nodes: resolvedNodes, constraintError } = resolveWithConstraints(nodes, state.constraints);
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
        const { nodes, constraintError } = resolveWithConstraints(state.nodes, constraints);
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
        const { nodes, constraintError } = resolveWithConstraints(state.nodes, constraints);
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
        const { nodes, constraintError } = resolveWithConstraints(state.nodes, constraints);
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
        nodes: [],
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
  }))
);

export const selectNodes = (state: DesignerState) => state.nodes;
export const selectSelectedNodeId = (state: DesignerState) => state.selectedNodeId;

if (typeof window !== 'undefined') {
  (window as typeof window & { __ALGA_INVOICE_DESIGNER_STORE__?: typeof useInvoiceDesignerStore }).__ALGA_INVOICE_DESIGNER_STORE__ =
    useInvoiceDesignerStore;
}
