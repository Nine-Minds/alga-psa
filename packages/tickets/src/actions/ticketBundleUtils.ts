'use server';

import type { Knex } from 'knex';
import { registerAfterCommit, tenantDb } from '@alga-psa/db';
import { v4 as uuidv4 } from 'uuid';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing/lifecycle';
import { recordCoManagedTicketReopened, recordCoManagedTicketResolution } from '@alga-psa/co-managed';
import { prepareTicketResourceReassignment } from '@alga-psa/db/reassignTicketResources';
import {
  getBoardCloseRulesRow,
  openBundleChildrenCount,
} from '@alga-psa/shared/lib/ticketCloseRules';
import {
  TICKET_ACTIVITY_ACTOR,
  TICKET_ACTIVITY_ENTITY,
  TICKET_ACTIVITY_EVENT,
  TICKET_ACTIVITY_SOURCE,
  writeTicketActivity,
  type TicketActivityActorInfo,
  type TicketActivitySource,
} from '@alga-psa/shared/lib/ticketActivity';
import { diffTicketFields, publishTicketUpdate } from '../lib/liveUpdates';
import {
  BundlePropagationConfirmationRequiredError,
  type BundlePropagationChild,
  type BundlePropagationUnaffectedChild,
  type BundlePropagationUser,
  type BundleStatusPropagationContext,
  type BundleStatusPropagationPreview,
  type PropagateBundleMasterStatusOptions,
  type PropagateBundleMasterStatusResult,
  type TicketBundleBoundary,
} from '../lib/ticketBundlePropagation';
import {
  enforceTicketCloseRules,
  TicketCloseValidationError,
} from '../lib/validateTicketClosure';
import type { CloseRuleFailure } from '../lib/closeRuleConstants';
import { buildTicketTransitionWorkflowEvents } from '../lib/workflowTicketTransitionEvents';
import { buildTicketResolutionSlaStageCompletionEvent } from '../lib/workflowTicketSlaStageEvents';
import {
  BundleConcurrentModificationError,
  resolveClosedMasterChoices,
  type ClosedMasterChoice,
} from '../lib/ticketBundlePolicy';

export type BundleMode = 'link_only' | 'sync_updates';

function nowIso() {
  return new Date().toISOString();
}

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

/**
 * The open status to move a master to, scoped to the master's own board.
 * A tenant-wide "first open ticket status" can belong to a different board
 * entirely, which would move the master onto a status its board does not
 * offer. `status_id` breaks ties so concurrent child replies agree on one
 * answer, and the share lock holds the row for the rest of the transaction.
 */
async function findOpenTicketStatusId(trx: Knex.Transaction, tenant: string, boardId: string): Promise<string | null> {
  const row = await tenantScopedTable(trx, 'statuses', tenant)
    .select('status_id')
    .where({ is_closed: false, board_id: boardId })
    .andWhere(function () {
      this.where('item_type', 'ticket').orWhere('status_type', 'ticket');
    })
    .orderBy('is_default', 'desc')
    .orderBy('order_number', 'asc')
    .orderBy('status_id')
    .forShare().first();
  return row?.status_id ?? null;
}

export async function findDefaultOpenTicketStatusId(
  trx: Knex.Transaction,
  tenant: string
): Promise<string | null> {
  const row = await tenantScopedTable(trx, 'statuses', tenant)
    .select('status_id')
    .where({ is_closed: false })
    .andWhere(function () {
      this.where('item_type', 'ticket').orWhere('status_type', 'ticket');
    })
    .orderBy('is_default', 'desc')
    .orderBy('order_number', 'asc')
    .first();
  return row?.status_id ?? null;
}

export type BundleResolutionComment = {
  comment_id: string;
  note: string | null;
  markdown_content: string | null;
  created_at: string;
  is_resolution: boolean;
  user_id?: string | null;
  contact_id?: string | null;
  author_type?: string | null;
};

export type BundleMasterClosedContext = {
  isClosed: boolean;
  statusId: string | null;
  statusName: string | null;
  boardId: string | null;
  requireNoOpenChildren: boolean;
  allowedChoices: ClosedMasterChoice[];
  resolutionComment: BundleResolutionComment | null;
  openChildrenCount: number;
};

/**
 * Reads everything the UI and the engine need to apply the closed-master
 * policy: whether the master is closed, the status it would impose on a
 * child, the board close rule that gates `keep_closed`, the master's latest
 * public resolution comment, and the number of open children.
 */
export async function getBundleMasterClosedContext(
  trx: Knex.Transaction,
  tenant: string,
  masterTicketId: string
): Promise<BundleMasterClosedContext | null> {
  const master = await tenantDb(trx, tenant)
    .tenantJoin(
      tenantScopedTable(trx, 'tickets as t', tenant),
      'statuses as s',
      't.status_id',
      's.status_id',
      { type: 'left' }
    )
    .select('t.ticket_id', 't.status_id', 't.board_id', 's.name as status_name', 's.is_closed')
    .where({ 't.ticket_id': masterTicketId })
    .first();

  if (!master) return null;

  const rules = master.board_id
    ? await getBoardCloseRulesRow(trx, tenant, master.board_id)
    : undefined;
  const requireNoOpenChildren = Boolean(rules?.is_enabled && rules?.require_no_open_children);

  const [openChildren, resolutionComment] = await Promise.all([
    openBundleChildrenCount(trx, tenant, masterTicketId),
    tenantScopedTable(trx, 'comments as c', tenant)
      .select(
        'c.comment_id',
        'c.note',
        'c.markdown_content',
        'c.created_at',
        'c.is_resolution',
        'c.user_id',
        'c.contact_id',
        'c.author_type'
      )
      .where({ 'c.ticket_id': masterTicketId, 'c.is_internal': false })
      .andWhere(function resolutionMarkers() {
        this.where('c.is_resolution', true).orWhereRaw("c.metadata->>'closes_ticket' = 'true'");
      })
      .orderBy('c.created_at', 'desc')
      .first(),
  ]);

  const isClosed = Boolean(master.is_closed);
  return {
    isClosed,
    statusId: master.status_id ?? null,
    statusName: master.status_name ?? null,
    boardId: master.board_id ?? null,
    requireNoOpenChildren,
    allowedChoices: resolveClosedMasterChoices({ isClosed, requireNoOpenChildren }),
    resolutionComment: (resolutionComment as BundleResolutionComment | undefined) ?? null,
    openChildrenCount: openChildren,
  };
}

export type ReopenBundleMasterOptions = {
  actor: TicketActivityActorInfo;
  source: TicketActivitySource | string;
  trigger: string;
  /** Overrides the activity event type. Defaults to TICKET_BUNDLE_REOPENED. */
  eventType?: string;
  openStatusId?: string | null;
  details?: Record<string, unknown>;
};

export type ReopenBundleMasterResult = {
  reopened: boolean;
  previousStatusId: string | null;
  newStatusId: string | null;
  reopenedAt: string | null;
};

