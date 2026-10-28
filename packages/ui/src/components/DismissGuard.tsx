'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
// LEVERAGE: friction dismiss-guard-import-cycle — Dialog renders ConfirmationDialog, which is itself built on Dialog; only safe because both are used at render time, not module-eval time
import { ConfirmationDialog } from './ConfirmationDialog';
import { useTranslation } from '../lib/i18n/client';
import { useLeaveGuard } from '../lib/leaveGuard';

/**
 * Dismiss guard: lets a Dialog or Drawer refuse to throw away unsaved work.
 *
 * A container is "dirty" when its caller passes `hasUnsavedChanges`, or when any
 * component rendered inside it reports dirty state through
 * `useRegisterDismissGuard`. Every dismiss path (Escape, overlay click, the X
 * button, manual close buttons wired to the guard) then goes through
 * `requestClose`, which asks "Discard unsaved changes?" instead of closing.
 */

// LEVERAGE: friction dismiss-guard-vs-unsaved-changes — DismissGuard (per Dialog/Drawer) and UnsavedChangesContext (per page) are two parallel dirty registries; composers must register with both (useRegisterDismissGuard + useRegisterUnsavedChanges) and only leaveGuard.ts is shared
export interface DismissGuardRegistry {
  register: (id: string, dirty: boolean) => void;
  unregister: (id: string) => void;
  hasDirty: () => boolean;
}

function createRegistry(): DismissGuardRegistry {
  const dirtyIds = new Set<string>();
  return {
    register: (id, dirty) => {
      if (dirty) {
        dirtyIds.add(id);
      } else {
        dirtyIds.delete(id);
      }
    },
    unregister: (id) => {
      dirtyIds.delete(id);
    },
    hasDirty: () => dirtyIds.size > 0,
  };
}

const DismissGuardContext = createContext<DismissGuardRegistry | null>(null);

export const DismissGuardProvider = DismissGuardContext.Provider;

let nextRegistrationId = 1;

/**
 * Report that the surrounding Dialog/Drawer holds unsaved work (for example a
 * comment being typed). No-op outside a guarded container.
 */
export function useRegisterDismissGuard(dirty: boolean): void {
  const registry = useContext(DismissGuardContext);
  const idRef = useRef<string>('');
  if (!idRef.current) {
    idRef.current = `dismiss-guard-${nextRegistrationId++}`;
  }

  useEffect(() => {
    registry?.register(idRef.current, dirty);
  }, [registry, dirty]);

  useEffect(() => {
    const id = idRef.current;
    return () => registry?.unregister(id);
  }, [registry]);
}

// The open Drawers, innermost last. DrawerContext-level actions (header close,
// history back/forward and their shortcuts) live outside the Drawer subtree and
// use this to run through the same guard.
const activeGuards: Array<{ guardAction: (action: () => void) => void }> = [];

/**
 * Run `action` (which would drop the content of the top-most open guarded
 * drawer) after the user has confirmed discarding unsaved changes. Runs
 * immediately when nothing is dirty or no guarded container is open.
 */
export function guardActiveDismiss(action: () => void): void {
  const top = activeGuards[activeGuards.length - 1];
  if (!top) {
    action();
    return;
  }
  top.guardAction(action);
}

export interface UseDismissGuardOptions {
  /** Prefix for the confirmation dialog's automation id. */
  id?: string;
  isOpen: boolean;
  onClose: () => void;
  hasUnsavedChanges?: boolean;
  /** Also register in the process-wide stack used by `guardActiveDismiss`. */
  trackActive?: boolean;
}

export interface DismissGuard {
  registry: DismissGuardRegistry;
  /** Close, or ask for confirmation first when there are unsaved changes. */
  requestClose: () => void;
  /** Run any content-dropping action, or ask for confirmation first. */
  guardAction: (action: () => void) => void;
  isDirty: () => boolean;
  isConfirming: () => boolean;
  /** The "Discard unsaved changes?" dialog. Render it inside the container content. */
  confirmElement: React.ReactElement;
}

export function useDismissGuard({
  id = 'dismiss-guard',
  isOpen,
  onClose,
  hasUnsavedChanges = false,
  trackActive = false,
}: UseDismissGuardOptions): DismissGuard {
  const { t } = useTranslation('common');
  const registry = useMemo(createRegistry, []);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const pendingActionRef = useRef<(() => void) | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const hasUnsavedChangesRef = useRef(hasUnsavedChanges);
  onCloseRef.current = onClose;
  hasUnsavedChangesRef.current = hasUnsavedChanges;

  const isDirty = useCallback(
    () => hasUnsavedChangesRef.current || registry.hasDirty(),
    [registry],
  );

  const setPending = useCallback((action: (() => void) | null) => {
    pendingActionRef.current = action;
    setPendingAction(action ? () => action : null);
  }, []);

  const guardAction = useCallback(
    (action: () => void) => {
      if (!isDirty()) {
        action();
        return;
      }

      // A second dismiss while the question is already on screen must not
      // replace or answer it.
      if (pendingActionRef.current) {
        return;
      }

      restoreFocusRef.current =
        typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setPending(action);
    },
    [isDirty, setPending],
  );

  const requestClose = useCallback(() => {
    guardAction(() => onCloseRef.current());
  }, [guardAction]);

  const guardActionRef = useRef(guardAction);
  guardActionRef.current = guardAction;

  const keepEditing = useCallback(() => {
    setPending(null);
    const target = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (target && typeof window !== 'undefined') {
      // Wait for the confirmation to unmount so it cannot take focus back.
      window.setTimeout(() => {
        if (target.isConnected) {
          target.focus();
        }
      }, 0);
    }
  }, [setPending]);

  const discard = useCallback(() => {
    const action = pendingActionRef.current;
    restoreFocusRef.current = null;
    setPending(null);
    action?.();
  }, [setPending]);

  // A container that closes by other means must not keep a stale question.
  useEffect(() => {
    if (!isOpen) {
      setPending(null);
    }
  }, [isOpen, setPending]);

  useEffect(() => {
    if (!trackActive || !isOpen) {
      return;
    }

    const entry = { guardAction: (action: () => void) => guardActionRef.current(action) };
    activeGuards.push(entry);
    return () => {
      const index = activeGuards.indexOf(entry);
      if (index !== -1) {
        activeGuards.splice(index, 1);
      }
    };
  }, [trackActive, isOpen]);

  // Reload, tab close and browser history chords also throw the typed text away;
  // the shared leave guard (also used by UnsavedChangesProvider) blocks them.
  useLeaveGuard(isDirty, isOpen);

  const confirmElement = (
    <ConfirmationDialog
      id={`${id}-discard-dialog`}
      isOpen={pendingAction !== null}
      onClose={keepEditing}
      onConfirm={discard}
      title={t('unsavedChangesGuard.title', 'Discard unsaved changes?')}
      message={t(
        'unsavedChangesGuard.message',
        'You have unsaved changes that will be lost if you close this. Do you want to discard them?',
      )}
      confirmLabel={t('unsavedChangesGuard.discard', 'Discard changes')}
      cancelLabel={t('unsavedChangesGuard.keepEditing', 'Keep editing')}
    />
  );

  return {
    registry,
    requestClose,
    guardAction,
    isDirty,
    isConfirming: () => pendingActionRef.current !== null,
    confirmElement,
  };
}
