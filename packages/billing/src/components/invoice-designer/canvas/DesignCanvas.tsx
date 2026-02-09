import React, { useCallback, useEffect, useMemo, useRef } from 'react';
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
  snapToGrid: boolean;
  guides: AlignmentGuide[];
  isDragActive: boolean;
  forcedDropTarget: string | 'canvas' | null;
  droppableId: string;
  onPointerLocationChange: (point: { x: number; y: number } | null) => void;
  onNodeSelect: (id: string | null) => void;
  onResize: (id: string, size: { width: number; height: number }, commit?: boolean) => void;
}

const GRID_COLOR = 'rgba(148, 163, 184, 0.25)';

interface CanvasNodeProps {
  node: DesignerNode;
  isSelected: boolean;
  hasActiveSelection: boolean;
  isDragActive: boolean;
  forcedDropTarget: string | 'canvas' | null;
  onSelect: (id: string) => void;
  onResize: (id: string, size: { width: number; height: number }, commit?: boolean) => void;
  renderChildren: (parentId: string) => React.ReactNode;
  childExtents?: { maxRight: number; maxBottom: number };
}

type SectionSemanticCue = {
  label: string;
  surfaceClass: string;
  chipClass: string;
  accentClass: string;
};

const getSectionSemanticCue = (sectionName: string): SectionSemanticCue => {
  const name = sectionName.toLowerCase();
  if (/\b(item|line item|service|detail)\b/.test(name)) {
    return {
      label: 'Items',
      surfaceClass: 'bg-cyan-100/45 border-cyan-300 border-dashed',
      chipClass: 'border-cyan-300 bg-cyan-100 text-cyan-800',
      accentClass: 'bg-cyan-400/80',
    };
  }
  if (/\b(total|summary|payment)\b/.test(name)) {
    return {
      label: 'Totals',
      surfaceClass: 'bg-emerald-100/45 border-emerald-300 border-dashed',
      chipClass: 'border-emerald-300 bg-emerald-100 text-emerald-800',
      accentClass: 'bg-emerald-400/80',
    };
  }
  if (/\b(footer|approval|signature)\b/.test(name)) {
    return {
      label: 'Footer',
      surfaceClass: 'bg-slate-100 border-slate-400 border-dashed',
      chipClass: 'border-slate-400 bg-white text-slate-700',
      accentClass: 'bg-slate-400/80',
    };
  }
  if (/\b(billing|info|meta|details)\b/.test(name)) {
    return {
      label: 'Info',
      surfaceClass: 'bg-blue-100/45 border-blue-300 border-dashed',
      chipClass: 'border-blue-300 bg-blue-100 text-blue-800',
      accentClass: 'bg-blue-400/80',
    };
  }
  if (/\b(header|masthead|top)\b/.test(name)) {
    return {
      label: 'Header',
      surfaceClass: 'bg-amber-100/45 border-amber-300 border-dashed',
      chipClass: 'border-amber-300 bg-amber-100 text-amber-800',
      accentClass: 'bg-amber-400/80',
    };
  }
  return {
    label: 'Section',
    surfaceClass: 'bg-blue-100/45 border-blue-300 border-dashed',
    chipClass: 'border-blue-300 bg-blue-100 text-blue-800',
    accentClass: 'bg-blue-400/80',
  };
};

const getPreviewContent = (node: DesignerNode): React.ReactNode => {
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
      const content = text.length > 0 ? text.slice(0, 140) : node.name;
      
      // Check for interpolation variables {{var}}
      const parts = content.split(/(\{\{.*?\}\})/g);
      if (parts.length === 1) {
        return content;
      }
      
      return (
        <span>
          {parts.map((part, index) => {
            if (part.startsWith('{{') && part.endsWith('}}')) {
              return (
                <span key={index} className="text-blue-600 bg-blue-50 px-1 rounded font-mono text-[10px] mx-0.5 border border-blue-100">
                  {part}
                </span>
              );
            }
            return part;
          })}
        </span>
      );
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
    case 'divider':
      return <div className="w-full h-px bg-slate-300 my-1" />;
    case 'spacer':
      return <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-300 bg-slate-50/50 border border-dashed border-slate-200">Spacer</div>;
    case 'container':
      return null; // Container renders children directly
    default:
      return `Placeholder content · ${node.size.width.toFixed(0)}×${node.size.height.toFixed(0)}`;
  }
};

