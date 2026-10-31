'use client';

import { useEffect, useRef, useState } from 'react';
import {
  computeNotificationSuppressionDefault,
  loadDontNotifyCustomerDefault,
  readDontNotifyCustomerDefault,
  subscribeDontNotifyCustomerDefault,
  type SuppressionSetter,
} from './notificationSuppressionDefaults';
import type { TicketNotificationSuppressionValue } from '../components/ticket/TicketNotificationSuppressionControl';

/**
 * The tenant's "don't notify the customer" default: subscribes to cache changes
 * and kicks off the first load.
 */
export function useTicketNotificationSuppressionDefault(): boolean {
  const [value, setValue] = useState(readDontNotifyCustomerDefault);

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeDontNotifyCustomerDefault(() => {
      if (active) setValue(readDontNotifyCustomerDefault());
    });
    loadDontNotifyCustomerDefault().then((loaded) => {
      if (active) setValue(loaded);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return value;
}

/**
 * Re-seed a suppression control once the tenant default becomes known.
 *
 * `useState` initializers run before the settings request can land, so a control
 * mounted early would otherwise stay unticked. The control is only taken over
 * while it still holds exactly what the default *on record* implies — the moment
 * an agent (or a save/reset handler) puts anything else there, that value wins
 * and is never overwritten again.
 *
 * Call site shape:
 *
 * ```tsx
 * const [suppression, setSuppression] =
 *   useState<TicketNotificationSuppressionValue>(defaultNotificationSuppression);
 * useReseedNotificationSuppression(suppression, setSuppression);
 * ```
 */
export function useReseedNotificationSuppression(
  value: TicketNotificationSuppressionValue,
  setter: SuppressionSetter,
): boolean {
  const dontNotifyCustomer = useTicketNotificationSuppressionDefault();
  // Whatever this hook (or the mount-time initializer) last put in the control.
  // Anything else in it can only have come from a deliberate choice.
  const appliedRef = useRef<TicketNotificationSuppressionValue>(
    computeNotificationSuppressionDefault(readDontNotifyCustomerDefault()),
  );

  useEffect(() => {
    const current = appliedRef.current;
    const untouched =
      value.suppressContactNotifications === current.suppressContactNotifications &&
      value.suppressInternalNotifications === current.suppressInternalNotifications;
    if (!untouched) return;

    const wanted = computeNotificationSuppressionDefault(dontNotifyCustomer);
    if (
      wanted.suppressContactNotifications !== current.suppressContactNotifications ||
      wanted.suppressInternalNotifications !== current.suppressInternalNotifications
    ) {
      appliedRef.current = wanted;
      setter(wanted);
    }
  }, [dontNotifyCustomer, setter, value]);

  return dontNotifyCustomer;
}
