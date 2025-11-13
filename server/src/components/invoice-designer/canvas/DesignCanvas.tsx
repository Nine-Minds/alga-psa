import React, { useEffect, useMemo, useRef } from 'react';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import clsx from 'clsx';
import { AlignmentGuide } from '../utils/layout';
import { DesignerNode } from '../state/designerStore';
import { DESIGNER_CANVAS_WIDTH, DESIGNER_CANVAS_HEIGHT } from '../constants/layout';

interface DesignCanvasProps {
  nodes: DesignerNode[];
  selectedNodeId: string | null;
  showGuides: boolean;
  showRulers: boolean;
  gridSize: number;
  canvasScale: number;
  guides: AlignmentGuide[];
  droppableId: string;
  onPointerLocationChange: (point: { x: number; y: number } | null) => void;
  onNodeSelect: (id: string | null) => void;
  onResize: (id: string, size: { width: number; height: number }, commit?: boolean) => void;
}

const GRID_COLOR = 'rgba(148, 163, 184, 0.25)';

const mergeRefs = <T,>(...refs: Array<React.Ref<T>>) => (value: T) => {
  refs.forEach((ref) => {
    if (!ref) return;
    if (typeof ref === 'function') {
      ref(value);
      return;
    }
    (ref as React.MutableRefObject<T | null>).current = value;
  });
};

interface CanvasNodeProps {
  node: DesignerNode;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onResize: (id: string, size: { width: number; height: number }, commit?: boolean) => void;
}

const CanvasNode: React.FC<CanvasNodeProps> = ({ node, isSelected, onSelect, onResize }) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `node-${node.id}`,
    data: {
      nodeId: node.id,
    },
  });

  const nodeStyle: React.CSSProperties = {
    width: node.size.width,
    height: node.size.height,
    top: node.position.y,
    left: node.position.x,
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
  };

  const handlePointerDown: React.PointerEventHandler<HTMLDivElement> = (event) => {
    event.stopPropagation();
    onSelect(node.id);
  };

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const { width, height } = node.size;
    let latestSize = node.size;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      latestSize = {
        width: Math.max(40, width + deltaX),
        height: Math.max(32, height + deltaY),
      };
      onResize(node.id, latestSize, false);
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      upEvent.preventDefault();
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      onResize(node.id, latestSize, true);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
  };

  return (
    <div
      ref={setNodeRef}
      style={nodeStyle}
      className={clsx(
        'absolute border rounded-md shadow-sm bg-white select-none',
        isSelected ? 'border-blue-500 ring-2 ring-blue-300' : 'border-slate-300',
        isDragging && 'opacity-80'
      )}
      onPointerDown={handlePointerDown}
      {...listeners}
      {...attributes}
    >
      <div className="px-2 py-1 border-b bg-slate-50 text-xs font-semibold text-slate-600 flex items-center justify-between">
        <span>{node.name}</span>
        <span className="text-[10px] uppercase tracking-wide text-slate-400">{node.type}</span>
      </div>
      <div className="p-2 text-[11px] text-slate-500">
        Placeholder content · {node.size.width.toFixed(0)}×{node.size.height.toFixed(0)}
      </div>
      <div
        role="button"
        tabIndex={0}
        onPointerDown={startResize}
        className="absolute -bottom-2 -right-2 h-4 w-4 rounded-full border border-blue-500 bg-white cursor-se-resize"
      />
    </div>
  );
};

export const DesignCanvas: React.FC<DesignCanvasProps> = ({
  nodes,
  selectedNodeId,
  showGuides,
  showRulers,
  gridSize,
  canvasScale,
  guides,
  droppableId,
  onPointerLocationChange,
  onNodeSelect,
  onResize,
}) => {
  const artboardRef = useRef<HTMLDivElement>(null);
  const { setNodeRef: setDroppableNodeRef, isOver } = useDroppable({ id: droppableId });

  const backgroundStyle = useMemo<React.CSSProperties>(() => ({
    backgroundSize: `${gridSize * canvasScale}px ${gridSize * canvasScale}px`,
    backgroundImage: `linear-gradient(to right, ${GRID_COLOR} 1px, transparent 1px), linear-gradient(to bottom, ${GRID_COLOR} 1px, transparent 1px)`,
  }), [gridSize, canvasScale]);

  const handlePointerMove: React.PointerEventHandler<HTMLDivElement> = (event) => {
    if (!artboardRef.current) {
      return;
    }
    const rect = artboardRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / canvasScale;
    const y = (event.clientY - rect.top) / canvasScale;
    onPointerLocationChange({ x, y });
  };

  const handlePointerLeave = () => onPointerLocationChange(null);

  useEffect(() => {
    onPointerLocationChange(null);
  }, [canvasScale, onPointerLocationChange]);

  return (
    <div className="relative flex-1 overflow-auto bg-slate-100" onClick={() => onNodeSelect(null)}>
      {showRulers && (
        <>
          <div className="absolute top-0 left-12 right-0 h-8 bg-white border-b border-slate-200 flex items-end text-[10px] text-slate-400 px-3 gap-3 z-10">
            {Array.from({ length: 20 }).map((_, index) => (
              <span key={`hr-${index}`}>{index * 50}</span>
            ))}
          </div>
          <div className="absolute top-8 bottom-0 left-0 w-12 bg-white border-r border-slate-200 flex flex-col items-end text-[10px] text-slate-400 py-4 pr-1 gap-6 z-10">
            {Array.from({ length: 20 }).map((_, index) => (
              <span key={`vr-${index}`}>{index * 50}</span>
            ))}
          </div>
        </>
      )}
      <div className="relative flex-1" style={{ padding: showRulers ? '48px 0 0 48px' : '32px' }}>
        <div
          ref={mergeRefs(setDroppableNodeRef, artboardRef)}
          className={clsx(
            'relative mx-auto rounded-lg border border-slate-300 shadow-inner bg-white',
            isOver && 'ring-2 ring-blue-400'
          )}
          data-designer-canvas="true"
          style={{ width: DESIGNER_CANVAS_WIDTH, height: DESIGNER_CANVAS_HEIGHT, ...backgroundStyle }}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
        >
          <div
            className="absolute inset-0"
            style={{ transform: `scale(${canvasScale})`, transformOrigin: 'top left' }}
          >
            {nodes.map((node) => (
              <CanvasNode
                key={node.id}
                node={node}
                isSelected={selectedNodeId === node.id}
                onSelect={onNodeSelect}
                onResize={onResize}
              />
            ))}
            {showGuides && guides.map((guide) => (
              <div
                key={`${guide.type}-${guide.position}`}
                className={clsx(
                  'absolute pointer-events-none',
                  guide.type === 'vertical' ? 'w-px h-full bg-blue-400/60' : 'h-px w-full bg-blue-400/60'
                )}
                style={guide.type === 'vertical' ? { left: guide.position } : { top: guide.position }}
              >
                <span className="absolute text-[10px] bg-white px-1 text-blue-500">
                  {guide.description}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
