import React, { useState } from 'react';
import { useInvoiceDesignerStore, DesignerNode } from '../state/designerStore';
import clsx from 'clsx';

export const OutlineView: React.FC = () => {
  const nodes = useInvoiceDesignerStore((state) => state.nodes);
  const selectedNodeId = useInvoiceDesignerStore((state) => state.selectedNodeId);
  const selectNode = useInvoiceDesignerStore((state) => state.selectNode);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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
      let current = nodes.find(n => n.id === selectedNodeId);
      while (current?.parentId) {
        toExpand.add(current.parentId);
        current = nodes.find(n => n.id === current?.parentId);
      }
      if (toExpand.size > 0) {
        setExpanded(prev => {
          const next = new Set(prev);
          toExpand.forEach(id => next.add(id));
          return next;
        });
      }
    }
  }, [selectedNodeId, nodes]);

  const renderNode = (node: DesignerNode, depth: number = 0) => {
    const children = nodes.filter((n) => n.parentId === node.id);
    const hasChildren = children.length > 0;
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
             {node.name || node.type}
          </span>
        </div>
        {hasChildren && isExpanded && (
          <div>{children.map((child) => renderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  // Find root nodes (usually just "Document" or page)
  const rootNodes = nodes.filter((n) => !n.parentId);

  return (
    <div className="flex-1 overflow-y-auto py-2">
      {rootNodes.map((node) => renderNode(node))}
    </div>
  );
};
