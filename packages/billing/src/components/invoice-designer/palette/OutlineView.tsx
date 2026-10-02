import React from 'react';
import { useInvoiceDesignerStore, DesignerNode } from '../state/designerStore';
import clsx from 'clsx';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getNodeName } from '../utils/nodeProps';
import {
  DESIGNER_OUTLINE_DEPTH_ATTRIBUTE,
  DESIGNER_OUTLINE_EXPANDED_ATTRIBUTE,
  DESIGNER_OUTLINE_NODE_ID_ATTRIBUTE,
  DESIGNER_OUTLINE_PANE_ATTRIBUTE,
  revealCanvasNode,
} from '../utils/canvasDom';
import { useDraggable } from '@dnd-kit/core';

type OutlineRowProps = {
  node: DesignerNode;
  depth: number;
  className: string;
  rowRef?: React.Ref<HTMLDivElement>;
  expanded: boolean;
  onSelect: () => void;
  children: React.ReactNode;
};

/** An Outline row; drag it to move the block (see resolveOutlineDropTarget). */
const OutlineRow: React.FC<OutlineRowProps> = ({ node, depth, className, rowRef, expanded, onSelect, children }) => {
  const draggable = node.type !== 'document' && node.type !== 'page';
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `outline:${node.id}`,
    disabled: !draggable,
    data: { dragKind: 'node', nodeId: node.id, layoutKind: 'flow', source: 'outline' },
  });
  const setRefs = React.useCallback(
    (element: HTMLDivElement | null) => {
      setNodeRef(element);
      if (typeof rowRef === 'function') rowRef(element);
      else if (rowRef) (rowRef as React.MutableRefObject<HTMLDivElement | null>).current = element;
    },
    [rowRef, setNodeRef]
  );
  return (
    <div
      ref={setRefs}
      id={`designer-outline-row-${node.id}`}
      className={clsx(className, isDragging && 'opacity-50')}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      {...{
        [DESIGNER_OUTLINE_NODE_ID_ATTRIBUTE]: node.id,
        [DESIGNER_OUTLINE_DEPTH_ATTRIBUTE]: depth,
        [DESIGNER_OUTLINE_EXPANDED_ATTRIBUTE]: expanded ? 'true' : 'false',
      }}
      {...(draggable ? listeners : {})}
      {...(draggable ? attributes : {})}
      role={undefined}
      tabIndex={undefined}
      onClick={onSelect}
    >
      {children}
    </div>
  );
};

export const OutlineView: React.FC = () => {
  const { t } = useTranslation('msp/invoicing');
  const nodesById = useInvoiceDesignerStore((state) => state.nodesById);
  const rootId = useInvoiceDesignerStore((state) => state.rootId);
  const selectedNodeId = useInvoiceDesignerStore((state) => state.selectedNodeId);
  const selectNode = useInvoiceDesignerStore((state) => state.selectNode);
  const collapsedIds = useInvoiceDesignerStore((state) => state.outlineCollapsedIds);
  const toggleCollapsed = useInvoiceDesignerStore((state) => state.toggleOutlineCollapsed);
  const selectedRowRef = React.useRef<HTMLDivElement | null>(null);
  const paneRef = React.useRef<HTMLDivElement | null>(null);

  const collapsed = React.useMemo(() => new Set(collapsedIds), [collapsedIds]);

  // The selected row is always visible: collapsed ancestors reopen for it.
  React.useEffect(() => {
    if (!selectedNodeId) return;
    let parentId = nodesById[selectedNodeId]?.parentId ?? null;
    while (parentId) {
      if (collapsed.has(parentId)) {
        toggleCollapsed(parentId);
      }
      parentId = nodesById[parentId]?.parentId ?? null;
    }
  }, [collapsed, nodesById, selectedNodeId, toggleCollapsed]);

  // Bring the selected row into view by scrolling the outline pane only:
  // scrollIntoView would also scroll the page and jolt the canvas.
  React.useEffect(() => {
    const row = selectedRowRef.current;
    const pane = paneRef.current;
    if (!row || !pane) return;
    const rowTop = row.offsetTop; // the pane is the rows' offset parent
    if (rowTop < pane.scrollTop) {
      pane.scrollTop = rowTop;
    } else if (rowTop + row.offsetHeight > pane.scrollTop + pane.clientHeight) {
      pane.scrollTop = rowTop + row.offsetHeight - pane.clientHeight;
    }
  }, [selectedNodeId]);

  const renderNode = (node: DesignerNode, depth: number = 0) => {
    const children = node.children.map((childId) => nodesById[childId]).filter(Boolean);
    const hasChildren = children.length > 0;
    const isExpanded = !collapsed.has(node.id);
    const isSelected = node.id === selectedNodeId;
    const typeLabel = t(`designer.blocks.${node.type}.label`, { defaultValue: node.type });
    const name = getNodeName(node);

    return (
      <div key={node.id} className="select-none" role="treeitem" aria-expanded={hasChildren ? isExpanded : undefined} aria-selected={isSelected}>
        <OutlineRow
          node={node}
          depth={depth}
          rowRef={isSelected ? selectedRowRef : undefined}
          expanded={hasChildren && isExpanded}
          className={clsx(
            'flex items-center py-1 px-2 cursor-pointer text-xs rounded',
            isSelected
              ? 'bg-primary-600 text-white'
              : 'hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
          )}
          onSelect={() => {
            selectNode(node.id);
            revealCanvasNode(node.id);
          }}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-label={
              isExpanded
                ? t('designer.outline.collapse', { defaultValue: 'Collapse {{name}}', name: name || typeLabel })
                : t('designer.outline.expand', { defaultValue: 'Expand {{name}}', name: name || typeLabel })
            }
            className={clsx(
              'w-4 h-4 flex items-center justify-center mr-1 rounded hover:bg-black/10',
              !hasChildren && 'invisible'
            )}
            onClick={(event) => {
              event.stopPropagation();
              if (hasChildren) toggleCollapsed(node.id);
            }}
          >
            {hasChildren && (isExpanded ? '▼' : '▶')}
          </button>
          <span className="truncate flex-1">{name || typeLabel}</span>
          {name && name !== typeLabel && (
            <span className={clsx('ml-2 shrink-0 text-[10px]', isSelected ? 'text-white/80' : 'text-slate-400 dark:text-slate-500')}>
              {typeLabel}
            </span>
          )}
        </OutlineRow>
        {hasChildren && isExpanded && (
          <div role="group">{children.map((child) => renderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  const rootNode = nodesById[rootId];
  if (!rootNode) {
    return <div className="flex-1 overflow-y-auto py-2" />;
  }

  return (
    <div
      ref={paneRef}
      className="relative flex-1 overflow-y-auto py-2"
      role="tree"
      aria-label={t('designer.outline.title', { defaultValue: 'Outline' })}
      {...{ [DESIGNER_OUTLINE_PANE_ATTRIBUTE]: 'true' }}
    >
      {renderNode(rootNode)}
    </div>
  );
};
