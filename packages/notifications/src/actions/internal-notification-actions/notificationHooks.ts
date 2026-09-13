import type { InternalNotification } from "../../types/internalNotification";

/**
 * Post-creation hooks for internal notifications.
 * Allows external modules (e.g., push notifications) to react to newly
 * created notifications without modifying every call site.
 *
 * This file is intentionally NOT a "use server" module so that
 * exported functions are not constrained to be async Server Actions.
 * Because the actions barrel re-exports it into client components, it must
 * stay free of server-only imports (db/storage/co-managed) — the delivery
 * wrapper is injected by the server-only caller (notificationCreatedEffects)
 * instead of being imported here.
 */
export type InternalNotificationHook = (notification: InternalNotification) => void | Promise<void>;

/** Shape of lib/notificationDelivery's deliverCurrentNotification: renders the
 * hook against current shared-content authority and holds it until delivery
 * finishes. */
export type InternalNotificationDeliveryWrap = (
  notification: InternalNotification,
  deliver: (current: InternalNotification) => Promise<void>,
) => Promise<unknown>;

const postCreationHooks: InternalNotificationHook[] = [];

/**
 * Register a post-creation delivery hook. Async hooks must return their promise
 * so current shared-content authority remains locked until delivery finishes.
 */
export function registerInternalNotificationHook(hook: InternalNotificationHook): void {
  postCreationHooks.push(hook);
}

export async function runPostCreationHooks(
  notification: InternalNotification,
  deliverCurrent: InternalNotificationDeliveryWrap,
): Promise<void> {
  await Promise.all(postCreationHooks.map(async hook => {
    try {
      await deliverCurrent(notification, async current => { await hook(current); });
    } catch (err) {
      console.error('[InternalNotification] Post-creation hook error:', err);
    }
  }));
}
