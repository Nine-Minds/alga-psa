import { deliverCurrentNotification } from '../../lib/notificationDelivery';
import type { InternalNotification } from "../../types/internalNotification";

/**
 * Post-creation hooks for internal notifications.
 * Allows external modules (e.g., push notifications) to react to newly
 * created notifications without modifying every call site.
 *
 * This file is intentionally NOT a "use server" module so that
 * exported functions are not constrained to be async Server Actions.
 */
export type InternalNotificationHook = (notification: InternalNotification) => void | Promise<void>;

const postCreationHooks: InternalNotificationHook[] = [];

/**
 * Register a post-creation delivery hook. Async hooks must return their promise
 * so current shared-content authority remains locked until delivery finishes.
 */
export function registerInternalNotificationHook(hook: InternalNotificationHook): void {
  postCreationHooks.push(hook);
}

export async function runPostCreationHooks(notification: InternalNotification): Promise<void> {
  await Promise.all(postCreationHooks.map(async hook => {
    try {
      await deliverCurrentNotification(notification, async current => { await hook(current); });
    } catch (err) {
      console.error('[InternalNotification] Post-creation hook error:', err);
    }
  }));
}
