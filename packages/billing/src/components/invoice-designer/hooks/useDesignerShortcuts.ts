import { useCallback } from 'react';
import { useCatalogShortcut, useShortcutScope } from '@alga-psa/ui/keyboard-shortcuts';
import { useInvoiceDesignerStore } from '../state/designerStore';
import { useStructureCommands } from './useStructureCommands';

// Keys typed in a panel control, or in an open dropdown/menu/dialog (portaled to
// the body, so outside the panels), belong to that control, never to the block.
const NON_CANVAS_TARGET_SELECTOR = [
  '[data-automation-id="designer-shell-inspector-panel"]',
  '[data-automation-id="designer-shell-palette-panel"]',
  '[role="listbox"]',
  '[role="menu"]',
  '[role="dialog"]',
  '[data-radix-popper-content-wrapper]',
].join(', ');

export const useDesignerShortcuts = () => {
  const undo = useInvoiceDesignerStore((state) => state.undo);
  const redo = useInvoiceDesignerStore((state) => state.redo);
  const selectNode = useInvoiceDesignerStore((state) => state.selectNode);
  const selectedNodeId = useInvoiceDesignerStore((state) => state.selectedNodeId);
  const { available, run } = useStructureCommands();

  useShortcutScope('editor');

  const undoShortcut = useCallback(() => {
    undo();
  }, [undo]);
  const redoShortcut = useCallback(() => {
    redo();
  }, [redo]);
  const cancelShortcut = useCallback((event: KeyboardEvent) => {
    if (!selectedNodeId) return false;
    const target = event.target instanceof Element ? event.target : null;
    // Escape that closes a dropdown or popover belongs to that control alone.
    if (target?.closest('[role="listbox"], [role="menu"], [data-radix-popper-content-wrapper]')) {
      return false;
    }
    // From inside the inspector, Escape first leaves the control; the next one deselects.
    if (target?.closest('[data-automation-id="designer-shell-inspector-panel"]')) {
      (target as HTMLElement).blur?.();
      return true;
    }
    selectNode(null);
  }, [selectNode, selectedNodeId]);

  // Structural keys act on the selected block only when focus is not on a panel
  // control: an arrow key on an inspector button must not move the block.
  const onBlock = useCallback(
    (command: () => boolean) => (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(NON_CANVAS_TARGET_SELECTOR)) {
        return false;
      }
      return command();
    },
    []
  );

  // Blocks flow in their container, so arrow keys reorder them (as in auto-layout
  // editors) instead of nudging coordinates the layout ignores.
  useCatalogShortcut('editor.undo', undoShortcut);
  useCatalogShortcut('editor.redo', redoShortcut);
  useCatalogShortcut('editor.deleteSelection', onBlock(run.delete), { enabled: available.delete });
  useCatalogShortcut('editor.cancel', cancelShortcut, { enabled: Boolean(selectedNodeId) });
  useCatalogShortcut('editor.moveUp', onBlock(run.moveEarlier), { enabled: available.moveEarlier });
  useCatalogShortcut('editor.moveLeft', onBlock(run.moveEarlier), { enabled: available.moveEarlier });
  useCatalogShortcut('editor.moveDown', onBlock(run.moveLater), { enabled: available.moveLater });
  useCatalogShortcut('editor.moveRight', onBlock(run.moveLater), { enabled: available.moveLater });
  useCatalogShortcut('editor.moveOut', onBlock(run.moveOut), { enabled: available.moveOut });
  useCatalogShortcut('editor.moveInto', onBlock(run.moveInto), { enabled: available.moveInto });
  useCatalogShortcut('editor.copy', onBlock(run.copy), { enabled: available.copy });
  useCatalogShortcut('editor.cut', onBlock(run.cut), { enabled: available.cut });
  useCatalogShortcut('editor.paste', onBlock(run.paste), { enabled: available.paste });
  useCatalogShortcut('editor.duplicate', onBlock(run.duplicate), { enabled: available.duplicate });
  useCatalogShortcut('editor.copyStyle', onBlock(run.copyStyle), { enabled: available.copyStyle });
  useCatalogShortcut('editor.pasteStyle', onBlock(run.pasteStyle), { enabled: available.pasteStyle });
};
