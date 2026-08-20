/**
 * Device-sync interval bounds, in one place because four callers need them and
 * three of them cannot reach the others: rmmIntegrationStatus pulls in the
 * database layer (so no 'use client' component may import it), the actions
 * module carries 'use server' (so it may only export async functions), and the
 * jobs package sits outside this one entirely.
 *
 * This module deliberately has no imports, which is what lets the settings UI,
 * the v1 API route, and the scheduled-sync reconciler all share a single
 * definition instead of hand-syncing copies.
 */

/** The reconciler clamps to these; callers must not offer what the server will not honour. */
export const DEVICE_SYNC_MIN_MINUTES = 15;
export const DEVICE_SYNC_MAX_MINUTES = 1440;
export const DEVICE_SYNC_DEFAULT_MINUTES = 60;
