'use client';

/**
 * Focus mode for a designer: the same element, either in the page or over the whole window.
 *
 * It is controlled on purpose. `packages/ui` sits below the user-preference layer, so the host
 * owns where the choice is stored (`useDesignerFocusPreference`) and the surface only reports
 * that it should change. Both modes render one element and switch classes — a portal would
 * remount the subtree and drop undo history and unsaved edits.
 */
import React, { createContext, useCallback, useContext, useMemo } from 'react';

import { getShortcutCatalogEntry } from '../../keyboard-shortcuts/catalog';
import {
  useCatalogShortcut,
  useResolvedShortcutBindings,
  useShortcutAction,
  useShortcutActionDisabled,
} from '../../keyboard-shortcuts/provider';
import type { ShortcutAction } from '../../keyboard-shortcuts/types';

export interface DesignerFocusState {
  isFocused: boolean;
  toggle: () => void;
}

const NOT_FOCUSED: DesignerFocusState = { isFocused: false, toggle: () => undefined };

const DesignerFocusContext = createContext<DesignerFocusState | null>(null);

/**
 * The surface's state for anything inside it. Outside a surface it reports not focused with a
 * no-op toggle, so a designer shell rendered on an ordinary page behaves exactly as before.
 */
export function useDesignerFocusState(): DesignerFocusState {
  return useContext(DesignerFocusContext) ?? NOT_FOCUSED;
}

/** Null when there is no surface above the caller; the toggle uses it to render nothing. */
export function useOptionalDesignerFocusState(): DesignerFocusState | null {
  return useContext(DesignerFocusContext);
}

/**
 * z-40, not z-50: the AI chat panel is fixed at z-[45] inside the MSP shell and has to stay
 * openable over a focused designer. Dialogs, drawers, selects, tooltips and toasts portal to
 * the body, above the shell entirely.
 */
export const DESIGNER_FOCUS_SURFACE_FOCUSED_CLASSES =
  'fixed inset-0 z-40 flex flex-col overflow-hidden bg-[rgb(var(--color-background))]';

export const DESIGNER_FOCUS_MODE_SHORTCUT_ACTION_ID = 'designer.toggleFocusMode';

/**
 * The invoice, quote and document designers push the `editor` scope while their workspace is
 * mounted, and the dispatcher suppresses page-scope actions under it. The registry is keyed by
 * action id, so the same binding is registered a second time under an internal id at editor
 * scope; the two are never eligible at once, and the clone follows the user's own binding.
 */
const DESIGNER_FOCUS_MODE_EDITOR_SCOPE_ACTION_ID = 'designer.toggleFocusModeInEditor';

/** Registers `designer.toggleFocusMode` for as long as the surface is mounted and focusable. */
function useDesignerFocusModeShortcut(toggle: () => void, enabled: boolean): void {
  const handler = useCallback(() => {
    toggle();
  }, [toggle]);

  useCatalogShortcut(DESIGNER_FOCUS_MODE_SHORTCUT_ACTION_ID, handler, { enabled });

  const bindings = useResolvedShortcutBindings(DESIGNER_FOCUS_MODE_SHORTCUT_ACTION_ID);
  const isDisabled = useShortcutActionDisabled(DESIGNER_FOCUS_MODE_SHORTCUT_ACTION_ID);
  const bindingKey = bindings.join('|');

  const editorScopeAction = useMemo<ShortcutAction>(() => {
    const catalogEntry = getShortcutCatalogEntry(DESIGNER_FOCUS_MODE_SHORTCUT_ACTION_ID);
    const resolvedBindings = bindingKey.length > 0 ? bindingKey.split('|') : [];

    return {
      id: DESIGNER_FOCUS_MODE_EDITOR_SCOPE_ACTION_ID,
      labelKey: catalogEntry?.labelKey ?? '',
      descriptionKey: catalogEntry?.descriptionKey,
      groupKey: catalogEntry?.groupKey ?? '',
      scope: 'editor',
      allowInEditable: catalogEntry?.allowInEditable,
      defaultBindings: resolvedBindings,
      enabled: enabled && !isDisabled && resolvedBindings.length > 0,
      handler,
    };
  }, [bindingKey, enabled, handler, isDisabled]);

  useShortcutAction(editorScopeAction);
}

export interface DesignerFocusSurfaceProps {
  /** Element id of the surface itself. */
  id: string;
  focused: boolean;
  onFocusedChange: (focused: boolean) => void;
  /** Classes the surface carries in the normal layout. */
  className?: string;
  /** Extra classes while focused, on top of the shared focused classes. */
  focusedClassName?: string;
  /**
   * Whether this surface can enter focus mode at all. A host that keeps one surface around
   * several views (the workflow designer's list and control panel) passes false for the views
   * that have no designer in them: no shortcut, no context, so the toggle inside renders nothing
   * and the shells below behave exactly as on an ordinary page.
   */
  focusable?: boolean;
  children: React.ReactNode;
}

export function DesignerFocusSurface({
  id,
  focused,
  onFocusedChange,
  className,
  focusedClassName,
  focusable = true,
  children,
}: DesignerFocusSurfaceProps): React.JSX.Element {
  const isFocused = focusable && focused;
  const toggle = useCallback(() => {
    if (!focusable) return;
    onFocusedChange(!isFocused);
  }, [focusable, isFocused, onFocusedChange]);
  const state = useMemo<DesignerFocusState>(() => ({ isFocused, toggle }), [isFocused, toggle]);

  useDesignerFocusModeShortcut(toggle, focusable);

  const classes = isFocused
    ? `${DESIGNER_FOCUS_SURFACE_FOCUSED_CLASSES} ${focusedClassName ?? ''}`.trim()
    : (className ?? '');

  const surface = (
    <div id={id} data-focus-mode={isFocused ? 'on' : 'off'} className={classes}>
      {children}
    </div>
  );

  if (!focusable) {
    return surface;
  }

  return <DesignerFocusContext.Provider value={state}>{surface}</DesignerFocusContext.Provider>;
}

export default DesignerFocusSurface;
