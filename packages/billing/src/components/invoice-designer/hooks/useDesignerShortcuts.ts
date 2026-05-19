import { useCallback, useMemo } from 'react';
import { useShortcutAction, useShortcutScope, type ShortcutAction } from '@alga-psa/ui/keyboard-shortcuts';
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

  const shortcuts = useMemo<ShortcutAction[]>(() => [
    {
      id: 'editor.undo',
      labelKey: 'actions.editor.undo.label',
      groupKey: 'groups.editor',
      defaultBindings: ['mod+z'],
      scope: 'editor',
      priority: 60,
      handler: () => {
        undo();
      },
    },
    {
      id: 'editor.redo',
      labelKey: 'actions.editor.redo.label',
      groupKey: 'groups.editor',
      defaultBindings: { mac: ['mod+shift+z'], other: ['ctrl+y', 'ctrl+shift+z'] },
      scope: 'editor',
      priority: 60,
      handler: () => {
        redo();
      },
    },
    {
      id: 'editor.deleteSelection',
      labelKey: 'actions.editor.deleteSelection.label',
      groupKey: 'groups.editor',
      defaultBindings: ['Delete', 'Backspace'],
      scope: 'editor',
      priority: 60,
      enabled: Boolean(selectedNodeId),
      handler: () => {
        if (!selectedNodeId) return false;
        deleteSelectedNode();
      },
    },
    {
      id: 'editor.cancel',
      labelKey: 'actions.editor.cancel.label',
      groupKey: 'groups.editor',
      defaultBindings: ['Escape'],
      scope: 'editor',
      priority: 60,
      enabled: Boolean(selectedNodeId),
      handler: () => {
        if (!selectedNodeId) return false;
        selectNode(null);
      },
    },
    {
      id: 'editor.moveUp',
      labelKey: 'actions.editor.moveUp.label',
      groupKey: 'groups.editor',
      defaultBindings: ['ArrowUp'],
      scope: 'editor',
      priority: 60,
      enabled: Boolean(selectedNodeId),
      handler: () => moveSelectedNode(0, -1),
    },
    {
      id: 'editor.moveDown',
      labelKey: 'actions.editor.moveDown.label',
      groupKey: 'groups.editor',
      defaultBindings: ['ArrowDown'],
      scope: 'editor',
      priority: 60,
      enabled: Boolean(selectedNodeId),
      handler: () => moveSelectedNode(0, 1),
    },
    {
      id: 'editor.moveLeft',
      labelKey: 'actions.editor.moveLeft.label',
      groupKey: 'groups.editor',
      defaultBindings: ['ArrowLeft'],
      scope: 'editor',
      priority: 60,
      enabled: Boolean(selectedNodeId),
      handler: () => moveSelectedNode(-1, 0),
    },
    {
      id: 'editor.moveRight',
      labelKey: 'actions.editor.moveRight.label',
      groupKey: 'groups.editor',
      defaultBindings: ['ArrowRight'],
      scope: 'editor',
      priority: 60,
      enabled: Boolean(selectedNodeId),
      handler: () => moveSelectedNode(1, 0),
    },
  ], [deleteSelectedNode, moveSelectedNode, redo, selectNode, selectedNodeId, undo]);

  useShortcutAction(shortcuts[0]);
  useShortcutAction(shortcuts[1]);
  useShortcutAction(shortcuts[2]);
  useShortcutAction(shortcuts[3]);
  useShortcutAction(shortcuts[4]);
  useShortcutAction(shortcuts[5]);
  useShortcutAction(shortcuts[6]);
  useShortcutAction(shortcuts[7]);
};