const CanvasNode: React.FC<CanvasNodeProps> = ({
  node,
  isSelected,
  hasActiveSelection,
  isDragActive,
  forcedDropTarget,
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
    x: node.position.x,
    y: node.position.y,
  };
  const nodeStyle: React.CSSProperties = {
    width: inferredWidth,
    height: inferredHeight,
    top: localPosition.y,
    left: localPosition.x,
    position: 'absolute',
    transform: transform && !isDragging ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    zIndex: isDragging ? 40 : isSelected ? 30 : 10,
  };
  const shouldDeemphasize = hasActiveSelection && !isSelected && !isDragging;
  const sectionCue = node.type === 'section' ? getSectionSemanticCue(node.name) : null;

  const combinedRef = useCallback(
    (element: HTMLDivElement | null) => {
      // dnd-kit refs are typed as HTMLElement; HTMLDivElement is compatible.
      setNodeRef(element);
      if (isContainer) {
        setDropZoneRef(element);
      }
    },
    [isContainer, setDropZoneRef, setNodeRef]
  );

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
        'border rounded-md select-none transition-[opacity,box-shadow,border-color] duration-150',
        isContainer
          ? sectionCue?.surfaceClass ?? 'bg-blue-50/40 border-blue-200 border-dashed'
          : 'bg-white shadow-sm border-slate-300',
        isSelected && 'ring-2 ring-blue-600 shadow-[0_0_0_3px_rgba(37,99,235,0.2)] border-blue-500',
        ((isDragActive && isNodeDropTarget) || forcedDropTarget === node.id) &&
          'ring-2 ring-emerald-500 shadow-[0_0_0_2px_rgba(16,185,129,0.2)]',
        shouldDeemphasize && 'opacity-65',
        isDragging && 'opacity-80'
      )}
      {...listeners}
      onPointerDown={handlePointerDown}
      onClick={(e) => e.stopPropagation()}
      {...attributes}
    >
      {isContainer ? (
        <div className="relative w-full h-full">
          {sectionCue && <div className={clsx('absolute inset-y-0 left-0 w-1 rounded-l-md', sectionCue.accentClass)} />}
          <div className="absolute left-2 top-1 text-[10px] uppercase tracking-wide text-slate-500 pointer-events-none z-10 flex items-center gap-1.5">
            <span>{node.name} · {node.type}</span>
            {sectionCue && (
              <span className={clsx('rounded border px-1 py-0.5 text-[9px] font-semibold', sectionCue.chipClass)}>
                {sectionCue.label}
              </span>
            )}
          </div>
          <div className="relative w-full h-full">
            {renderChildren(node.id)}
          </div>
        </div>
      ) : (
        <>
          <div className="px-2 py-1 border-b bg-slate-50 text-xs font-semibold text-slate-600 flex items-center justify-between">
            <span className="truncate">{node.name}</span>
            <span className="text-[10px] uppercase tracking-wide text-slate-400">{node.type}</span>
          </div>
          <div
            className={clsx(
              'text-[11px] text-slate-500',
              node.type === 'divider' ? 'p-0 flex items-center justify-center h-[14px]' : 'p-2 whitespace-pre-wrap',
              node.type === 'spacer' && 'h-full p-0'
            )}
          >
            {previewContent}
          </div>
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
  isDragActive,
  forcedDropTarget,
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
  const setArtboardNodeRef = useCallback(
    (node: HTMLDivElement | null) => {
      setDroppableNodeRef(node);
      artboardRef.current = node;
    },
    [setDroppableNodeRef]
  );

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

  const renderNodeTree = useCallback((parentId: string) => {
    const children = childrenMap.get(parentId) ?? [];
    return children
      .filter((node) => node.type !== 'document' && node.type !== 'page')
      .map((node) => (
        <CanvasNode
          key={`${node.id}-${(node as any)._version || 0}`}
          node={node}
          isSelected={selectedNodeId === node.id}
          hasActiveSelection={selectedNodeId !== null}
          isDragActive={isDragActive}
          forcedDropTarget={forcedDropTarget}
          onSelect={onNodeSelect}
          onResize={onResize}
          renderChildren={renderNodeTree}
          childExtents={childExtentsMap.get(node.id)}
        />
      ));
  }, [childExtentsMap, childrenMap, forcedDropTarget, isDragActive, onNodeSelect, onResize, selectedNodeId]);

  const rootParentId = (defaultPageNode ?? documentNode)?.id;
  const canvasWidth = defaultPageNode?.size.width ?? DESIGNER_CANVAS_WIDTH;
  const canvasHeight = defaultPageNode?.size.height ?? DESIGNER_CANVAS_HEIGHT;

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
            {Array.from({ length: Math.ceil(canvasWidth / 50) + 2 }).map((_, index) => (
              <span key={`hr-${index}`}>{index * 50}</span>
            ))}
          </div>
          <div className="absolute top-8 bottom-0 left-0 w-12 bg-white border-r border-slate-200 flex flex-col items-end text-[10px] text-slate-400 py-4 pr-1 gap-6 z-10">
            {Array.from({ length: Math.ceil(canvasHeight / 50) + 2 }).map((_, index) => (
              <span key={`vr-${index}`}>{index * 50}</span>
            ))}
          </div>
        </>
      )}
      <div className="relative flex-1" style={{ padding: showRulers ? '48px 0 0 48px' : '32px' }}>
        <div
          ref={setArtboardNodeRef}
          className={clsx(
            'relative mx-auto rounded-lg border border-slate-300 shadow-inner bg-white',
            ((isDragActive && isOver) || forcedDropTarget === 'canvas') && 'ring-2 ring-emerald-500',
            selectedNodeId === rootParentId && 'ring-2 ring-blue-400'
          )}
          data-designer-canvas="true"
          style={{ 
            width: canvasWidth, 
            height: canvasHeight, 
            minHeight: DESIGNER_CANVAS_HEIGHT,
            ...backgroundStyle 
          }}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          onClick={(e) => {
            e.stopPropagation();
            if (rootParentId) {
              onNodeSelect(rootParentId);
            }
          }}
        >
          <div className="absolute left-3 top-2 z-20 rounded bg-slate-900/80 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white pointer-events-none">
            Template Boundary
          </div>
          <div
            className="absolute inset-0"
            style={{ transform: `scale(${canvasScale})`, transformOrigin: 'top left' }}
          >
            {rootParentId && renderNodeTree(rootParentId)}
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
