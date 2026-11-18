'use client';

import { createContext, createElement, useCallback, useContext, type ReactNode } from 'react';
import type { TicketNotificationSuppressionValue } from '../components/ticket/TicketNotificationSuppressionControl';

/**
 * The single definition of "what the notification checkboxes start at".
 *
 * Every "Don't notify the customer" checkbox in the product (comments, status
 * changes, contact changes, closure, bulk moves) starts from
 * {@link useDefaultNotificationSuppression} rather than an inline
 * `{ false, false }` object, so the tenant notification policy applies everywhere.
 */
export const EMPTY_TICKET_NOTIFICATION_SUPPRESSION: TicketNotificationSuppressionValue = {
  suppressContactNotifications: false,
  suppressInternalNotifications: false,
};

/**
 * Pure form: the starting value for a given tenant default.
 *
 * The tenant setting ticks the customer box only. "Also don't notify agents"
 * stays unchecked deliberately: suppressing the customer is an ordinary
 * request, silencing the whole internal team is a much larger footgun, and that
 * box is already gated on the customer box being ticked.
 */
export function computeNotificationSuppressionDefault(
  dontNotifyCustomer = false,
): TicketNotificationSuppressionValue {
  return dontNotifyCustomer
    ? { suppressContactNotifications: true, suppressInternalNotifications: false }
    : { ...EMPTY_TICKET_NOTIFICATION_SUPPRESSION };
}

/**
 * The tenant's `notification_settings.default_dont_notify_customer`, read on
 * the server and handed down by the MSP layout. Outside a provider (client
 * portal, isolated tests) the historical unticked default applies.
 */
const DontNotifyCustomerDefaultContext = createContext(false);

export function TicketNotificationDefaultsProvider({
  dontNotifyCustomer,
  children,
}: {
  dontNotifyCustomer: boolean;
  children: ReactNode;
}) {
  return createElement(
    DontNotifyCustomerDefaultContext.Provider,
    { value: dontNotifyCustomer === true },
    children,
  );
}

export function useDontNotifyCustomerDefault(): boolean {
  return useContext(DontNotifyCustomerDefaultContext);
}

/**
 * Returns a factory for the starting value of a suppression control. Usable as
 * a `useState` initializer and from reset handlers alike:
 *
 * ```tsx
 * const defaultNotificationSuppression = useDefaultNotificationSuppression();
 * const [suppression, setSuppression] =
 *   useState<TicketNotificationSuppressionValue>(defaultNotificationSuppression);
 * ```
 */
export function useDefaultNotificationSuppression(): () => TicketNotificationSuppressionValue {
  const dontNotifyCustomer = useDontNotifyCustomerDefault();
  return useCallback(
    () => computeNotificationSuppressionDefault(dontNotifyCustomer),
    [dontNotifyCustomer],
  );
}