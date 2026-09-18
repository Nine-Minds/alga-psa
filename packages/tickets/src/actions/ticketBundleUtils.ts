'use server';

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
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
      .select('c.comment_id', 'c.note', 'c.markdown_content', 'c.created_at', 'c.is_resolution')
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
    .select('ticket_id', 'status_id')
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
      closed_at: { old: null, new: null },
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
  const child = await tenantScopedTable(trx, 'tickets', tenant)
    .select('ticket_id', 'master_ticket_id')
    .where({ ticket_id: childTicketId })
    .first();

  const masterTicketId = child?.master_ticket_id ?? null;
  if (!masterTicketId) {
    return { reopened: false, masterTicketId: null };
  }

  const settings = await tenantScopedTable(trx, 'ticket_bundle_settings', tenant)
    .select('reopen_on_child_reply')
    .where({ master_ticket_id: masterTicketId })
    .first();

  if (!settings?.reopen_on_child_reply) {
    return { reopened: false, masterTicketId };
  }

  const master = await tenantDb(trx, tenant)
    .tenantJoin(
      tenantScopedTable(trx, 'tickets as t', tenant),
      'statuses as s',
      't.status_id',
      's.status_id',
      { type: 'left' }
    )
    .select('t.ticket_id', 't.status_id', 's.is_closed')
    .where({ 't.ticket_id': masterTicketId })
    .first();

  if (!master || !master.is_closed) {
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
    details: { child_ticket_id: childTicketId },
  });

  return { reopened: result.reopened, masterTicketId };
}

export type MirrorCommentSource = {
  comment_id: string;
  note: string | null;
  markdown_content: string | null;
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
    created_by: null,
  });

  await tenantDb(trx, tenant).table('comments').insert({
    tenant,
    comment_id: childGenerated.comment_id,
    thread_id: childGenerated.thread_id,
    ticket_id: childTicketId,
    user_id: null,
    author_type: 'unknown',
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
