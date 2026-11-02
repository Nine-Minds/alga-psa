'use client';

import { getTicketingDisplaySettings } from '../actions/ticketDisplaySettings';
import type { TicketNotificationSuppressionValue } from '../components/ticket/TicketNotificationSuppressionControl';

/**
 * The single definition of "what the notification checkboxes start at".
 *
 * Every "Don't notify the customer" checkbox in the product (comments, status
 * changes, contact changes, closure, bulk moves) used to build its own inline
 * `{ false, false }` object, so a tenant-wide default had nowhere to live. They
 * now call {@link defaultNotificationSuppression} instead.
 */
export const EMPTY_TICKET_NOTIFICATION_SUPPRESSION: TicketNotificationSuppressionValue = {
  suppressContactNotifications: false,
  suppressInternalNotifications: false,
};

/**
 * Pure form: the starting value for a given tenant default.
 *
 * The tenant setting ticks the customer box only. "Also don't notify agents"
 * stays unchecked deliberately — suppressing the customer is an ordinary
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
 * Cache of the tenant's `defaultDontNotifyCustomer` flag.
 *
 * `null` means "not loaded yet". It lives at module scope rather than in React
 * state because ~10 call sites across six components read it and none of them
 * owns it. `getTicketingDisplaySettings` is already used by the ticket screen's
 * bootstrap, so this reads the same document, not a new one.
 */
let cachedDontNotifyCustomer: boolean | null = null;
let inflight: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

/** Prime or correct the cache (also used by tests and server-rendered bootstraps). */
export function primeDontNotifyCustomerDefault(value: boolean): void {
  if (cachedDontNotifyCustomer === value) return;
  cachedDontNotifyCustomer = value;
  for (const listener of listeners) listener();
}

/** Forget the cached value so the next read refetches. */
export function resetDontNotifyCustomerDefaultCache(): void {
  cachedDontNotifyCustomer = null;
  inflight = null;
}

/** Synchronous read of the cached tenant default (`false` until loaded). */
export function readDontNotifyCustomerDefault(): boolean {
  return cachedDontNotifyCustomer ?? false;
}

/**
 * Starting value for a suppression control, using the cached tenant default.
 *
 * Reading synchronously is what lets the existing call sites keep their shape —
 * `setNotificationSuppression(defaultNotificationSuppression())` — instead of
 * threading a prop through every dialog. The cache warms on first use, so the
 * only window where it is still `false` is the very first control opened after
 * a page load; components that seed suppression into state re-seed it via
 * `useTicketNotificationSuppressionDefault` when the value lands.
 */
export function defaultNotificationSuppression(): TicketNotificationSuppressionValue {
  return computeNotificationSuppressionDefault(readDontNotifyCustomerDefault());
}

/**
 * Load the tenant default, at most once per page. Concurrent callers share the
 * one in-flight request.
 *
 * Fails open: a permission error or a network failure leaves the checkboxes
 * unticked, which is the historical behavior. A settings read is not worth
 * blocking a ticket action over.
 */
export function loadDontNotifyCustomerDefault(): Promise<boolean> {
  if (cachedDontNotifyCustomer !== null) return Promise.resolve(cachedDontNotifyCustomer);
  if (inflight) return inflight;

  const request = getTicketingDisplaySettings();

  inflight = request
    .then((settings) => {
      const flag = (settings as { defaultDontNotifyCustomer?: unknown } | null)?.defaultDontNotifyCustomer;
      primeDontNotifyCustomerDefault(flag === true);
      return flag === true;
    })
    .catch((error) => {
      console.error('Error loading dont-notify-customer default:', error);
      primeDontNotifyCustomerDefault(false);
      return false;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/** Subscribe to cache changes. Returns an unsubscribe function. */
export function subscribeDontNotifyCustomerDefault(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A suppression `useState` setter, for the re-seed helper below. */
export type SuppressionSetter = (value: TicketNotificationSuppressionValue) => void;
