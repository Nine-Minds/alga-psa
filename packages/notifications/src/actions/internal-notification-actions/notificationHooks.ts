import type { InternalNotification } from "../../types/internalNotification";

/**
 * Post-creation hooks for internal notifications.
 * Allows external modules (e.g., push notifications) to react to newly
 * created notifications without modifying every call site.
 *
 * This file is intentionally NOT a "use server" module so that
 * exported functions are not constrained to be async Server Actions.
 */
export type InternalNotificationHook = (notification: InternalNotification) => void;

const postCreationHooks: InternalNotificationHook[] = [];

/**
 * Register a hook that fires (fire-and-forget) after an internal notification is created.
 * Hooks receive the created notification and should handle their own errors.
 */
export function registerInternalNotificationHook(hook: InternalNotificationHook): void {
  postCreationHooks.push(hook);
}

export function runPostCreationHooks(notification: InternalNotification): void {
  for (const hook of postCreationHooks) {
    try {
      hook(notification);
    } catch (err) {
      console.error('[InternalNotification] Post-creation hook error:', err);
    }
  }
}