/**
 * Reopens exactly the master row. Deliberately bypasses updateTicketWithCache:
 * its sync_updates block propagates status/closed_at/closed_by to every child,
 * which would silently reopen already-closed siblings. The row update and
 * activity write are lifted verbatim from the original child-reply reopen so
 * that path keeps its behaviour.
 */
export async function reopenBundleMasterOnly(
  trx: Knex.Transaction,
  tenant: string,
  masterTicketId: string,
  options: ReopenBundleMasterOptions
): Promise<ReopenBundleMasterResult> {
  const openStatusId =
    options.openStatusId ?? (await findDefaultOpenTicketStatusId(trx, tenant));
  if (!openStatusId) {
    return { reopened: false, previousStatusId: null, newStatusId: null, reopenedAt: null };
  }

  const master = await tenantScopedTable(trx, 'tickets', tenant)
    .select('ticket_id', 'status_id', 'closed_at')
    .where({ ticket_id: masterTicketId })
    .first();
  if (!master) {
    return { reopened: false, previousStatusId: null, newStatusId: null, reopenedAt: null };
  }

  const previousStatusId: string | null = master.status_id ?? null;
  const reopenedAt = nowIso();
  const actorUserId = options.actor.userId ?? null;

  // Keep the denormalized `is_closed` column on tickets in sync with the
  // open status we're moving to — mirrors how updateTicketWithCache flips
  // is_closed when the status transitions across the closed boundary.
  await tenantScopedTable(trx, 'tickets', tenant)
    .where({ ticket_id: masterTicketId })
    .update({
      status_id: openStatusId,
      is_closed: false,
      closed_at: null,
      closed_by: null,
      updated_by: actorUserId,
      updated_at: reopenedAt,
    });

  // Every genuine closed-to-open mutation of a co-managed master has to settle
  // the SLA obligation, and after this extraction there are two of them: the
  // child-reply path and applyClosedMasterChoice's reopen_master branch. It
  // reads the ticket's *current* status, so it has to run after the update, and
  // it no-ops unless the ticket carries a retained MSP-responsible obligation
  // that had already been resolved.
  await recordCoManagedTicketReopened(trx, tenant, masterTicketId);

  await writeTicketActivity(trx, {
    tenant,
    ticketId: masterTicketId,
    eventType: options.eventType ?? TICKET_ACTIVITY_EVENT.BUNDLE_REOPENED,
    entityType: TICKET_ACTIVITY_ENTITY.TICKET,
    entityId: masterTicketId,
    actor: options.actor,
    source: options.source,
    occurredAt: reopenedAt,
    changes: {
      status_id: { old: previousStatusId, new: openStatusId },
      closed_at: { old: master.closed_at ?? null, new: null },
    },
    details: {
      reopen_trigger: options.trigger,
      ...(options.details ?? {}),
    },
  });

  return { reopened: true, previousStatusId, newStatusId: openStatusId, reopenedAt };
}

export async function maybeReopenBundleMasterFromChildReply(
  trx: Knex.Transaction,
  tenant: string,
  childTicketId: string,
  updatedByUserId: string | null
): Promise<{ reopened: boolean; masterTicketId: string | null }> {
  await assertCoManagedOperationalWrite(trx, tenant);
  const child = await tenantScopedTable(trx, 'tickets', tenant)
    .select('ticket_id', 'master_ticket_id')
    .where({ ticket_id: childTicketId })
    .forShare().first();

  const masterTicketId = child?.master_ticket_id ?? null;
  if (!masterTicketId) {
    return { reopened: false, masterTicketId: null };
  }

  // Lock the master before its settings, matching bundle mutation ordering.
  // Read its status only after retaining the row: concurrent child replies must
  // not both infer a closed-to-open transition from an earlier join snapshot.
  const master = await tenantScopedTable(trx, 'tickets', tenant)
    .select('ticket_id', 'board_id', 'status_id', 'closed_at')
    .where({ ticket_id: masterTicketId }).forUpdate().first();
  if (!master?.board_id) return { reopened: false, masterTicketId };
  const status = await tenantScopedTable(trx, 'statuses', tenant)
    .where({ status_id: master.status_id }).forShare().first('is_closed');
  if (!status?.is_closed) return { reopened: false, masterTicketId };

  const settings = await tenantScopedTable(trx, 'ticket_bundle_settings', tenant)
    .select('reopen_on_child_reply')
    .where({ master_ticket_id: masterTicketId })
    .forShare().first();
  if (!settings?.reopen_on_child_reply) return { reopened: false, masterTicketId };

  const openStatusId = await findOpenTicketStatusId(trx, tenant, master.board_id);
  if (!openStatusId) {
    return { reopened: false, masterTicketId };
  }

  const result = await reopenBundleMasterOnly(trx, tenant, masterTicketId, {
    actor: {
      actorType: TICKET_ACTIVITY_ACTOR.SYSTEM,
      userId: updatedByUserId ?? null,
    },
    source: TICKET_ACTIVITY_SOURCE.SYSTEM,
    trigger: 'child_reply',
    eventType: TICKET_ACTIVITY_EVENT.BUNDLE_REOPENED,
    openStatusId,
    details: { child_ticket_id: childTicketId },
  });

  await assertCoManagedOperationalWrite(trx, tenant);
  return { reopened: result.reopened, masterTicketId };
}

export type MirrorCommentSource = {
  comment_id: string;
  note: string | null;
  markdown_content: string | null;
  user_id?: string | null;
  contact_id?: string | null;
  author_type?: string | null;
};

/**
 * Mirrors one comment onto a bundled child as a public, system-generated,
 * immutable comment in its own thread, and records the mapping in
 * ticket_bundle_mirrors. Idempotent on (source_comment_id, child_ticket_id):
 * returns null when a mirror already exists. Shared with addTicketComment's
 * sync_updates loop so the mirrored shape is defined once.
 */
export async function mirrorCommentToChild(
  trx: Knex.Transaction,
  tenant: string,
  params: {
    sourceComment: MirrorCommentSource;
    childTicketId: string;
    isResolution: boolean;
  }
): Promise<string | null> {
  const { sourceComment, childTicketId, isResolution } = params;

  const existingMirror = await tenantScopedTable(trx, 'ticket_bundle_mirrors', tenant)
    .where({
      source_comment_id: sourceComment.comment_id,
      child_ticket_id: childTicketId,
    })
    .first();
  if (existingMirror) {
    return null;
  }

  const now = new Date().toISOString();
  const childIds = await trx.raw(
    'SELECT gen_random_uuid() AS comment_id, gen_random_uuid() AS thread_id'
  );
  const childGenerated = childIds.rows?.[0] as
    | { comment_id: string; thread_id: string }
    | undefined;
  if (!childGenerated?.comment_id || !childGenerated?.thread_id) {
    throw new Error('Database UUID generation did not return mirrored comment/thread identifiers.');
  }

  await tenantDb(trx, tenant).table('comment_threads').insert({
    tenant,
    thread_id: childGenerated.thread_id,
    ticket_id: childTicketId,
    project_task_id: null,
    root_comment_id: childGenerated.comment_id,
    is_internal: false,
    reply_count: 0,
    last_activity_at: now,
    created_at: now,
    created_by: sourceComment.user_id ?? null,
  });

  await tenantDb(trx, tenant).table('comments').insert({
    tenant,
    comment_id: childGenerated.comment_id,
    thread_id: childGenerated.thread_id,
    ticket_id: childTicketId,
    user_id: sourceComment.user_id ?? null,
    contact_id: sourceComment.contact_id ?? null,
    author_type: sourceComment.author_type ?? 'unknown',
    note: sourceComment.note,
    is_internal: false,
    is_resolution: isResolution,
    is_system_generated: true,
    markdown_content: sourceComment.markdown_content,
    created_at: now,
  });

  await tenantDb(trx, tenant).table('ticket_bundle_mirrors')
    .insert({
      tenant,
      source_comment_id: sourceComment.comment_id,
      child_ticket_id: childTicketId,
      child_comment_id: childGenerated.comment_id,
    })
    .onConflict()
    .ignore();

  return childGenerated.comment_id;
}

