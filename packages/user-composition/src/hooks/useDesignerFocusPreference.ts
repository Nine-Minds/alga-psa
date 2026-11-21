'use client';

/**
 * Whether a designer opens in focus mode, remembered on the signed-in user's account the same
 * way view modes are. One boolean per designer, so a user who prefers focus mode in the invoice
 * designer gets it there and nowhere else.
 */
import { useCallback, useEffect, useState } from 'react';
import { useUserPreference } from './useUserPreference';

export const DESIGNER_FOCUS_MODE_DESIGNERS = [
  'service_request_form',
  'invoice_layout',
  'quote_layout',
  'document_layout',
  'workflow',
] as const;

export type DesignerFocusModeDesigner = (typeof DESIGNER_FOCUS_MODE_DESIGNERS)[number];

export function designerFocusModePreferenceKey(designer: DesignerFocusModeDesigner): string {
  return `designer_focus_mode_${designer}`;
}

export interface UseDesignerFocusPreferenceResult {
  isFocused: boolean;
  setFocused: (focused: boolean) => void;
  toggle: () => void;
}

export function useDesignerFocusPreference(
  designer: DesignerFocusModeDesigner
): UseDesignerFocusPreferenceResult {
  const { value, setValue, hasResolved } = useUserPreference<boolean>(
    designerFocusModePreferenceKey(designer),
    { defaultValue: false }
  );

  // A toggle made before the account value has loaded is the user's latest word on the matter:
  // hold it, show it, and write it again once the late-arriving value has landed (which would
  // otherwise overwrite it, and which the underlying hook only saves after that load). It is
  // written again even when it matches what resolved: a user with no saved row keeps the value
  // they just chose, and that first choice has to reach their account, not only this browser.
  // The underlying hook drops a save that repeats what the account already holds.
  const [pendingChoice, setPendingChoice] = useState<boolean | null>(null);

  useEffect(() => {
    if (!hasResolved || pendingChoice === null) return;
    setPendingChoice(null);
    setValue(pendingChoice);
  }, [hasResolved, pendingChoice, setValue]);

  const setFocused = useCallback(
    (focused: boolean) => {
      setValue(focused);
      if (!hasResolved) {
        setPendingChoice(focused);
      }
    },
    [hasResolved, setValue]
  );

  const isFocused = pendingChoice ?? value;

  const toggle = useCallback(() => setFocused(!isFocused), [isFocused, setFocused]);

  return { isFocused, setFocused, toggle };
}
