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
import { restrictToWindowEdges, createSnapModifier } from '@dnd-kit/modifiers';
import { ComponentPalette } from './palette/ComponentPalette';
import { DesignCanvas } from './canvas/DesignCanvas';
import { DesignerToolbar } from './toolbar/DesignerToolbar';
import type { DesignerComponentType, DesignerConstraint, DesignerNode, Point } from './state/designerStore';
import { useInvoiceDesignerStore } from './state/designerStore';
import { AlignmentGuide, calculateGuides, clampPositionToParent } from './utils/layout';
import { getDefinition } from './constants/componentCatalog';
import { getPresetById } from './constants/presets';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { useDesignerShortcuts } from './hooks/useDesignerShortcuts';
import { canNestWithinParent } from './state/hierarchy';

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

  useDesignerShortcuts();

  const [activeDrag, setActiveDrag] = useState<ActiveDragState>(null);
  const [guides, setGuides] = useState<AlignmentGuide[]>([]);
  const [previewPositions, setPreviewPositions] = useState<Record<string, Point>>({});
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
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

  const updatePointerLocation = useCallback((point: { x: number; y: number } | null) => {
    pointerRef.current = point;
  }, []);

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

  const renderLayoutInspector = () => {
    if (!selectedNode) return null;
    
    // Show layout controls for containers (sections, columns, pages)
    const isContainer = ['section', 'column', 'page'].includes(selectedNode.type);
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
        </div>
      );
    }

    if (selectedNode.type === 'label') {
      return (
        <div className="rounded border border-slate-200 bg-white px-3 py-2 space-y-2">
          <p className="text-xs font-semibold text-slate-700">Label Text</p>
          <Input
            id="designer-label-text"
            value={metadata.text ?? selectedNode.name ?? ''}
            onChange={(event) => applyMetadata({ text: event.target.value })}
          />
        </div>
      );
    }

    if (selectedNode.type === 'table' || selectedNode.type === 'dynamic-table') {
      const columns: Array<Record<string, any>> = Array.isArray(metadata.columns) ? metadata.columns : [];
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

      return (
        <div className="rounded border border-slate-200 bg-white px-3 py-2 space-y-3">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
            <span>Table Columns</span>
            <Button id="designer-add-column" variant="outline" size="xs" onClick={handleAddColumn}>
              Add column
            </Button>
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

    return null;
  };

  const handleDragStart = (event: DragStartEvent) => {
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
    if (activeDrag?.kind === 'component' || activeDrag?.kind === 'preset') {
      const dropPoint = pointerRef.current ?? { x: 120, y: 120 };
      const dropMeta = event.over?.data?.current as DropTargetMeta | undefined;
      if (!dropMeta) {
        recordDropResult(false);
      } else if (
        activeDrag.kind === 'component' &&
        canNestWithinParent(activeDrag.componentType, dropMeta.nodeType)
      ) {
        const def = getDefinition(activeDrag.componentType);
        const defaultMetadata = def ? buildDefaultMetadata(activeDrag.componentType, def.defaultMetadata) : undefined;
        addNode(
          activeDrag.componentType,
          dropPoint,
          def
            ? {
                parentId: dropMeta.nodeId,
                defaults: { size: def.defaultSize, metadata: defaultMetadata },
              }
            : { parentId: dropMeta.nodeId }
        );
        recordDropResult(true);
      } else if (activeDrag.kind === 'preset') {
        const presetDef = getPresetById(activeDrag.presetId);
        const rootTypes =
          presetDef?.nodes.filter((node) => !node.parentKey).map((node) => node.type) ?? [];
        const presetDropAllowed =
          rootTypes.length > 0
            ? rootTypes.every(
                (type) =>
                  type === dropMeta.nodeType || canNestWithinParent(type, dropMeta.nodeType)
              )
            : canNestWithinParent('section', dropMeta.nodeType);
        if (!presetDropAllowed) {
          recordDropResult(false);
        } else {
          insertPreset(activeDrag.presetId, dropPoint, dropMeta.nodeId);
          recordDropResult(true);
        }
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
    dragSessionRef.current = null;
    setPreviewPositions({});
    setGuides([]);
    setActiveDrag(null);
  };

  const handleDragCancel = () => {
    setActiveDrag(null);
    setGuides([]);
    dragSessionRef.current = null;
    setPreviewPositions({});
  };

  const handlePropertyInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    setPropertyDraft((prev) => ({ ...prev, [name]: Number(value) }));
  };

  const commitPropertyChanges = () => {
    if (!selectedNodeId) return;
    setNodePosition(selectedNodeId, { x: propertyDraft.x, y: propertyDraft.y }, true);
    updateNodeSize(selectedNodeId, { width: propertyDraft.width, height: propertyDraft.height }, true);
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
      <DesignerBreadcrumbs nodes={nodes} selectedNodeId={selectedNodeId} onSelect={selectNode} />
      <DndContext sensors={sensors} modifiers={modifiers}>
        <div className="flex flex-1 min-h-[560px] bg-white">
          <div className="w-72">
            <ComponentPalette />
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
              </div>
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
  nodes: ReturnType<typeof useInvoiceDesignerStore>['nodes'];
  selectedNodeId: string | null;
  showGuides: boolean;
  showRulers: boolean;
  gridSize: number;
  canvasScale: number;
  snapToGrid: boolean;
  guides: AlignmentGuide[];
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
        droppableId={DROPPABLE_CANVAS_ID}
        onPointerLocationChange={onPointerLocationChange}
        onNodeSelect={onNodeSelect}
        onResize={onResize}
      />
      <DragOverlay modifiers={modifiers}>
        {activeDrag?.kind === 'palette' && (
          <div className="px-3 py-2 bg-white border rounded shadow-lg text-sm font-semibold">
            {getDefinition(activeDrag.type)?.label ?? 'Component'}
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