export type BundleAfterCommitPublication = {
  eventType: string;
  payload: Record<string, unknown>;
  eventName?: string;
  fromState?: string;
  toState?: string;
  idempotencyKey?: string;
};

/**
 * The child-row fields the apply_resolution consequence needs to mirror the
 * canonical close: the previous status for the activity diff, the previous
 * response state (cleared on close), and the ITIL priority/entered_at that
 * drive the SLA resolution stage completion event.
 */
export type BundleChildCloseSnapshot = {
  status_id: string | null;
  response_state: string | null;
  itil_priority_level: number | null;
  entered_at: string | null;
};

export type ApplyClosedMasterChoiceParams = {
  master: BundleMasterClosedContext & { masterTicketId: string; openStatusId?: string | null };
  childTicketIds: string[];
  childSnapshots: Map<string, BundleChildCloseSnapshot>;
  choice: ClosedMasterChoice;
  actor: TicketActivityActorInfo;
  source: TicketActivitySource | string;
  occurredAt: string;
};

/**
 * Performs the chosen closed-master consequence inside the caller's
 * transaction. Returns the events that must be published after commit; the
 * caller registers them with registerAfterCommit using its own publisher.
 */
export async function applyClosedMasterChoice(
  trx: Knex.Transaction,
  tenant: string,
  params: ApplyClosedMasterChoiceParams
): Promise<BundleAfterCommitPublication[]> {
  const { master, childTicketIds, childSnapshots, choice, actor, source, occurredAt } = params;
  const publications: BundleAfterCommitPublication[] = [];

  if (choice === 'keep_closed') {
    return publications;
  }

  if (choice === 'apply_resolution') {
    for (const childTicketId of childTicketIds) {
      const snapshot = childSnapshots.get(childTicketId);
      const previousStatusId = snapshot?.status_id ?? null;
      const previousResponseState = snapshot?.response_state ?? null;

      await tenantScopedTable(trx, 'tickets', tenant)
        .where({ ticket_id: childTicketId })
        .update({
          status_id: master.statusId,
          is_closed: true,
          closed_at: occurredAt,
          closed_by: actor.userId ?? null,
          // Mirrors the canonical human close: a ticket that was awaiting the
          // client must never reload as closed-but-awaiting. A child that just
          // received the mirrored resolution is exactly that case.
          response_state: null,
          updated_by: actor.userId ?? null,
          updated_at: occurredAt,
        });

      await writeTicketActivity(trx, {
        tenant,
        ticketId: childTicketId,
        eventType: TICKET_ACTIVITY_EVENT.CLOSED,
        entityType: TICKET_ACTIVITY_ENTITY.TICKET,
        entityId: childTicketId,
        actor,
        source,
        occurredAt,
        changes: {
          status_id: { old: previousStatusId, new: master.statusId, newLabel: master.statusName },
          closed_at: { old: null, new: occurredAt },
          closed_by: { old: null, new: actor.userId ?? null },
          ...(previousResponseState !== null
            ? { response_state: { old: previousResponseState, new: null } }
            : {}),
        },
        details: {
          closed_master_choice: 'apply_resolution',
          master_ticket_id: master.masterTicketId,
        },
      });

      if (master.resolutionComment) {
        await mirrorCommentToChild(trx, tenant, {
          sourceComment: master.resolutionComment,
          childTicketId,
          isResolution: true,
        });
      }

      publications.push({
        eventType: 'TICKET_CLOSED',
        payload: {
          ticketId: childTicketId,
          ...(actor.userId ? { userId: actor.userId, closedByUserId: actor.userId } : {}),
          closedAt: occurredAt,
          changes: {
            status_id: { old: previousStatusId, new: master.statusId },
            closed_at: { old: null, new: occurredAt },
            closed_by: { old: null, new: actor.userId ?? null },
          },
        },
        eventName: 'Ticket Closed',
        fromState: previousStatusId ?? undefined,
        toState: master.statusId ?? undefined,
      });

      // The canonical close path also records the resolution SLA stage
      // outcome; child closes must do the same so the child's own SLA clock is
      // resolved through the normal subscribers.
      const slaCompletionEvent = buildTicketResolutionSlaStageCompletionEvent({
        tenantId: tenant,
        ticketId: childTicketId,
        itilPriorityLevel: snapshot?.itil_priority_level ?? null,
        enteredAt: snapshot?.entered_at ?? null,
        closedAt: occurredAt,
      });
      if (slaCompletionEvent) {
        publications.push({
          eventType: slaCompletionEvent.eventType,
          payload: slaCompletionEvent.payload,
          idempotencyKey: slaCompletionEvent.idempotencyKey,
        });
      }
    }
    return publications;
  }

  // reopen_master
  const reopenResult = await reopenBundleMasterOnly(trx, tenant, master.masterTicketId, {
    actor,
    source,
    trigger: 'add_child',
    eventType: TICKET_ACTIVITY_EVENT.REOPENED,
    openStatusId: master.openStatusId ?? null,
  });

  if (reopenResult.reopened && reopenResult.previousStatusId && reopenResult.newStatusId) {
    publications.push({
      eventType: 'TICKET_UPDATED',
      payload: {
        ticketId: master.masterTicketId,
        ...(actor.userId ? { userId: actor.userId, updatedByUserId: actor.userId } : {}),
        changes: {
          status_id: { old: reopenResult.previousStatusId, new: reopenResult.newStatusId },
        },
      },
      eventName: 'Ticket Updated',
    });

    const transition = buildTicketTransitionWorkflowEvents({
      before: {
        ticketId: master.masterTicketId,
        statusId: reopenResult.previousStatusId,
        priorityId: null,
        assignedTo: null,
        boardId: master.boardId ?? '',
      },
      after: {
        ticketId: master.masterTicketId,
        statusId: reopenResult.newStatusId,
        priorityId: null,
        assignedTo: null,
        boardId: master.boardId ?? '',
      },
      ctx: {
        occurredAt,
        actorUserId: actor.userId ?? undefined,
        previousStatusIsClosed: true,
        newStatusIsClosed: false,
      },
    }).find((event) => event.eventType === 'TICKET_REOPENED');

    if (transition) {
      publications.push({
        eventType: transition.eventType,
        payload: transition.payload,
        eventName: transition.workflow?.eventName,
        fromState: transition.workflow?.fromState,
        toState: transition.workflow?.toState,
      });
    }
  }

  return publications;
}

