'use client';

import { useCallback, useEffect, useState } from 'react';

interface UseUnsavedChangesGuardOptions {
  /**
   * Whether user-authored changes exist that would be lost on close.
   * Only authored edits should set this — reference-data loads, validation,
   * and step navigation must not.
   */
  isDirty: boolean;
  /** While true, close requests are ignored entirely (a submission is in flight). */
  isSubmitting?: boolean;
  /**
   * The controlling open state of the guarded dialog. When it flips to false
   * (e.g. after a successful submission closed the dialog directly), any
   * pending confirmation is dismissed so a reopened dialog starts clean.
   */
  isOpen?: boolean;
  /** Performs the actual close (typically flips the parent's open state). */
  onClose: () => void;
  /** Optional draft reset invoked before closing when the user confirms discard. */
  onDiscard?: () => void;
}

export interface UnsavedChangesGuard {
  /** Whether the discard confirmation should be shown. */
  isConfirmingClose: boolean;
  /**
   * Route every destructive dismissal (backdrop click, Escape, X button,
   * Cancel action) through this. Idempotent: repeated requests while the
   * confirmation is showing are no-ops, and requests during submission are
   * ignored.
   */
  requestClose: () => void;
  /** Dismiss the confirmation and keep the dialog mounted with its draft intact. */
  keepEditing: () => void;
  /** Reset the draft (if a reset was provided) and close the dialog. */
  confirmDiscard: () => void;
}

/**
 * Opt-in unsaved-changes guard for dialogs that own a draft the user can lose.
 *
 * The consuming dialog funnels every close mechanism into `requestClose` and
 * renders a confirmation (e.g. `ConfirmationDialog`) driven by
 * `isConfirmingClose`, wiring its safe action to `keepEditing` and its
 * destructive action to `confirmDiscard`. A pristine dialog closes
 * immediately; a successful submission should bypass the guard by calling its
 * own close path directly.
 */
export function useUnsavedChangesGuard({
  isDirty,
  isSubmitting = false,
  isOpen = true,
  onClose,
  onDiscard,
}: UseUnsavedChangesGuardOptions): UnsavedChangesGuard {
  const [isConfirmingClose, setIsConfirmingClose] = useState(false);

  // If the dialog closes through a path that bypasses the guard (successful
  // submission, parent-driven close), drop any pending confirmation so the
  // next open does not start with a stale prompt.
  useEffect(() => {
    if (!isOpen) {
      setIsConfirmingClose(false);
    }
  }, [isOpen]);

  const requestClose = useCallback(() => {
    if (isSubmitting) {
      return;
    }
    if (isDirty) {
      setIsConfirmingClose(true);
      return;
    }
    onClose();
  }, [isDirty, isSubmitting, onClose]);

  const keepEditing = useCallback(() => {
    setIsConfirmingClose(false);
  }, []);

  const confirmDiscard = useCallback(() => {
    setIsConfirmingClose(false);
    onDiscard?.();
    onClose();
  }, [onClose, onDiscard]);

  return { isConfirmingClose, requestClose, keepEditing, confirmDiscard };
}
