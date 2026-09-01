import type { InternalNotificationPriority } from '../../types/internalNotification';

/**
 * Pure priority-resolution helpers for configurable notification priorities
 * (task 29.8.46).
 *
 * This file is intentionally NOT a "use server" module so the helpers can be
 * imported directly (and unit-tested) without being registered as async
 * Server Actions.
 */

const VALID_PRIORITIES: ReadonlySet<string> = new Set(['high', 'normal', 'low']);

/** Narrow an unknown DB value to a valid priority, or null. */
export function asPriority(value: unknown): InternalNotificationPriority | null {
  return typeof value === 'string' && VALID_PRIORITIES.has(value)
    ? (value as InternalNotificationPriority)
    : null;
}

/**
 * Precedence for the resolved notification priority (the user's choice always
 * wins — it is their attention):
 *   user override ?? tenant override ?? subtype default ?? 'normal'.
 */
export function pickNotificationPriority(
  userPriority: unknown,
  tenantPriority: unknown,
  subtypeDefault: unknown
): InternalNotificationPriority {
  return (
    asPriority(userPriority) ??
    asPriority(tenantPriority) ??
    asPriority(subtypeDefault) ??
    'normal'
  );
}
