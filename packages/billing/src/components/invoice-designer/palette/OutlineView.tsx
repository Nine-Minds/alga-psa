import React, { useState } from 'react';
import { useInvoiceDesignerStore, DesignerNode } from '../state/designerStore';
import clsx from 'clsx';
import { getNodeName } from '../utils/nodeProps';

export const OutlineView: React.FC = () => {
  const nodesById = useInvoiceDesignerStore((state) => state.nodesById);
  const rootId = useInvoiceDesignerStore((state) => state.rootId);
  const selectedNodeId = useInvoiceDesignerStore((state) => state.selectedNodeId);
  const selectNode = useInvoiceDesignerStore((state) => state.selectNode);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const parentById = React.useMemo(() => {
    const parentMap = new Map<string, string | null>();
    const visit = (id: string) => {
      const node = nodesById[id];
      if (!node) return;
      node.children.forEach((childId) => {
        if (!parentMap.has(childId)) {
          parentMap.set(childId, id);
          visit(childId);
        }
      });
    };
    parentMap.set(rootId, null);
    visit(rootId);
    return parentMap;
  }, [nodesById, rootId]);

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Auto-expand logic: ensure parents of selected node are expanded
  React.useEffect(() => {
    if (selectedNodeId) {
      const toExpand = new Set<string>();
      let currentId: string | null = selectedNodeId;
      while (currentId) {
        const parentId: string | null = parentById.get(currentId) ?? null;
        if (!parentId) break;
        toExpand.add(parentId);
        currentId = parentId;
      }
      if (toExpand.size > 0) {
        setExpanded(prev => {
          const next = new Set(prev);
          toExpand.forEach(id => next.add(id));
          return next;
        });
      }
    }
  }, [parentById, selectedNodeId]);

  const renderNode = (node: DesignerNode, depth: number = 0) => {
    const children = node.children.map((childId) => nodesById[childId]).filter(Boolean);
    const hasChildren = node.children.length > 0;
    const isExpanded = expanded.has(node.id);
    const isSelected = node.id === selectedNodeId;

    return (
      <div key={node.id} className="select-none">
        <div
          className={clsx(
            'flex items-center py-1 px-2 cursor-pointer text-xs transition-colors rounded',
            isSelected ? 'bg-blue-600 text-white' : 'hover:bg-slate-200 text-slate-700'
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => selectNode(node.id)}
        >
          <span
            className={clsx(
              'w-4 h-4 flex items-center justify-center mr-1 rounded hover:bg-black/10 cursor-pointer',
              !hasChildren && 'invisible'
            )}
            onClick={(e) => hasChildren && toggleExpand(node.id, e)}
          >
            {hasChildren && (isExpanded ? '▼' : '▶')}
          </span>
          <span className="truncate flex-1">
             {getNodeName(node) || node.type}
          </span>
        </div>
        {hasChildren && isExpanded && (
          <div>{children.map((child) => renderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  const rootNode = nodesById[rootId];
  if (!rootNode) {
    return <div className="flex-1 overflow-y-auto py-2" />;
  }

  return (
    <div className="flex-1 overflow-y-auto py-2">
      {renderNode(rootNode)}
    </div>
  );
};
