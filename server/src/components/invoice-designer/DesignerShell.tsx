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
import { restrictToWindowEdges } from '@dnd-kit/modifiers';
import { ComponentPalette } from './palette/ComponentPalette';
import { DesignCanvas } from './canvas/DesignCanvas';
import { DesignerToolbar } from './toolbar/DesignerToolbar';
import { DesignerComponentType, useInvoiceDesignerStore } from './state/designerStore';
import { AlignmentGuide, calculateGuides } from './utils/layout';
import { getDefinition } from './constants/componentCatalog';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { useDesignerShortcuts } from './hooks/useDesignerShortcuts';

const DROPPABLE_CANVAS_ID = 'designer-canvas';

type ActiveDragState =
  | { kind: 'palette'; type: DesignerComponentType }
  | { kind: 'node'; nodeId: string }
  | null;

type PaletteDragData = {
  fromPalette: true;
  type: DesignerComponentType;
};

type NodeDragData = {
  nodeId: string;
};

const isPaletteDragData = (value: unknown): value is PaletteDragData =>
  typeof value === 'object' &&
  value !== null &&
  'fromPalette' in value &&
  (value as { fromPalette?: boolean }).fromPalette === true &&
  typeof (value as { type?: unknown }).type === 'string';

const isNodeDragData = (value: unknown): value is NodeDragData =>
  typeof value === 'object' &&
  value !== null &&
  'nodeId' in value &&
  typeof (value as { nodeId?: unknown }).nodeId === 'string';

export const DesignerShell: React.FC = () => {
  const nodes = useInvoiceDesignerStore((state) => state.nodes);
  const selectedNodeId = useInvoiceDesignerStore((state) => state.selectedNodeId);
  const addNode = useInvoiceDesignerStore((state) => state.addNodeFromPalette);
  const setNodePosition = useInvoiceDesignerStore((state) => state.setNodePosition);
  const updateNodeSize = useInvoiceDesignerStore((state) => state.updateNodeSize);
  const selectNode = useInvoiceDesignerStore((state) => state.selectNode);
  const updateNodeName = useInvoiceDesignerStore((state) => state.updateNodeName);
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

  useDesignerShortcuts();

  const [activeDrag, setActiveDrag] = useState<ActiveDragState>(null);
  const [guides, setGuides] = useState<AlignmentGuide[]>([]);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const dragSessionRef = useRef<{ nodeId: string; origin: { x: number; y: number } } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor)
  );

  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId) ?? null, [nodes, selectedNodeId]);
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

  const commitNodePosition = (nodeId: string, nextPosition: { x: number; y: number }) => {
    setNodePosition(nodeId, nextPosition, true);
  };

  const modifiers = useMemo<Modifier[]>(() => [restrictToWindowEdges], []);

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current;
    if (isPaletteDragData(data)) {
      setActiveDrag({ kind: 'palette', type: data.type });
      return;
    }
    if (isNodeDragData(data)) {
      setActiveDrag({ kind: 'node', nodeId: data.nodeId });
      const node = nodes.find((candidate) => candidate.id === data.nodeId);
      if (node) {
        dragSessionRef.current = {
          nodeId: data.nodeId,
          origin: { ...node.position },
        };
      }
    }
  };

  const handleDragMove = (event: DragMoveEvent) => {
    if (!dragSessionRef.current || activeDrag?.kind !== 'node') {
      return;
    }
    const { nodeId, origin } = dragSessionRef.current;
    const nextPosition = {
      x: origin.x + event.delta.x,
      y: origin.y + event.delta.y,
    };
    const activeNode = nodes.find((node) => node.id === nodeId);
    if (!activeNode) return;
    const ghostNode = {
      ...activeNode,
      position: nextPosition,
    };
    if (showGuides) {
      setGuides(calculateGuides(ghostNode, nodes));
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const overCanvas = event.over?.id === DROPPABLE_CANVAS_ID;
    if (activeDrag?.kind === 'palette') {
      const dropPoint = pointerRef.current ?? { x: 120, y: 120 };
      if (overCanvas) {
        const def = getDefinition(activeDrag.type);
        addNode(activeDrag.type, dropPoint, def ? { size: def.defaultSize } : undefined);
        recordDropResult(true);
      } else {
        recordDropResult(false);
      }
    }
    if (activeDrag?.kind === 'node' && dragSessionRef.current) {
      const { origin, nodeId } = dragSessionRef.current;
      const nextPosition = {
        x: origin.x + event.delta.x,
        y: origin.y + event.delta.y,
      };
      commitNodePosition(nodeId, nextPosition);
    }
    dragSessionRef.current = null;
    setGuides([]);
    setActiveDrag(null);
  };

  const handleDragCancel = () => {
    setActiveDrag(null);
    setGuides([]);
    dragSessionRef.current = null;
  };

  const handlePropertyInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    setPropertyDraft((prev) => ({ ...prev, [name]: Number(value) }));
  };

  const commitPropertyChanges = () => {
    if (!selectedNodeId) return;
    commitNodePosition(selectedNodeId, { x: propertyDraft.x, y: propertyDraft.y });
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
      <DndContext sensors={sensors} modifiers={modifiers}>
        <div className="flex flex-1 min-h-[560px] bg-white">
          <div className="w-72">
            <ComponentPalette />
          </div>
          <DesignerWorkspace
            nodes={nodes}
            selectedNodeId={selectedNodeId}
            showGuides={showGuides}
            showRulers={showRulers}
            gridSize={gridSize}
            canvasScale={canvasScale}
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
