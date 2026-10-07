import { useCallback, useMemo } from 'react';
import { useInvoiceDesignerStore } from '../state/designerStore';
import {
  copyStyle,
  copySubtree,
  resolveInsertionTarget,
  resolveMoveIntoTarget,
  resolveMoveOutTarget,
  resolveReorderTarget,
  type StructureTarget,
} from '../utils/structureEditing';

// A copy almost always needs a new name: put the caret there, ready to type over.
const focusLayerName = () => {
  if (typeof window === 'undefined') return;
  window.requestAnimationFrame(() => {
    const input = document.getElementById('selected-name');
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
  });
};

export type StructureCommand =
  | 'moveEarlier'
  | 'moveLater'
  | 'moveOut'
  | 'moveInto'
  | 'duplicate'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'delete'
  | 'copyStyle'
  | 'pasteStyle';

/**
 * The structural edits a user can make without dragging. Buttons and keyboard
 * shortcuts share these so both always agree on what is possible; each command
 * returns false when it does not apply, letting a shortcut fall through.
 */
export const useStructureCommands = () => {
  const nodes = useInvoiceDesignerStore((state) => state.nodes);
  const selectedNodeId = useInvoiceDesignerStore((state) => state.selectedNodeId);
  const clipboard = useInvoiceDesignerStore((state) => state.clipboard);
  const moveNode = useInvoiceDesignerStore((state) => state.moveNode);
  const pasteSubtree = useInvoiceDesignerStore((state) => state.pasteSubtree);
  const setClipboard = useInvoiceDesignerStore((state) => state.setClipboard);
  const deleteNode = useInvoiceDesignerStore((state) => state.deleteNode);
  const styleClipboard = useInvoiceDesignerStore((state) => state.styleClipboard);
  const setStyleClipboard = useInvoiceDesignerStore((state) => state.setStyleClipboard);
  const pasteStyleOnto = useInvoiceDesignerStore((state) => state.pasteStyle);

  const selected = useMemo(
    () => (selectedNodeId ? nodes.find((node) => node.id === selectedNodeId) ?? null : null),
    [nodes, selectedNodeId]
  );
  const isEditableSelection = Boolean(selected && selected.type !== 'document' && selected.type !== 'page');

  const targets = useMemo(() => {
    if (!selected || !isEditableSelection) {
      return { earlier: null, later: null, out: null, into: null };
    }
    return {
      earlier: resolveReorderTarget(nodes, selected.id, -1),
      later: resolveReorderTarget(nodes, selected.id, 1),
      out: resolveMoveOutTarget(nodes, selected.id),
      into: resolveMoveIntoTarget(nodes, selected.id),
    };
  }, [isEditableSelection, nodes, selected]);

  const pasteTarget = useMemo((): StructureTarget | null => {
    if (!clipboard) return null;
    const root = clipboard.nodes.find((entry) => entry.id === clipboard.rootId);
    if (!root) return null;
    // Pasting onto the block that was copied places the copy beside it, not inside it.
    if (selected && selected.id === clipboard.rootId && selected.parentId) {
      const parent = nodes.find((node) => node.id === selected.parentId);
      return parent ? { parentId: parent.id, index: parent.children.indexOf(selected.id) + 1 } : null;
    }
    return resolveInsertionTarget(nodes, selectedNodeId, root.type);
  }, [clipboard, nodes, selected, selectedNodeId]);

  const move = useCallback(
    (target: StructureTarget | null) => {
      if (!selected || !target) return false;
      moveNode(selected.id, target.parentId, target.index);
      return true;
    },
    [moveNode, selected]
  );

  const copy = useCallback(() => {
    if (!selected || !isEditableSelection) return false;
    const payload = copySubtree(nodes, selected.id);
    if (!payload) return false;
    setClipboard(payload);
    return true;
  }, [isEditableSelection, nodes, selected, setClipboard]);

  const paste = useCallback(() => {
    if (!clipboard || !pasteTarget) return false;
    const pasted = pasteSubtree(clipboard, pasteTarget.parentId, pasteTarget.index) !== null;
    if (pasted) focusLayerName();
    return pasted;
  }, [clipboard, pasteSubtree, pasteTarget]);

  const duplicate = useCallback(() => {
    if (!selected || !isEditableSelection || !selected.parentId) return false;
    const payload = copySubtree(nodes, selected.id);
    const parent = nodes.find((node) => node.id === selected.parentId);
    if (!payload || !parent) return false;
    const duplicated = pasteSubtree(payload, parent.id, parent.children.indexOf(selected.id) + 1) !== null;
    if (duplicated) focusLayerName();
    return duplicated;
  }, [isEditableSelection, nodes, pasteSubtree, selected]);

  const remove = useCallback(() => {
    if (!selected || !isEditableSelection) return false;
    deleteNode(selected.id);
    return true;
  }, [deleteNode, isEditableSelection, selected]);

  const cut = useCallback(() => {
    if (!copy()) return false;
    return remove();
  }, [copy, remove]);

  const copyStyleCommand = useCallback(() => {
    if (!selected || !isEditableSelection) return false;
    setStyleClipboard(copyStyle(selected));
    return true;
  }, [isEditableSelection, selected, setStyleClipboard]);

  const pasteStyleCommand = useCallback(() => {
    if (!selected || !isEditableSelection || !styleClipboard) return false;
    pasteStyleOnto(selected.id, styleClipboard);
    return true;
  }, [isEditableSelection, pasteStyleOnto, selected, styleClipboard]);

  const available: Record<StructureCommand, boolean> = {
    moveEarlier: Boolean(targets.earlier),
    moveLater: Boolean(targets.later),
    moveOut: Boolean(targets.out),
    moveInto: Boolean(targets.into),
    duplicate: isEditableSelection,
    copy: isEditableSelection,
    cut: isEditableSelection,
    paste: Boolean(pasteTarget),
    delete: isEditableSelection,
    copyStyle: isEditableSelection,
    pasteStyle: isEditableSelection && Boolean(styleClipboard),
  };

  const run: Record<StructureCommand, () => boolean> = {
    moveEarlier: () => move(targets.earlier),
    moveLater: () => move(targets.later),
    moveOut: () => move(targets.out),
    moveInto: () => move(targets.into),
    duplicate,
    copy,
    cut,
    paste,
    delete: remove,
    copyStyle: copyStyleCommand,
    pasteStyle: pasteStyleCommand,
  };

  return { available, run };
};