export type BundleAttachFailureCode =
  | 'master_not_found'
  | 'child_not_found'
  | 'master_is_child'
  | 'already_bundled'
  | 'children_are_masters'
  | 'choice_required'
  | 'choice_not_allowed'
  | 'choice_on_open_master'
  | 'close_rule_failed'
  | 'reopen_unavailable'
  | 'no_children';

export type BundleAttachFailure = {
  ok: false;
  code: BundleAttachFailureCode;
  childTicketId?: string;
  childTicketNumber?: string | null;
  ticketNumbers?: string[];
  allowedChoices?: ClosedMasterChoice[];
  closeRuleFailures?: CloseRuleFailure[];
};

export type BundleAttachSuccess = {
  ok: true;
  value: {
    masterTicketId: string;
    childTicketIds: string[];
    mode?: BundleMode;
    publications: BundleAfterCommitPublication[];
  };
};

export type BundleAttachResult = BundleAttachSuccess | BundleAttachFailure;

export type AttachChildrenParams = {
  masterTicketId: string;
  childTicketIds: string[];
  /** When set, upserts ticket_bundle_settings for the master (create path). */
  mode?: BundleMode;
  choice?: ClosedMasterChoice | null;
  actor: TicketActivityActorInfo;
  source?: TicketActivitySource | string;
  occurredAt?: string;
  mergedReason?: string;
};

type BundleTicketRow = {
  ticket_id: string;
  ticket_number?: string | null;
  master_ticket_id?: string | null;
  status_id?: string | null;
  board_id?: string | null;
  response_state?: string | null;
  itil_priority_level?: number | null;
  entered_at?: string | null;
};

async function findBundleMasterIds(
  trx: Knex.Transaction,
  tenant: string,
  ticketIds: string[]
): Promise<string[]> {
  if (ticketIds.length === 0) return [];
  const rows = await tenantScopedTable(trx, 'tickets', tenant)
    .distinct('master_ticket_id')
    .whereIn('master_ticket_id', ticketIds);
  return rows.map((row: any) => row.master_ticket_id).filter(Boolean);
}

/**
 * The single attach engine. All four attach surfaces (two server actions, two
 * TicketService methods) call this so the closed-master policy, invariant
 * checks, and consequence writes live in one place. Returns a discriminated
 * result with stable failure codes; callers map codes to their own error type.
 */
export async function attachChildrenToBundle(
  trx: Knex.Transaction,
  tenant: string,
  params: AttachChildrenParams
): Promise<BundleAttachResult> {
  const occurredAt = params.occurredAt ?? nowIso();
  const source = params.source ?? TICKET_ACTIVITY_SOURCE.UI;
  const childIds = Array.from(new Set(params.childTicketIds)).filter(
    (id) => id !== params.masterTicketId
  );
  if (childIds.length === 0) {
    return { ok: false, code: 'no_children' };
  }

  const master = (await tenantScopedTable(trx, 'tickets', tenant)
    .select('ticket_id', 'master_ticket_id')
    .where({ ticket_id: params.masterTicketId })
    .first()) as BundleTicketRow | undefined;
  if (!master) {
    return { ok: false, code: 'master_not_found' };
  }
  if (master.master_ticket_id) {
    return { ok: false, code: 'master_is_child' };
  }

  const children = (await tenantScopedTable(trx, 'tickets', tenant)
    .select(
      'ticket_id',
      'ticket_number',
      'master_ticket_id',
      'status_id',
      'board_id',
      'category_id',
      'subcategory_id',
      'priority_id',
      'assigned_to',
      'response_state',
      'itil_priority_level',
      'entered_at'
    )
    .whereIn('ticket_id', childIds)) as BundleTicketRow[];
  const byId = new Map<string, BundleTicketRow>(children.map((row) => [row.ticket_id, row]));
  for (const childId of childIds) {
    const child = byId.get(childId);
    if (!child) {
      return { ok: false, code: 'child_not_found', childTicketId: childId };
    }
    if (child.master_ticket_id) {
      return {
        ok: false,
        code: 'already_bundled',
        childTicketId: childId,
        childTicketNumber: child.ticket_number ?? null,
      };
    }
  }

  const offendingMasterIds = await findBundleMasterIds(trx, tenant, childIds);
  if (offendingMasterIds.length > 0) {
    const rows = await tenantScopedTable(trx, 'tickets', tenant)
      .select('ticket_number')
      .whereIn('ticket_id', offendingMasterIds);
    const ticketNumbers = rows
      .map((row: any) => row.ticket_number)
      .filter((n: unknown): n is string => typeof n === 'string' && n.length > 0);
    return { ok: false, code: 'children_are_masters', ticketNumbers };
  }

  const context = await getBundleMasterClosedContext(trx, tenant, params.masterTicketId);
  if (!context) {
    return { ok: false, code: 'master_not_found' };
  }

  const choice = params.choice ?? null;
  if (context.isClosed) {
    if (!choice) {
      return { ok: false, code: 'choice_required', allowedChoices: context.allowedChoices };
    }
    if (!context.allowedChoices.includes(choice)) {
      return { ok: false, code: 'choice_not_allowed', allowedChoices: context.allowedChoices };
    }
  } else if (choice) {
    return { ok: false, code: 'choice_on_open_master' };
  }

  // Pre-write validation for apply_resolution: enforce each child's board
  // close rules exactly as a human close. Failures must abort before any
  // write so a returned failure leaves nothing behind.
  if (context.isClosed && choice === 'apply_resolution') {
    for (const childId of childIds) {
      const child = byId.get(childId)!;
      try {
        await enforceTicketCloseRules(trx, tenant, {
          ticket: {
            ticket_id: childId,
            board_id: child.board_id ?? null,
            category_id: (child as any).category_id ?? null,
            subcategory_id: (child as any).subcategory_id ?? null,
            priority_id: (child as any).priority_id ?? null,
            assigned_to: (child as any).assigned_to ?? null,
          },
          actor: params.actor,
          source,
        });
      } catch (error) {
        if (error instanceof TicketCloseValidationError) {
          return {
            ok: false,
            code: 'close_rule_failed',
            childTicketId: childId,
            closeRuleFailures: error.failures,
          };
        }
        throw error;
      }
    }
  }

  let openStatusId: string | null = null;
  if (context.isClosed && choice === 'reopen_master') {
    openStatusId = await findDefaultOpenTicketStatusId(trx, tenant);
    if (!openStatusId) {
      return { ok: false, code: 'reopen_unavailable' };
    }
  }

  const updatedChildrenCount = await tenantScopedTable(trx, 'tickets', tenant)
    .whereIn('ticket_id', childIds)
    .whereNull('master_ticket_id')
    .update({
      master_ticket_id: params.masterTicketId,
      updated_by: params.actor.userId ?? null,
      updated_at: occurredAt,
    });
  if (updatedChildrenCount !== childIds.length) {
    throw new BundleConcurrentModificationError();
  }

  if (params.mode) {
    await tenantScopedTable(trx, 'ticket_bundle_settings', tenant)
      .insert({
        tenant,
        master_ticket_id: params.masterTicketId,
        mode: params.mode,
        reopen_on_child_reply: false,
      })
      .onConflict(['tenant', 'master_ticket_id'])
      .merge({ mode: params.mode });
  }

  const closedMasterChoice = context.isClosed ? choice : null;
  for (const childId of childIds) {
    await writeTicketActivity(trx, {
      tenant,
      ticketId: childId,
      eventType: TICKET_ACTIVITY_EVENT.BUNDLE_CHILD_ADDED,
      entityType: TICKET_ACTIVITY_ENTITY.TICKET,
      entityId: childId,
      actor: params.actor,
      source,
      occurredAt,
      details: {
        master_was_closed: context.isClosed,
        closed_master_choice: closedMasterChoice,
        child_ticket_id: childId,
        master_ticket_id: params.masterTicketId,
      },
    });
  }
  await writeTicketActivity(trx, {
    tenant,
    ticketId: params.masterTicketId,
    eventType: TICKET_ACTIVITY_EVENT.BUNDLE_CHILD_ADDED,
    entityType: TICKET_ACTIVITY_ENTITY.TICKET,
    entityId: params.masterTicketId,
    actor: params.actor,
    source,
    occurredAt,
    details: {
      master_was_closed: context.isClosed,
      closed_master_choice: closedMasterChoice,
      child_ticket_ids: childIds,
      master_ticket_id: params.masterTicketId,
    },
  });

  const publications: BundleAfterCommitPublication[] = childIds.map((childId) => ({
    eventType: 'TICKET_MERGED',
    payload: {
      sourceTicketId: childId,
      targetTicketId: params.masterTicketId,
      mergedAt: occurredAt,
      reason: params.mergedReason ?? 'bundle:added_children',
    },
    eventName: 'Ticket Merged',
  }));

  if (context.isClosed && choice && choice !== 'keep_closed') {
    const childSnapshots = new Map<string, BundleChildCloseSnapshot>(
      childIds.map((childId) => {
        const child = byId.get(childId);
        return [
          childId,
          {
            status_id: child?.status_id ?? null,
            response_state: child?.response_state ?? null,
            itil_priority_level: child?.itil_priority_level ?? null,
            entered_at: child?.entered_at ?? null,
          },
        ];
      })
    );
    const consequencePublications = await applyClosedMasterChoice(trx, tenant, {
      master: { ...context, masterTicketId: params.masterTicketId, openStatusId },
      childTicketIds: childIds,
      childSnapshots,
      choice,
      actor: params.actor,
      source,
      occurredAt,
    });
    publications.push(...consequencePublications);
  }

  return {
    ok: true,
    value: {
      masterTicketId: params.masterTicketId,
      childTicketIds: childIds,
      mode: params.mode,
      publications,
    },
  };
}

