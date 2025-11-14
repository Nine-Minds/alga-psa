import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import clsx from 'clsx';
import { AlignmentGuide } from '../utils/layout';
import { DesignerNode, Point } from '../state/designerStore';
import { DESIGNER_CANVAS_WIDTH, DESIGNER_CANVAS_HEIGHT } from '../constants/layout';

interface DesignCanvasProps {
  nodes: DesignerNode[];
  selectedNodeId: string | null;
  showGuides: boolean;
  showRulers: boolean;
  gridSize: number;
  canvasScale: number;
  snapToGrid: boolean;
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
  parentOrigin: Point;
  onSelect: (id: string) => void;
  onResize: (id: string, size: { width: number; height: number }, commit?: boolean) => void;
  renderChildren: (parentId: string, parentOrigin: Point) => React.ReactNode;
  childExtents?: { maxRight: number; maxBottom: number };
}

const getPreviewContent = (node: DesignerNode) => {
  const metadata = (node.metadata ?? {}) as Record<string, unknown>;
  switch (node.type) {
    case 'field': {
      const bindingKey = typeof metadata.bindingKey === 'string' ? metadata.bindingKey : 'binding';
      const placeholder =
        typeof (metadata as { placeholder?: unknown }).placeholder === 'string'
          ? (metadata as { placeholder: string }).placeholder
          : '';
      return placeholder ? `${bindingKey} · ${placeholder}` : `Field: ${bindingKey}`;
    }
    case 'label':
      return `Label: ${metadata.text ?? node.name}`;
    case 'text': {
      const text = typeof metadata.text === 'string' ? metadata.text : node.name;
      return text.length > 0 ? text.slice(0, 140) : node.name;
    }
    case 'subtotal':
    case 'tax':
    case 'discount':
    case 'custom-total':
      return `${metadata.label ?? node.name}: {${metadata.bindingKey ?? 'binding'}}`;
    case 'table':
    case 'dynamic-table': {
      const columns = Array.isArray((metadata as { columns?: unknown }).columns)
        ? (metadata as { columns: Array<Record<string, unknown>> }).columns
        : [];
      const columnLabels =
        columns.length > 0
          ? columns
              .map((column) => column.header ?? column.key ?? 'column')
              .filter(Boolean)
              .join(' | ')
          : 'No columns configured';
      return `Table · ${columnLabels}`;
    }
    case 'action-button':
      return metadata.label ? `Button: ${metadata.label}` : 'Button';
    case 'signature':
      return metadata.signerLabel ? `Signature · ${metadata.signerLabel}` : 'Signature';
    case 'attachment-list':
      return metadata.title ? `Attachments: ${metadata.title}` : 'Attachments';
    case 'totals':
      return 'Totals Summary · Subtotal / Tax / Balance';
    default:
      return `Placeholder content · ${node.size.width.toFixed(0)}×${node.size.height.toFixed(0)}`;
  }
};

