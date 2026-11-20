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

export interface DesignerFocusSurfaceProps {
  /** Element id of the surface itself. */
  id: string;
  focused: boolean;
  onFocusedChange: (focused: boolean) => void;
  /** Classes the surface carries in the normal layout. */
  className?: string;
  /** Extra classes while focused, on top of the shared focused classes. */
  focusedClassName?: string;
  children: React.ReactNode;
}

export function DesignerFocusSurface({
  id,
  focused,
  onFocusedChange,
  className,
  focusedClassName,
  children,
}: DesignerFocusSurfaceProps): React.JSX.Element {
  const toggle = useCallback(() => onFocusedChange(!focused), [focused, onFocusedChange]);
  const state = useMemo<DesignerFocusState>(() => ({ isFocused: focused, toggle }), [focused, toggle]);

  const classes = focused
    ? `${DESIGNER_FOCUS_SURFACE_FOCUSED_CLASSES} ${focusedClassName ?? ''}`.trim()
    : (className ?? '');

  return (
    <DesignerFocusContext.Provider value={state}>
      <div id={id} data-focus-mode={focused ? 'on' : 'off'} className={classes}>
        {children}
      </div>
    </DesignerFocusContext.Provider>
  );
}

export default DesignerFocusSurface;
