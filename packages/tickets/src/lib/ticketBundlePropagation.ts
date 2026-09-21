/**
 * Client-safe types and error for sync-mode bundle status propagation.
 *
 * Split into its own module so web/mobile/API surfaces can share the preview
 * shape and the confirmation error without importing the server-only
 * propagation engine (which reaches the database and Node async hooks).
 */

import type { CloseRuleBypassSource } from '@alga-psa/shared/lib/ticketCloseRules';
import type { TicketActivityActorInfo } from '@alga-psa/shared/lib/ticketActivity';

export type TicketBundleBoundary = 'close' | 'reopen';

export interface BundlePropagationChild {
  ticket_id: string;
  ticket_number: string | null;
  title: string | null;
  is_closed: boolean;
}

export type BundlePropagationUnaffectedReason =
  | 'already_closed'
  | 'independently_closed'
  | 'already_open';

export interface BundlePropagationUnaffectedChild extends BundlePropagationChild {
  reason: BundlePropagationUnaffectedReason;
}

export interface BundleStatusPropagationPreview {
  mode: 'sync_updates' | 'link_only';
  masterTicketId: string;
  newStatusId: string;
  crossesBoundary: TicketBundleBoundary | null;
  affectedChildren: BundlePropagationChild[];
  unaffectedChildren: BundlePropagationUnaffectedChild[];
}

/**
 * The acting user for a propagation, including the name fields the audit row
 * stores. These are required (nullable when the record genuinely has none) so a
 * caller cannot omit them and silently persist `Unknown User` instead of the
 * real display name; pass explicit nulls only when the user really has no name.
 */
export interface BundlePropagationUser {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
}

export interface BundleStatusPropagationContext {
  tenant: string;
  user: BundlePropagationUser;
  /** Attribution: system-triggered writes leave closed_by null and source=system. */
  isSystemActor?: boolean;
  /** Activity source for the propagated row; defaults to the UI. */
  source?: string;
  /** The master ticket's status before this update was applied. */
  previousMasterStatusId: string | null;
  /**
   * Set when the acting principal is a co-managed collaborator. A collaborator
   * is admitted to the master ticket only; a bundle-wide child write can reach
   * tickets it was never admitted to, so propagation is refused outright rather
   * than silently narrowed to the children it happens to be able to see.
   */
  collaborator?: boolean;
  /**
   * Actor attribution for the per-child TICKET_CLOSED / TICKET_REOPENED rows.
   * Falls back to the propagating user when omitted.
   */
  actor?: TicketActivityActorInfo;
}

export interface PropagateBundleMasterStatusOptions {
  propagateToChildren?: boolean;
  /**
   * Close-rule handling for children closed by propagation. Children are real
   * tickets: a propagated close must clear the same board close rules a direct
   * close would, and honour the same operator override/bypass.
   */
  overrideCloseRules?: { requested: boolean; reason: string | null; user: unknown };
  bypassCloseRules?: { source: CloseRuleBypassSource } | undefined;
}

export interface PropagateBundleMasterStatusResult {
  propagated: boolean;
  action: TicketBundleBoundary | null;
  affectedChildIds: string[];
}

/**
 * Thrown by the server write path when a status change on a sync-mode bundle
 * master would close or reopen children and the caller has not chosen whether
 * to propagate. Nothing is written when this is thrown; the caller retries with
 * `propagateToChildren: true | false`.
 */
export class BundlePropagationConfirmationRequiredError extends Error {
  readonly preview: BundleStatusPropagationPreview;
  /** Alias so generic error serializers can read `.details`. */
  readonly details: BundleStatusPropagationPreview;

  constructor(preview: BundleStatusPropagationPreview) {
    super(
      'This bundle master is in sync mode and the status change would close or reopen child tickets. Pass propagateToChildren to choose.',
    );
    this.name = 'BundlePropagationConfirmationRequiredError';
    this.preview = preview;
    this.details = preview;
  }
}