const CanvasNode: React.FC<CanvasNodeProps> = ({
  node,
  isSelected,
  parentOrigin,
  onSelect,
  onResize,
  renderChildren,
  childExtents,
}) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `node-${node.id}`,
    data: {
      nodeId: node.id,
    },
  });
  const isContainer = node.allowedChildren.length > 0;
  const { setNodeRef: setDropZoneRef, isOver: isNodeDropTarget } = useDroppable({
    id: `droppable-${node.id}`,
    disabled: !isContainer,
    data: isContainer
      ? {
          nodeId: node.id,
          nodeType: node.type,
          allowedChildren: node.allowedChildren,
        }
      : undefined,
  });

  const inferredWidth =
    isContainer && childExtents && Number.isFinite(childExtents.maxRight)
      ? Math.max(node.size.width, childExtents.maxRight - node.position.x)
      : node.size.width;
  const inferredHeight =
    isContainer && childExtents && Number.isFinite(childExtents.maxBottom)
      ? Math.max(node.size.height, childExtents.maxBottom - node.position.y)
      : node.size.height;
  const localPosition = {
    x: node.position.x - parentOrigin.x,
    y: node.position.y - parentOrigin.y,
  };
  const nodeStyle: React.CSSProperties = {
    width: inferredWidth,
    height: inferredHeight,
    top: localPosition.y,
    left: localPosition.x,
    position: 'absolute',
    transform: transform && !isDragging ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
  };

  const combinedRef = isContainer ? mergeRefs(setNodeRef, setDropZoneRef) : setNodeRef;

  const draggablePointerDown = listeners?.onPointerDown;
  const previewContent = useMemo(() => getPreviewContent(node), [node]);

  const handlePointerDown: React.PointerEventHandler<HTMLDivElement> = (event) => {
    event.stopPropagation();
    onSelect(node.id);
    draggablePointerDown?.(event);
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
      ref={combinedRef}
      style={nodeStyle}
      className={clsx(
        'border rounded-md select-none',
        isContainer ? 'bg-blue-50/40 border-blue-200 border-dashed' : 'bg-white shadow-sm border-slate-300',
        isSelected ? 'ring-2 ring-blue-400' : '',
        isNodeDropTarget && 'ring-2 ring-blue-400/60',
        isDragging && 'opacity-80'
      )}
      {...listeners}
      onPointerDown={handlePointerDown}
      {...attributes}
    >
      {isContainer ? (
        <div className="relative w-full h-full">
          <div className="absolute left-2 top-1 text-[10px] uppercase tracking-wide text-slate-500 pointer-events-none">
            {node.name} · {node.type}
          </div>
          <div className="relative w-full h-full pt-4">
            {renderChildren(node.id, node.position)}
          </div>
        </div>
      ) : (
        <>
          <div className="px-2 py-1 border-b bg-slate-50 text-xs font-semibold text-slate-600 flex items-center justify-between">
            <span className="truncate">{node.name}</span>
            <span className="text-[10px] uppercase tracking-wide text-slate-400">{node.type}</span>
          </div>
          <div className="p-2 text-[11px] text-slate-500 whitespace-pre-wrap">{previewContent}</div>
        </>
      )}
      {node.allowResize !== false && (
        <div
          role="button"
          tabIndex={0}
          onPointerDown={startResize}
          className="absolute -bottom-2 -right-2 h-4 w-4 rounded-full border border-blue-500 bg-white cursor-se-resize"
        />
      )}
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
  snapToGrid,
  guides,
  droppableId,
  onPointerLocationChange,
  onNodeSelect,
  onResize,
}) => {
  const artboardRef = useRef<HTMLDivElement>(null);
  const documentNode = useMemo(() => nodes.find((node) => node.parentId === null), [nodes]);
  const defaultPageNode = useMemo(
    () => nodes.find((node) => node.type === 'page' && node.parentId === documentNode?.id),
    [nodes, documentNode?.id]
  );
  const rootDropMeta = defaultPageNode ?? documentNode;
  const { setNodeRef: setDroppableNodeRef, isOver } = useDroppable({
    id: droppableId,
    data: rootDropMeta
      ? {
          nodeId: rootDropMeta.id,
          nodeType: rootDropMeta.type,
          allowedChildren: rootDropMeta.allowedChildren,
        }
      : undefined,
  });

  const backgroundStyle = useMemo<React.CSSProperties>(() => ({
    backgroundSize: `${gridSize * canvasScale}px ${gridSize * canvasScale}px`,
    backgroundImage: `linear-gradient(to right, ${GRID_COLOR} 1px, transparent 1px), linear-gradient(to bottom, ${GRID_COLOR} 1px, transparent 1px)`,
  }), [gridSize, canvasScale]);

  const childrenMap = useMemo(() => {
    const map = new Map<string, DesignerNode[]>();
    nodes.forEach((node) => {
      if (!node.parentId) return;
      if (!map.has(node.parentId)) {
        map.set(node.parentId, []);
      }
      map.get(node.parentId)!.push(node);
    });
    map.forEach((list) => {
      list.sort((a, b) => (a.position.y - b.position.y) || (a.position.x - b.position.x));
    });
    return map;
  }, [nodes]);

  const childExtentsMap = useMemo(() => {
    const map = new Map<string, { maxRight: number; maxBottom: number }>();
    nodes.forEach((node) => {
      if (!node.parentId) return;
      const existing = map.get(node.parentId) ?? { maxRight: Number.NEGATIVE_INFINITY, maxBottom: Number.NEGATIVE_INFINITY };
      const nodeRight = node.position.x + node.size.width;
      const nodeBottom = node.position.y + node.size.height;
      map.set(node.parentId, {
        maxRight: Math.max(existing.maxRight, nodeRight),
        maxBottom: Math.max(existing.maxBottom, nodeBottom),
      });
    });
    return map;
  }, [nodes]);

  const renderNodeTree = useCallback((parentId: string, parentOrigin: Point) => {
    const children = childrenMap.get(parentId) ?? [];
    return children
      .filter((node) => node.type !== 'document' && node.type !== 'page')
      .map((node) => (
        <CanvasNode
          key={node.id}
          node={node}
          parentOrigin={parentOrigin}
          isSelected={selectedNodeId === node.id}
          onSelect={onNodeSelect}
          onResize={onResize}
          renderChildren={renderNodeTree}
          childExtents={childExtentsMap.get(node.id)}
        />
      ));
  }, [childExtentsMap, childrenMap, onNodeSelect, onResize, selectedNodeId]);

  const rootParentId = (defaultPageNode ?? documentNode)?.id;
  const rootOrigin = defaultPageNode?.position ?? documentNode?.position ?? { x: 0, y: 0 };

  const handlePointerMove: React.PointerEventHandler<HTMLDivElement> = (event) => {
    if (!artboardRef.current) {
      return;
    }
    const rect = artboardRef.current.getBoundingClientRect();
    const rawX = (event.clientX - rect.left) / canvasScale;
    const rawY = (event.clientY - rect.top) / canvasScale;
    const x = snapToGrid ? Math.round(rawX / gridSize) * gridSize : rawX;
    const y = snapToGrid ? Math.round(rawY / gridSize) * gridSize : rawY;
    onPointerLocationChange({ x, y });
  };

  const handlePointerLeave = () => onPointerLocationChange(null);

  useEffect(() => {
    onPointerLocationChange(null);
  }, [canvasScale, snapToGrid, gridSize, onPointerLocationChange]);

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
            {rootParentId && renderNodeTree(rootParentId, rootOrigin)}
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
