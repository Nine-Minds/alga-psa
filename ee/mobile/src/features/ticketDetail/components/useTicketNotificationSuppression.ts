import { useCallback, useEffect, useRef, useState } from "react";
import type { TicketNotificationSuppressionOptions } from "../../../api/tickets";
import { useDefaultTicketNotificationSuppression } from "./TicketUpdateFooter";

function sameSuppression(
  a: TicketNotificationSuppressionOptions,
  b: TicketNotificationSuppressionOptions,
): boolean {
  return (
    a.suppressContactNotifications === b.suppressContactNotifications &&
    a.suppressInternalNotifications === b.suppressInternalNotifications
  );
}

/**
 * Suppression checkbox state seeded from the tenant's
 * `defaultDontNotifyCustomer` capability.
 *
 * The capability arrives after first mount (the app fetches it during startup),
 * so a plain `useState` would freeze the pre-load `false`. The state is
 * re-seeded whenever the tenant default changes AND the control still holds
 * exactly what the previous default implies — once an agent ticks or unticks
 * it deliberately, that choice is never overwritten. `reset()` clears back to
 * the current tenant default (used after a save or when a sheet reopens).
 */
export function useTicketNotificationSuppression(): {
  suppression: TicketNotificationSuppressionOptions;
  setSuppression: (next: TicketNotificationSuppressionOptions) => void;
  reset: () => void;
} {
  const defaultValue = useDefaultTicketNotificationSuppression();
  const [suppression, setValue] = useState(defaultValue);
  // The last value this hook itself put in the control. Anything else can only
  // have come from the agent.
  const autoValueRef = useRef(defaultValue);

  useEffect(() => {
    if (sameSuppression(suppression, autoValueRef.current) && !sameSuppression(suppression, defaultValue)) {
      autoValueRef.current = defaultValue;
      setValue(defaultValue);
    }
  }, [defaultValue, suppression]);

  const setSuppression = useCallback((next: TicketNotificationSuppressionOptions) => {
    setValue(next);
  }, []);

  const reset = useCallback(() => {
    autoValueRef.current = defaultValue;
    setValue(defaultValue);
  }, [defaultValue]);

  return { suppression, setSuppression, reset };
}