interface DerivedBundleChildRow {
  ticket_id: string;
  ticket_number: string | null;
  title: string | null;
  status_id: string | null;
  is_closed: boolean;
  assigned_to: string | null;
  priority_id: string | null;
  closed_at: string | null;
  closed_by: string | null;
  propagation_id: string | null;
  // Close-rule inputs: a propagated close must clear the same board rules a
  // direct close would, so the child's own routing fields travel with it.
  board_id: string | null;
  category_id: string | null;
  subcategory_id: string | null;
}

function propagationDisplayName(user: BundlePropagationUser): string {
  return `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username || 'Unknown User';
}

async function readStatusIsClosed(
  trx: Knex.Transaction,
  tenant: string,
  statusId: string | null | undefined
): Promise<boolean | null> {
  if (!statusId) return null;
  const row = await tenantScopedTable(trx, 'statuses', tenant)
    .select('is_closed')
    .where({ status_id: statusId })
    .first();
  return row ? Boolean(row.is_closed) : null;
}

async function readStatusBoardId(
  trx: Knex.Transaction,
  tenant: string,
  statusId: string | null | undefined
): Promise<string | null> {
  if (!statusId) return null;
  const row = await tenantScopedTable(trx, 'statuses', tenant)
    .select('board_id')
    .where({ status_id: statusId })
    .first();
  return row ? ((row.board_id as string | null) ?? null) : null;
}

/**
 * A co-managed collaborator is admitted to the master ticket, not to the
 * bundle. Propagating its status would write rows on children the collaborator
 * may never have been admitted to, so the whole edit is refused rather than
 * silently narrowed to the visible children. Called before any child write on
 * either propagation path.
 */
function assertBundlePropagationAuthority(ctx: BundleStatusPropagationContext): void {
  if (ctx.collaborator) {
    throw new Error('Shared bundle workflow edits require authority for every child ticket');
  }
}

/**
 * One tenant-scoped read of the master's children, left-joining each child's
 * active propagation row from this master. "Child is closed" is read from the
 * denormalized `tickets.is_closed` column (the authoritative close state the
 * write paths maintain) rather than the board status's `is_closed` flag, so an
 * independently closed child is never dragged back into the affected set by a
 * non-boundary master status stamp. The affected/unaffected split is derived
 * from this in memory.
 */
async function deriveBundleChildren(
  trx: Knex.Transaction,
  tenant: string,
  masterId: string
): Promise<DerivedBundleChildRow[]> {
  const db = tenantDb(trx, tenant);
  const withPropagation = db.tenantJoin(
    tenantScopedTable(trx, 'tickets as t', tenant),
    'ticket_bundle_status_propagations as p',
    'p.child_ticket_id',
    't.ticket_id',
    {
      type: 'left',
      on: (join) => {
        join.andOnVal('p.master_ticket_id', '=', masterId);
        join.andOnNull('p.reverted_at');
      },
    }
  );

  const rows = await withPropagation
    .select(
      't.ticket_id',
      't.ticket_number',
      't.title',
      't.status_id',
      't.assigned_to',
      't.priority_id',
      't.closed_at',
      't.closed_by',
      't.is_closed',
      't.board_id',
      't.category_id',
      't.subcategory_id',
      'p.propagation_id'
    )
    .where({ 't.master_ticket_id': masterId });

  return rows.map((row: Record<string, unknown>) => ({
    ticket_id: String(row.ticket_id),
    ticket_number: (row.ticket_number as string | null) ?? null,
    title: (row.title as string | null) ?? null,
    status_id: (row.status_id as string | null) ?? null,
    is_closed: Boolean(row.is_closed),
    assigned_to: (row.assigned_to as string | null) ?? null,
    priority_id: (row.priority_id as string | null) ?? null,
    closed_at: (row.closed_at as string | null) ?? null,
    closed_by: (row.closed_by as string | null) ?? null,
    propagation_id: (row.propagation_id as string | null) ?? null,
    board_id: (row.board_id as string | null) ?? null,
    category_id: (row.category_id as string | null) ?? null,
    subcategory_id: (row.subcategory_id as string | null) ?? null,
  }));
}

function toPreviewChild(child: DerivedBundleChildRow): BundlePropagationChild {
  return {
    ticket_id: child.ticket_id,
    ticket_number: child.ticket_number,
    title: child.title,
    is_closed: child.is_closed,
  };
}

/**
 * FR1 — read-only preview of what a master status change would do to children.
 * Returns `crossesBoundary: null` when the ticket is not a sync-mode master or
 * the change does not cross the open/closed boundary.
 */
export async function previewBundleStatusPropagation(
  trx: Knex.Transaction,
  tenant: string,
  masterTicketId: string,
  newStatusId: string
): Promise<BundleStatusPropagationPreview> {
  const settings = await tenantScopedTable(trx, 'ticket_bundle_settings', tenant)
    .where({ master_ticket_id: masterTicketId })
    .first();
  const mode: BundleStatusPropagationPreview['mode'] =
    settings?.mode === 'sync_updates' ? 'sync_updates' : 'link_only';

  const master = await tenantScopedTable(trx, 'tickets', tenant)
    .select('status_id')
    .where({ ticket_id: masterTicketId })
    .first();

  const previousIsClosed = await readStatusIsClosed(trx, tenant, master?.status_id);
  const nextIsClosed = await readStatusIsClosed(trx, tenant, newStatusId);

  let crossesBoundary: TicketBundleBoundary | null = null;
  if (
    mode === 'sync_updates' &&
    previousIsClosed !== null &&
    nextIsClosed !== null &&
    previousIsClosed !== nextIsClosed
  ) {
    crossesBoundary = nextIsClosed ? 'close' : 'reopen';
  }

  const base: BundleStatusPropagationPreview = {
    mode,
    masterTicketId,
    newStatusId,
    crossesBoundary,
    affectedChildren: [],
    unaffectedChildren: [],
  };

  if (crossesBoundary === null) {
    return base;
  }

  const children = await deriveBundleChildren(trx, tenant, masterTicketId);
  const affectedChildren: BundlePropagationChild[] = [];
  const unaffectedChildren: BundlePropagationUnaffectedChild[] = [];

  for (const child of children) {
    const shape = toPreviewChild(child);
    if (crossesBoundary === 'close') {
      if (!child.is_closed) {
        affectedChildren.push(shape);
      } else {
        unaffectedChildren.push({ ...shape, reason: 'already_closed' });
      }
    } else if (child.is_closed && child.propagation_id) {
      affectedChildren.push(shape);
    } else if (child.is_closed) {
      unaffectedChildren.push({ ...shape, reason: 'independently_closed' });
    } else {
      unaffectedChildren.push({ ...shape, reason: 'already_open' });
    }
  }

  return { ...base, affectedChildren, unaffectedChildren };
}

async function writeBundlePropagationActivity(
  trx: Knex.Transaction,
  ctx: BundleStatusPropagationContext,
  masterId: string,
  action: TicketBundleBoundary,
  childTicketIds: string[],
  propagated: boolean
): Promise<void> {
  const isSystem = ctx.isSystemActor === true;
  await writeTicketActivity(trx, {
    tenant: ctx.tenant,
    ticketId: masterId,
    eventType: TICKET_ACTIVITY_EVENT.BUNDLE_STATUS_PROPAGATED,
    entityType: TICKET_ACTIVITY_ENTITY.TICKET,
    entityId: masterId,
    actor: isSystem
      ? { actorType: TICKET_ACTIVITY_ACTOR.SYSTEM }
      : {
          actorType: TICKET_ACTIVITY_ACTOR.USER,
          userId: ctx.user.user_id,
          displayName: propagationDisplayName(ctx.user),
        },
    source: ctx.source ?? (isSystem ? TICKET_ACTIVITY_SOURCE.SYSTEM : TICKET_ACTIVITY_SOURCE.UI),
    occurredAt: nowIso(),
    details: {
      action,
      propagated,
      child_ticket_ids: childTicketIds,
    },
  });
}

/**
 * FR2/FR3/FR4/FR5/FR12 — the single child-propagation contract.
 *
 * Re-derives the affected children inside the caller's transaction (the client
 * preview is never trusted), writes the complete child row (`is_closed`
 * included), records/reverts propagation rows, and writes the master activity
 * row. Non-boundary changes keep the legacy sync behaviour.
 */
export async function propagateBundleMasterStatus(
  trx: Knex.Transaction,
  ctx: BundleStatusPropagationContext,
  masterId: string,
  updateData: Record<string, unknown>,
  options: PropagateBundleMasterStatusOptions = {}
): Promise<PropagateBundleMasterStatusResult> {
  const settings = await tenantScopedTable(trx, 'ticket_bundle_settings', ctx.tenant)
    .where({ master_ticket_id: masterId })
    .first();

  if (settings?.mode !== 'sync_updates') {
    return { propagated: false, action: null, affectedChildIds: [] };
  }

  const master = await tenantScopedTable(trx, 'tickets', ctx.tenant)
    .select('status_id', 'is_closed', 'closed_at', 'closed_by')
    .where({ ticket_id: masterId })
    .first();

  const nextStatusId =
    (typeof updateData.status_id === 'string' ? updateData.status_id : undefined) ??
    ctx.previousMasterStatusId ??
    master?.status_id ??
    null;

  const previousIsClosed = await readStatusIsClosed(trx, ctx.tenant, ctx.previousMasterStatusId);
  const nextIsClosed = await readStatusIsClosed(trx, ctx.tenant, nextStatusId);

  const crossesBoundary =
    previousIsClosed !== null && nextIsClosed !== null && previousIsClosed !== nextIsClosed
      ? (nextIsClosed ? 'close' : 'reopen')
      : null;

  if (crossesBoundary === null) {
    // Legacy sync: mirror workflow fields to every child, no propagation rows.
    const propagateFields: Record<string, unknown> = {};
    for (const key of ['status_id', 'assigned_to', 'priority_id', 'closed_by', 'closed_at']) {
      if (Object.prototype.hasOwnProperty.call(updateData, key)) {
        propagateFields[key] = updateData[key];
      }
    }
    if (Object.keys(propagateFields).length === 0) {
      return { propagated: false, action: null, affectedChildIds: [] };
    }
    assertBundlePropagationAuthority(ctx);

    const childRows = await tenantScopedTable(trx, 'tickets', ctx.tenant)
      .where({ master_ticket_id: masterId })
      .select(['ticket_id', 'board_id', 'status_id', 'assigned_to', 'priority_id', 'closed_at', 'closed_by', 'is_closed']);

    // Open-to-open sync must obey the same board ownership rule as a boundary
    // transition. Closed children keep their status and need no status check.
    if (Object.prototype.hasOwnProperty.call(propagateFields, 'status_id')) {
      const statusBoardId = await readStatusBoardId(trx, ctx.tenant, propagateFields.status_id as string | null);
      for (const child of childRows) {
        if (!child.is_closed && (!statusBoardId || statusBoardId !== child.board_id)) {
          throw new Error('A bundled ticket cannot use a status from another board');
        }
      }
    }

    // `tickets.is_closed` is authoritative. A closed child keeps its status on
    // a non-boundary master change; stamping the master's (open) status onto it
    // would make the next close preview classify it as open, so a later
    // propagated reopen would reopen a ticket closed independently.
    const fieldsForChild = (child: Record<string, unknown>): Record<string, unknown> => {
      if (!child.is_closed) return propagateFields;
      const fields = { ...propagateFields };
      delete fields.status_id;
      return fields;
    };
    const closedFields = fieldsForChild({ is_closed: true });

    const childPublishes = childRows
      .map((child: Record<string, unknown>) => ({
        ticketId: child.ticket_id as string,
        updatedFields: diffTicketFields(child, fieldsForChild(child)),
      }))
      .filter((publish: { ticketId: string; updatedFields: string[] }) => publish.updatedFields.length > 0);

    const updatedAt = nowIso();
    const openChildIds = childRows
      .filter((child: Record<string, unknown>) => !child.is_closed)
      .map((child: Record<string, unknown>) => child.ticket_id as string);
    const closedChildIds = childRows
      .filter((child: Record<string, unknown>) => Boolean(child.is_closed))
      .map((child: Record<string, unknown>) => child.ticket_id as string);

    // `assigned_to` moves the primary agent, and the child's ticket_resources
    // rows have to move with it. Without this the incoming assignee is still
    // recorded as an *additional* agent on the child, which the
    // `assigned_to != additional_user_id` invariant will not carry, and the
    // child's assignment does not survive the write. Same reason the
    // boundary-crossing path below prepares reassignment; this path mirrors a
    // bare assignment change and needs it just as much.
    const legacyFinalizers: Array<() => Promise<void>> = [];
    if (Object.prototype.hasOwnProperty.call(propagateFields, 'assigned_to')) {
      for (const child of childRows as Array<Record<string, unknown>>) {
        if (propagateFields.assigned_to !== child.assigned_to) {
          legacyFinalizers.push(
            await prepareTicketResourceReassignment(
              trx,
              ctx.tenant,
              child.ticket_id as string,
              child.assigned_to as string | null | undefined,
              propagateFields.assigned_to as string | null | undefined
            )
          );
        }
      }
    }

    const legacyUpdatedBy = ctx.isSystemActor ? null : ctx.user.user_id;
    if (openChildIds.length > 0) {
      await tenantScopedTable(trx, 'tickets', ctx.tenant)
        .whereIn('ticket_id', openChildIds)
        .update({ ...propagateFields, updated_by: legacyUpdatedBy, updated_at: updatedAt });
    }
    if (closedChildIds.length > 0 && Object.keys(closedFields).length > 0) {
      await tenantScopedTable(trx, 'tickets', ctx.tenant)
        .whereIn('ticket_id', closedChildIds)
        .update({ ...closedFields, updated_by: legacyUpdatedBy, updated_at: updatedAt });
    }

    for (const finalize of legacyFinalizers) {
      await finalize();
    }

    // System writes (the auto-close engine) publish no live UI update, exactly
    // as the master update does; there is no open browser session to notify.
    for (const publish of ctx.isSystemActor ? [] : childPublishes) {
      registerAfterCommit(
        trx,
        () =>
          publishTicketUpdate({
            tenantId: ctx.tenant,
            ticketId: publish.ticketId,
            updatedFields: publish.updatedFields,
            updatedBy: { userId: ctx.user.user_id, displayName: propagationDisplayName(ctx.user) },
            updatedAt,
          }),
        `ticket-live-update ticket=${publish.ticketId}`
      );
    }

    return {
      propagated: false,
      action: null,
      affectedChildIds: childRows.map((row: Record<string, unknown>) => row.ticket_id as string),
    };
  }

  const children = await deriveBundleChildren(trx, ctx.tenant, masterId);
  const affected =
    crossesBoundary === 'close'
      ? children.filter((child) => !child.is_closed)
      : children.filter((child) => child.is_closed && Boolean(child.propagation_id));
  const affectedChildIds = affected.map((child) => child.ticket_id);

  if (affected.length === 0) {
    // Nothing to decide: no child crossed the boundary, so no propagation
    // activity row (a "children not updated" entry would be noise).
    return { propagated: false, action: crossesBoundary, affectedChildIds: [] };
  }

  // Refuse before prompting: there is no point asking an actor to confirm a
  // propagation its authority will not permit.
  assertBundlePropagationAuthority(ctx);

  if (options.propagateToChildren === undefined) {
    const preview = await previewBundleStatusPropagation(trx, ctx.tenant, masterId, nextStatusId as string);
    throw new BundlePropagationConfirmationRequiredError(preview);
  }

  if (options.propagateToChildren === false) {
    await writeBundlePropagationActivity(trx, ctx, masterId, crossesBoundary, [], false);
    return { propagated: false, action: crossesBoundary, affectedChildIds: [] };
  }

  const propagateUpdatedAt = nowIso();
  const propagatedStatusId = (master?.status_id ?? nextStatusId) as string | null;
  const propagate: Record<string, unknown> = {
    status_id: propagatedStatusId,
    is_closed: crossesBoundary === 'close',
    closed_at: crossesBoundary === 'close' ? master?.closed_at ?? null : null,
    closed_by: crossesBoundary === 'close' ? master?.closed_by ?? null : null,
    updated_by: ctx.isSystemActor ? null : ctx.user.user_id,
    updated_at: propagateUpdatedAt,
  };
  if (crossesBoundary === 'close') {
    // A closed ticket never reloads as awaiting a response, on the master or
    // on a child the master closed.
    propagate.response_state = null;
  }
  if (Object.prototype.hasOwnProperty.call(updateData, 'assigned_to')) {
    propagate.assigned_to = updateData.assigned_to;
  }
  if (Object.prototype.hasOwnProperty.call(updateData, 'priority_id')) {
    propagate.priority_id = updateData.priority_id;
  }

  // One attribution for every child effect below: the caller's actor when it
  // supplied one, otherwise the propagating user (or SYSTEM for engine writes).
  const propagationActor: TicketActivityActorInfo = ctx.actor ?? {
    actorType: ctx.isSystemActor ? TICKET_ACTIVITY_ACTOR.SYSTEM : TICKET_ACTIVITY_ACTOR.USER,
    ...(ctx.isSystemActor
      ? {}
      : { userId: ctx.user.user_id, displayName: propagationDisplayName(ctx.user) }),
  };
  const propagationSource = (ctx.source ??
    (ctx.isSystemActor
      ? TICKET_ACTIVITY_SOURCE.SYSTEM
      : TICKET_ACTIVITY_SOURCE.UI)) as TicketActivitySource;

  // Statuses are board-scoped. Stamping the master's status onto a child on a
  // different board would leave the child pointing at a status its own board
  // does not define, which no later read can repair.
  const propagatedStatusBoardId = await readStatusBoardId(trx, ctx.tenant, propagatedStatusId);
  for (const child of affected) {
    if (child.board_id !== propagatedStatusBoardId) {
      throw new Error('A bundled ticket cannot use a status from another board');
    }
  }

  // A propagated close is still a close: it must clear the same board close
  // rules a direct close would, and honour the same override/bypass. Evaluated
  // for every affected child before any row is written, so a blocked child
  // aborts the whole master status change rather than closing a subset.
  // LEVERAGE: pattern ticket-close-transition — child notification ownership prevents using the full primary update as-is.
  if (crossesBoundary === 'close') {
    for (const child of affected) {
      await enforceTicketCloseRules(trx, ctx.tenant, {
        ticket: {
          ticket_id: child.ticket_id,
          board_id: child.board_id,
          category_id: child.category_id,
          subcategory_id: child.subcategory_id,
          priority_id: (propagate.priority_id as string | null | undefined) ?? child.priority_id,
          assigned_to: (propagate.assigned_to as string | null | undefined) ?? child.assigned_to,
        },
        override: options.overrideCloseRules,
        bypass: options.bypassCloseRules,
        actor: propagationActor,
        source: propagationSource,
      });
    }
  }

  const childPublishes = affected
    .map((child) => ({
      ticketId: child.ticket_id,
      updatedFields: diffTicketFields(child as unknown as Record<string, unknown>, propagate),
    }))
    .filter((publish) => publish.updatedFields.length > 0);

  // `assigned_to` moves the primary agent; the ticket_resources rows have to
  // move with it or the child keeps a stale additional-agent row that violates
  // the `assigned_to != additional_user_id` constraint.
  const finalizeChildResources: Array<() => Promise<void>> = [];
  if (Object.prototype.hasOwnProperty.call(propagate, 'assigned_to')) {
    for (const child of affected) {
      if (propagate.assigned_to !== child.assigned_to) {
        finalizeChildResources.push(
          await prepareTicketResourceReassignment(
            trx,
            ctx.tenant,
            child.ticket_id,
            child.assigned_to,
            propagate.assigned_to as string | null | undefined
          )
        );
      }
    }
  }

  await tenantScopedTable(trx, 'tickets', ctx.tenant)
    .whereIn('ticket_id', affectedChildIds)
    .update(propagate);

  for (const finalize of finalizeChildResources) {
    await finalize();
  }

  // Co-managed SLA/lifecycle bookkeeping is owned per ticket, not per bundle: a
  // child closed or reopened by propagation is closed or reopened as far as the
  // customer's own clocks are concerned.
  for (const child of affected) {
    if (crossesBoundary === 'close') {
      await recordCoManagedTicketResolution(trx, ctx.tenant, child.ticket_id);
    } else {
      await recordCoManagedTicketReopened(trx, ctx.tenant, child.ticket_id);
    }
  }

  // Each child gets its own timeline entry naming the master that moved it.
  // The master's BUNDLE_STATUS_PROPAGATED row records the decision; these
  // record the effect on the individual ticket.
  for (const child of affected) {
    await writeTicketActivity(trx, {
      tenant: ctx.tenant,
      ticketId: child.ticket_id,
      eventType:
        crossesBoundary === 'close' ? TICKET_ACTIVITY_EVENT.CLOSED : TICKET_ACTIVITY_EVENT.REOPENED,
      entityType: TICKET_ACTIVITY_ENTITY.TICKET,
      entityId: child.ticket_id,
      actor: propagationActor,
      source: propagationSource,
      occurredAt: propagateUpdatedAt,
      changes: {
        status_id: { old: child.status_id, new: propagate.status_id },
        closed_at: { old: child.closed_at, new: propagate.closed_at },
      },
      details: { bundle_master_ticket_id: masterId },
    });
  }

  const occurredAt = nowIso();
  if (crossesBoundary === 'close') {
    // Revert any row still active for an affected child before inserting the
    // new close row. A child can hold a stale active row when it was reopened
    // through a write path that did not revert the ledger. The per-child
    // partial unique index (tenant, child_ticket_id) WHERE reverted_at IS NULL
    // would otherwise abort this whole master status change. Reverting first
    // lets the new row record the current child_previous_status_id and
    // propagated_by rather than skipping the child.
    await tenantScopedTable(trx, 'ticket_bundle_status_propagations', ctx.tenant)
      .whereIn('child_ticket_id', affectedChildIds)
      .whereNull('reverted_at')
      .update({ reverted_at: occurredAt, reverted_by: ctx.user.user_id });

    const rows = affected.map((child) => ({
      tenant: ctx.tenant,
      propagation_id: uuidv4(),
      master_ticket_id: masterId,
      child_ticket_id: child.ticket_id,
      action: 'close',
      child_previous_status_id: child.status_id,
      propagated_by: ctx.user.user_id,
      propagated_at: occurredAt,
    }));
    await tenantScopedTable(trx, 'ticket_bundle_status_propagations', ctx.tenant).insert(rows);
  } else {
    await tenantScopedTable(trx, 'ticket_bundle_status_propagations', ctx.tenant)
      .where({ master_ticket_id: masterId })
      .whereIn('child_ticket_id', affectedChildIds)
      .whereNull('reverted_at')
      .update({ reverted_at: occurredAt, reverted_by: ctx.user.user_id });
  }

  // As on the legacy path, a system-triggered propagation notifies no session.
  for (const publish of ctx.isSystemActor ? [] : childPublishes) {
    registerAfterCommit(
      trx,
      () =>
        publishTicketUpdate({
          tenantId: ctx.tenant,
          ticketId: publish.ticketId,
          updatedFields: publish.updatedFields,
          updatedBy: { userId: ctx.user.user_id, displayName: propagationDisplayName(ctx.user) },
          updatedAt: propagateUpdatedAt,
        }),
      `ticket-live-update ticket=${publish.ticketId}`
    );
  }

  await writeBundlePropagationActivity(trx, ctx, masterId, crossesBoundary, affectedChildIds, true);
  return { propagated: true, action: crossesBoundary, affectedChildIds };
}

/**
 * FR4 — mark a child's active propagation row reverted when it leaves a bundle,
 * so a later master reopen cannot touch a ticket that is no longer a child.
 */
export async function revertBundlePropagationForChild(
  trx: Knex.Transaction,
  tenant: string,
  childTicketId: string,
  revertedBy: string | null
): Promise<void> {
  await tenantScopedTable(trx, 'ticket_bundle_status_propagations', tenant)
    .where({ child_ticket_id: childTicketId })
    .whereNull('reverted_at')
    .update({ reverted_at: nowIso(), reverted_by: revertedBy });
}

/**
 * FR4 — mark every active propagation row for a master's children reverted
 * (unbundle). Scoping by master keeps rows that belong to other masters intact.
 */
export async function revertBundlePropagationsForMaster(
  trx: Knex.Transaction,
  tenant: string,
  masterTicketId: string,
  revertedBy: string | null
): Promise<void> {
  await tenantScopedTable(trx, 'ticket_bundle_status_propagations', tenant)
    .where({ master_ticket_id: masterTicketId })
    .whereNull('reverted_at')
    .update({ reverted_at: nowIso(), reverted_by: revertedBy });
}
