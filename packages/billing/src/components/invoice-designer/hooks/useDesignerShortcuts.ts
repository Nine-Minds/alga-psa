import { useEffect } from 'react';
import { useInvoiceDesignerStore } from '../state/designerStore';

export const useDesignerShortcuts = () => {
  const undo = useInvoiceDesignerStore((state) => state.undo);
  const redo = useInvoiceDesignerStore((state) => state.redo);
  const deleteSelectedNode = useInvoiceDesignerStore((state) => state.deleteSelectedNode);
  const selectedNodeId = useInvoiceDesignerStore((state) => state.selectedNodeId);
  const moveNode = useInvoiceDesignerStore((state) => state.moveNode);
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
      if (selectedNodeId && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        const delta = snapToGrid ? gridSize : 4;
        switch (event.key) {
          case 'ArrowUp':
            moveNode(selectedNodeId, { x: 0, y: -delta }, true);
            break;
          case 'ArrowDown':
            moveNode(selectedNodeId, { x: 0, y: delta }, true);
            break;
          case 'ArrowLeft':
            moveNode(selectedNodeId, { x: -delta, y: 0 }, true);
            break;
          case 'ArrowRight':
            moveNode(selectedNodeId, { x: delta, y: 0 }, true);
            break;
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteSelectedNode, gridSize, moveNode, redo, selectedNodeId, snapToGrid, undo]);
};
