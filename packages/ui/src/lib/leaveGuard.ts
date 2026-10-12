import { useEffect, useRef } from 'react';
import { isEditableElement } from '../keyboard-shortcuts/editable';

/**
 * Process-wide guard against the browser leaving the page while something holds
 * unsaved work. Both dirty-state registries in the UI (UnsavedChangesProvider for
 * pages, DismissGuard for dialogs and drawers) feed it, so there is exactly one
 * `beforeunload` listener and one history-chord blocker no matter how many
 * containers are mounted.
 *
 * It blocks:
 *  - reload / tab close (`beforeunload`);
 *  - browser history chords (Cmd/Ctrl/Alt+Left/Right, Cmd+[ / ]) when focus is
 *    outside an editable element. Those navigate away and unmount the page,
 *    modal or drawer together with any typed text. Inside an editable the same
 *    keys are native caret movement and are left alone.
 *
 * The key listener runs on window in the bubble phase, after the shortcut layer
 * and component handlers, and ignores events somebody already handled.
 */

const sources = new Set<() => boolean>();
let installed = false;

function anyDirty(): boolean {
  for (const isDirty of sources) {
    if (isDirty()) {
      return true;
    }
  }
  return false;
}

export function isBrowserHistoryChord(event: KeyboardEvent): boolean {
  return (
    ((event.metaKey || event.ctrlKey || event.altKey) &&
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) ||
    (event.metaKey && (event.key === '[' || event.key === ']'))
  );
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.defaultPrevented || !isBrowserHistoryChord(event) || !anyDirty()) {
    return;
  }

  const target = event.target instanceof Element ? event.target : document.activeElement;
  if (isEditableElement(target)) {
    return;
  }

  event.preventDefault();
}

function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (!anyDirty()) {
    return;
  }
  event.preventDefault();
  event.returnValue = '';
}

/** Register a dirty-state source. Returns the unregister function. */
export function registerLeaveGuard(isDirty: () => boolean): () => void {
  sources.add(isDirty);

  if (!installed && typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('beforeunload', onBeforeUnload);
    installed = true;
  }

  return () => {
    sources.delete(isDirty);
    if (sources.size === 0 && installed && typeof window !== 'undefined') {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('beforeunload', onBeforeUnload);
      installed = false;
    }
  };
}

/** Keep the leave guard active while `active` is true, asking `isDirty` on each event. */
export function useLeaveGuard(isDirty: () => boolean, active = true): void {
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  useEffect(() => {
    if (!active) {
      return;
    }
    return registerLeaveGuard(() => isDirtyRef.current());
  }, [active]);
}
