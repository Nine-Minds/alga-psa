import { useCallback, useEffect, useRef, useState } from "react";
import type { TicketNotificationSuppressionOptions } from "../../../api/tickets";
import { useDefaultTicketNotificationSuppression } from "./TicketUpdateFooter";

/**
 * Suppression checkbox state seeded from the tenant's
 * `defaultDontNotifyCustomer` capability.
 *
 * The capability arrives after first mount (the app fetches it during startup),
 * so a plain `useState` would freeze the pre-load `false`. The state is
 * re-seeded whenever the tenant default changes AND the control is untouched.
 * Once an agent ticks or unticks it deliberately, that choice is never
 * overwritten, even if they return to the original value. `reset()` clears back to
 * the current tenant default (used after a save or when a sheet reopens).
 */
export function useTicketNotificationSuppression(): {
  suppression: TicketNotificationSuppressionOptions;
  setSuppression: (next: TicketNotificationSuppressionOptions) => void;
  reset: () => void;
} {
  const defaultValue = useDefaultTicketNotificationSuppression();
  const [suppression, setValue] = useState(defaultValue);
  const defaultValueRef = useRef(defaultValue);
  defaultValueRef.current = defaultValue;
  const touchedRef = useRef(false);

  useEffect(() => {
    if (!touchedRef.current) {
      setValue(defaultValue);
    }
  }, [defaultValue]);

  const setSuppression = useCallback((next: TicketNotificationSuppressionOptions) => {
    touchedRef.current = true;
    setValue(next);
  }, []);

  const reset = useCallback(() => {
    touchedRef.current = false;
    setValue(defaultValueRef.current);
  }, []);

  return { suppression, setSuppression, reset };
}
