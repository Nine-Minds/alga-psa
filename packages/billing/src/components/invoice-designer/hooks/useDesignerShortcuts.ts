import { useCallback } from 'react';
import { useCatalogShortcut, useShortcutScope } from '@alga-psa/ui/keyboard-shortcuts';
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

  useShortcutScope('editor');

  const moveSelectedNode = useCallback((dx: number, dy: number) => {
    if (!selectedNodeId) {
      return false;
    }

    const delta = snapToGrid ? gridSize : 4;
    const node = nodesById[selectedNodeId];
    if (!node) {
      return false;
    }

    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
    const desired = {
      x: node.position.x + dx * delta,
      y: node.position.y + dy * delta,
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
  }, [gridSize, nodesById, selectedNodeId, setNodeProp, snapToGrid]);

  const undoShortcut = useCallback(() => {
    undo();
  }, [undo]);
  const redoShortcut = useCallback(() => {
    redo();
  }, [redo]);
  const deleteSelectionShortcut = useCallback(() => {
    if (!selectedNodeId) return false;
    deleteSelectedNode();
  }, [deleteSelectedNode, selectedNodeId]);
  const cancelShortcut = useCallback(() => {
    if (!selectedNodeId) return false;
    selectNode(null);
  }, [selectNode, selectedNodeId]);
  const moveUpShortcut = useCallback(() => moveSelectedNode(0, -1), [moveSelectedNode]);
  const moveDownShortcut = useCallback(() => moveSelectedNode(0, 1), [moveSelectedNode]);
  const moveLeftShortcut = useCallback(() => moveSelectedNode(-1, 0), [moveSelectedNode]);
  const moveRightShortcut = useCallback(() => moveSelectedNode(1, 0), [moveSelectedNode]);

  useCatalogShortcut('editor.undo', undoShortcut);
  useCatalogShortcut('editor.redo', redoShortcut);
  useCatalogShortcut('editor.deleteSelection', deleteSelectionShortcut, { enabled: Boolean(selectedNodeId) });
  useCatalogShortcut('editor.cancel', cancelShortcut, { enabled: Boolean(selectedNodeId) });
  useCatalogShortcut('editor.moveUp', moveUpShortcut, { enabled: Boolean(selectedNodeId) });
  useCatalogShortcut('editor.moveDown', moveDownShortcut, { enabled: Boolean(selectedNodeId) });
  useCatalogShortcut('editor.moveLeft', moveLeftShortcut, { enabled: Boolean(selectedNodeId) });
  useCatalogShortcut('editor.moveRight', moveRightShortcut, { enabled: Boolean(selectedNodeId) });
};
