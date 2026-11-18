/**
 * Single rule for when a bundled child's workflow fields are locked.
 *
 * Pure on purpose (no DB, no React): the server action, the REST service, the
 * ticket-detail UI and the mobile app all import this module, so the lock can
 * never drift between surfaces.
 *
 * Only a `sync_updates` master pushes status/assignee/priority down to its
 * children, so only then are the children's own workflow fields locked. A
 * `link_only` child manages its own workflow fields.
 */

export type BundleWorkflowMode = 'link_only' | 'sync_updates';

/** The fields a locked bundled child cannot change directly. */
export const BUNDLE_CHILD_LOCKED_FIELDS = ['status_id', 'assigned_to', 'priority_id'] as const;

export type BundleChildLockedField = (typeof BUNDLE_CHILD_LOCKED_FIELDS)[number];

/** Minimal shape of a `ticket_bundle_settings` row (or the API's bundle settings). */
export type BundleSettingsLike = { mode?: string | null } | null | undefined;

/**
 * A master with no settings row, or a row with a null mode, is `link_only`.
 */
export function effectiveBundleMode(settings: BundleSettingsLike): BundleWorkflowMode {
  return settings?.mode === 'sync_updates' ? 'sync_updates' : 'link_only';
}

/**
 * True only when the ticket is a bundled child and its master's effective mode
 * is `sync_updates`.
 */
export function isChildWorkflowLocked(params: {
  isBundledChild: boolean;
  masterSettings: BundleSettingsLike;
}): boolean {
  return params.isBundledChild && effectiveBundleMode(params.masterSettings) === 'sync_updates';
}
