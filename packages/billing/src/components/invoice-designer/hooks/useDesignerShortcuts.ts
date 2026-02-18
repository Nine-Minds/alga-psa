import { useEffect } from 'react';
import { useInvoiceDesignerStore } from '../state/designerStore';
import { DESIGNER_CANVAS_BOUNDS } from '../constants/layout';

export const useDesignerShortcuts = () => {
  const undo = useInvoiceDesignerStore((state) => state.undo);
  const redo = useInvoiceDesignerStore((state) => state.redo);
  const deleteSelectedNode = useInvoiceDesignerStore((state) => state.deleteSelectedNode);
  const selectNode = useInvoiceDesignerStore((state) => state.selectNode);
  const selectedNodeId = useInvoiceDesignerStore((state) => state.selectedNodeId);
  const nodesById = useInvoiceDesignerStore((state) => state.nodesById);
  const setNodeProp = useInvoiceDesignerStore((state) => state.setNodeProp);
  const snapToGrid = useInvoiceDesignerStore((state) => state.snapToGrid);
  const gridSize = useInvoiceDesignerStore((state) => state.gridSize);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.tagName === 'INPUT' || (event.target as HTMLElement)?.tagName === 'TEXTAREA') {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedNodeId) {
          event.preventDefault();
          deleteSelectedNode();
        }
        return;
      }
      if (event.key === 'Escape') {
        if (selectedNodeId) {
          event.preventDefault();
          selectNode(null);
        }
        return;
      }
      if (selectedNodeId && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        const delta = snapToGrid ? gridSize : 4;
        const node = nodesById[selectedNodeId];
        if (!node) {
          return;
        }
        const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

        let dx = 0;
        let dy = 0;
        switch (event.key) {
          case 'ArrowUp':
            dy = -delta;
            break;
          case 'ArrowDown':
            dy = delta;
            break;
          case 'ArrowLeft':
            dx = -delta;
            break;
          case 'ArrowRight':
            dx = delta;
            break;
        }

        const desired = {
          x: node.position.x + dx,
          y: node.position.y + dy,
        };
        const clamped = {
          x: clamp(desired.x, 0, DESIGNER_CANVAS_BOUNDS.width - 10),
          y: clamp(desired.y, 0, DESIGNER_CANVAS_BOUNDS.height - 10),
        };

        if (dx !== 0 && dy !== 0) {
          setNodeProp(selectedNodeId, 'position.x', clamped.x, false);
          setNodeProp(selectedNodeId, 'position.y', clamped.y, true);
          return;
        }
        if (dx !== 0) {
          setNodeProp(selectedNodeId, 'position.x', clamped.x, true);
          return;
        }
        if (dy !== 0) {
          setNodeProp(selectedNodeId, 'position.y', clamped.y, true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteSelectedNode, gridSize, nodesById, redo, selectNode, selectedNodeId, setNodeProp, snapToGrid, undo]);
};
