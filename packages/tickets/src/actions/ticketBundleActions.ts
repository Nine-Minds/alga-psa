'use server';

import { revalidatePath } from 'next/cache';
import type { Knex } from 'knex';
import { createTenantKnex, tenantDb, withTransaction, registerAfterCommit } from '@alga-psa/db';
import { hasPermission } from '@alga-psa/auth/rbac';
import { z } from 'zod';
import type { IUser } from '@alga-psa/types';
import { withAuth } from '@alga-psa/auth';
import { publishWorkflowEvent, type WorkflowEventPublishContext } from '@alga-psa/event-bus/publishers';
import { actionError } from '@alga-psa/ui/lib/errorHandling';
import type { ActionMessageError } from '@alga-psa/ui/lib/errorHandling';
import {
  TICKET_ACTIVITY_ACTOR,
  TICKET_ACTIVITY_SOURCE,
} from '@alga-psa/shared/lib/ticketActivity';
import { ticketActionErrorFrom, type TicketActionError } from './ticketActionErrors';
import {
  attachChildrenToBundle,
  getBundleMasterClosedContext,
  type BundleAfterCommitPublication,
  type BundleAttachFailure,
} from './ticketBundleUtils';
import {
  BundleConcurrentModificationError,
  type ClosedMasterChoice,
} from '../lib/ticketBundlePolicy';

const closedMasterChoiceSchema = z.enum(['keep_closed', 'apply_resolution', 'reopen_master']);

function nowIso() {
  return new Date().toISOString();
}

function ticketBundleActionErrorFrom(error: unknown): TicketActionError | null {
  return ticketActionErrorFrom(error);
}

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

function buildTicketBundleWorkflowCtx(params: {
  tenantId: string;
  actorUserId: string;
  occurredAt: string;
}): WorkflowEventPublishContext {
  return {
    tenantId: params.tenantId,
    occurredAt: params.occurredAt,
    actor: { actorType: 'USER', actorUserId: params.actorUserId },
  };
}

async function findBundleMasterIds(
  trx: any,
  tenant: string,
  ticketIds: string[]
): Promise<string[]> {
  if (ticketIds.length === 0) return [];
  const rows = await tenantScopedTable(trx, 'tickets', tenant)
    .distinct('master_ticket_id')
    .whereIn('master_ticket_id', ticketIds);
  return rows.map((r: any) => r.master_ticket_id).filter(Boolean);
}

const CLOSED_MASTER_CHOICE_LABELS: Record<ClosedMasterChoice, string> = {
  keep_closed: 'keep the master closed',
  apply_resolution: "apply the master's resolution to the child",
  reopen_master: 'reopen the master',
};

function describeClosedMasterChoices(choices: ClosedMasterChoice[]): string {
  const labels = choices.map((choice) => CLOSED_MASTER_CHOICE_LABELS[choice]);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')}, or ${labels[labels.length - 1]}`;
}

function bundleAttachFailureToActionError(
  failure: BundleAttachFailure,
  options?: { masterIsChildMessage?: string; masterIsChildKey?: string }
): ActionMessageError {
  switch (failure.code) {
    case 'no_children':
      return actionError('No child tickets provided.', 'features/tickets:errors.bundle.noChildren');
    case 'master_not_found':
      return actionError('Master ticket not found.', 'features/tickets:errors.bundle.masterNotFound');
    case 'child_not_found':
      return actionError(
        `Child ticket not found: ${failure.childTicketId ?? ''}`,
        'features/tickets:errors.bundle.childNotFound',
        { ticket: failure.childTicketId ?? '' },
      );
    case 'master_is_child':
      return actionError(
        options?.masterIsChildMessage ?? 'Cannot select a child ticket as the master.',
        options?.masterIsChildKey ?? 'features/tickets:errors.bundle.childAsMaster',
      );
    case 'already_bundled': {
      const label = failure.childTicketNumber || failure.childTicketId || '';
      return actionError(
        `Ticket is already bundled: ${label}`,
        'features/tickets:errors.bundle.alreadyBundled',
        { ticket: label },
      );
    }
    case 'children_are_masters': {
      const numbers = failure.ticketNumbers ?? [];
      const listText = numbers.length > 0 ? numbers.join(', ') : '';
      // Two whole sentences, one per number — prefix + shared tail does not
      // translate cleanly across languages.
      return numbers.length === 1
        ? actionError(
            `Ticket ${listText} is already a bundle master and cannot be added as children. Unbundle them first, or use one of them as the master.`,
            'features/tickets:errors.bundle.masterAlreadyBundleMaster',
            { tickets: listText },
          )
        : actionError(
            `Tickets ${listText} are already bundle masters and cannot be added as children. Unbundle them first, or use one of them as the master.`,
            'features/tickets:errors.bundle.masterAlreadyBundleMasters',
            { tickets: listText },
          );
    }
    case 'choice_required':
      return actionError(
        `This bundle's master is closed. Choose how to add the child: ${describeClosedMasterChoices(failure.allowedChoices ?? [])}.`,
        'features/tickets:errors.bundle.closedMasterChoiceRequired',
        { choices: describeClosedMasterChoices(failure.allowedChoices ?? []) },
      );
    case 'choice_not_allowed':
      return actionError(
        `That choice is not allowed for this master. Choose one of: ${describeClosedMasterChoices(failure.allowedChoices ?? [])}.`,
        'features/tickets:errors.bundle.closedMasterChoiceNotAllowed',
        { choices: describeClosedMasterChoices(failure.allowedChoices ?? []) },
      );
    case 'choice_on_open_master':
      return actionError(
        'That choice only applies when the bundle master is closed.',
        'features/tickets:errors.bundle.choiceOnOpenMaster',
      );
    case 'close_rule_failed': {
      const reason = (failure.closeRuleFailures ?? []).map((f) => f.message).join('; ');
      return actionError(
        `This ticket cannot be closed yet: ${reason}`,
        'features/tickets:errors.bundle.closeRuleFailed',
        { reason },
      );
    }
    case 'reopen_unavailable':
      return actionError(
        'The master cannot be reopened because no open ticket status is configured.',
        'features/tickets:errors.bundle.reopenUnavailable',
      );
  }
}

function registerBundlePublications(
  trx: Knex.Transaction,
  workflowCtx: WorkflowEventPublishContext,
  publications: BundleAfterCommitPublication[]
): void {
  for (const publication of publications) {
    registerAfterCommit(
      trx,
      () =>
        publishWorkflowEvent({
          eventType: publication.eventType as any,
          payload: publication.payload,
          ctx: workflowCtx,
          eventName: publication.eventName,
          fromState: publication.fromState,
          toState: publication.toState,
          idempotencyKey: publication.idempotencyKey,
        }),
      `${publication.eventType} bundle-attach`
    );
  }
}

const bundleTicketsSchema = z.object({
  masterTicketId: z.string().uuid(),
  childTicketIds: z.array(z.string().uuid()).min(1),
  mode: z.enum(['link_only', 'sync_updates']).default('sync_updates'),
  onClosedMaster: closedMasterChoiceSchema.optional(),
});

const findTicketByNumberSchema = z.object({
  ticketNumber: z.string().min(1),
});

export const findTicketByNumberAction = withAuth(async (user, { tenant }, input: z.input<typeof findTicketByNumberSchema>) => {
  try {
  const data = findTicketByNumberSchema.parse(input);
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'read', trx)) {
      throw new Error('Permission denied: Cannot view tickets');
    }
    const ticket = await tenantScopedTable(trx, 'tickets', tenant)
      .select('ticket_id', 'ticket_number', 'title', 'client_id', 'master_ticket_id')
      .andWhere('ticket_number', 'ilike', data.ticketNumber)
      .first();
    return ticket || null;
  });
  } catch (error) {
    const expected = ticketBundleActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

type BundleTicketsResult = { masterTicketId: string; childTicketIds: string[]; mode: 'link_only' | 'sync_updates' };

function bundleActorInfo(user: IUser) {
  return { actorType: TICKET_ACTIVITY_ACTOR.USER, userId: user.user_id };
}

export const bundleTicketsAction = withAuth(async (
  user,
  { tenant },
  input: z.input<typeof bundleTicketsSchema>
): Promise<BundleTicketsResult | TicketActionError> => {
  try {
  const data = bundleTicketsSchema.parse(input);
  const uniqueChildIds = Array.from(new Set(data.childTicketIds)).filter((id) => id !== data.masterTicketId);
  if (uniqueChildIds.length === 0) {
    return actionError('Select at least one child ticket different from the master.', 'features/tickets:errors.bundle.selectChild');
  }

  const { knex: db } = await createTenantKnex();
  const occurredAt = nowIso();
  const workflowCtx = buildTicketBundleWorkflowCtx({ tenantId: tenant, actorUserId: user.user_id, occurredAt });

  const txResult = await withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'update', trx)) {
      throw new Error('Permission denied: Cannot bundle tickets');
    }

    const result = await attachChildrenToBundle(trx, tenant, {
      masterTicketId: data.masterTicketId,
      childTicketIds: uniqueChildIds,
      mode: data.mode,
      choice: data.onClosedMaster ?? null,
      actor: bundleActorInfo(user as IUser),
      source: TICKET_ACTIVITY_SOURCE.UI,
      occurredAt,
      mergedReason: `bundle:${data.mode}`,
    });
    if (result.ok) {
      registerBundlePublications(trx, workflowCtx, result.value.publications);
    }
    return result;
  });

  if (!txResult.ok) {
    return bundleAttachFailureToActionError(txResult, {
      masterIsChildMessage: 'Cannot select a child ticket as the master.',
      masterIsChildKey: 'features/tickets:errors.bundle.childAsMaster',
    });
  }

  const result = txResult.value;
  // Trigger an RSC refresh of the tickets list. The client also refetches via
  // onFilterChange({}), but that fire-and-forget server action can be starved
  // by background polling and never settle, leaving the loading spinner stuck.
  // The revalidation here is a reliable backstop (the container clears its
  // loading state when the refreshed data arrives).
  revalidatePath('/msp/tickets');

  return { masterTicketId: result.masterTicketId, childTicketIds: result.childTicketIds, mode: data.mode };
  } catch (error) {
    if (error instanceof BundleConcurrentModificationError) {
      return actionError(error.message, 'features/tickets:errors.bundle.concurrent');
    }
    const expected = ticketBundleActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

const addChildrenSchema = z.object({
  masterTicketId: z.string().uuid(),
  childTicketIds: z.array(z.string().uuid()).min(1),
  onClosedMaster: closedMasterChoiceSchema.optional(),
});

type AddChildrenResult = { masterTicketId: string; childTicketIds: string[] };

export const addChildrenToBundleAction = withAuth(async (
  user,
  { tenant },
  input: z.input<typeof addChildrenSchema>
): Promise<AddChildrenResult | TicketActionError> => {
  try {
  const data = addChildrenSchema.parse(input);
  const childIds = Array.from(new Set(data.childTicketIds)).filter((id) => id !== data.masterTicketId);
  if (childIds.length === 0) {
    return actionError('No child tickets provided.', 'features/tickets:errors.bundle.noChildren');
  }

  const { knex: db } = await createTenantKnex();
  const occurredAt = nowIso();
  const workflowCtx = buildTicketBundleWorkflowCtx({ tenantId: tenant, actorUserId: user.user_id, occurredAt });

  const txResult = await withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'update', trx)) {
      throw new Error('Permission denied: Cannot modify ticket bundles');
    }

    const result = await attachChildrenToBundle(trx, tenant, {
      masterTicketId: data.masterTicketId,
      childTicketIds: childIds,
      choice: data.onClosedMaster ?? null,
      actor: bundleActorInfo(user as IUser),
      source: TICKET_ACTIVITY_SOURCE.UI,
      occurredAt,
      mergedReason: 'bundle:added_children',
    });
    if (result.ok) {
      registerBundlePublications(trx, workflowCtx, result.value.publications);
    }
    return result;
  });

  if (!txResult.ok) {
    return bundleAttachFailureToActionError(txResult, {
      masterIsChildMessage: 'Cannot add children to a bundled child ticket.',
      masterIsChildKey: 'features/tickets:errors.bundle.childrenOnBundledChild',
    });
  }

  const result = txResult.value;
  return { masterTicketId: result.masterTicketId, childTicketIds: result.childTicketIds };
  } catch (error) {
    if (error instanceof BundleConcurrentModificationError) {
      return actionError(error.message, 'features/tickets:errors.bundle.concurrent');
    }
    const expected = ticketBundleActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

const getBundleMasterClosedContextSchema = z.object({
  masterTicketId: z.string().uuid(),
});

export type BundleMasterClosedContextActionResult = {
  isClosed: boolean;
  allowedChoices: ClosedMasterChoice[];
  hasResolutionComment: boolean;
  masterStatusName: string | null;
  openChildrenCount: number;
};

/**
 * Read-only context for the ticket-detail / list dialogs so the client can
 * decide whether a closed-master choice is required and which choices the
 * board allows. `ticket:read`.
 */
export const getBundleMasterClosedContextAction = withAuth(async (
  user,
  { tenant },
  input: z.input<typeof getBundleMasterClosedContextSchema>
): Promise<BundleMasterClosedContextActionResult | TicketActionError> => {
  try {
  const data = getBundleMasterClosedContextSchema.parse(input);
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'read', trx)) {
      throw new Error('Permission denied: Cannot view tickets');
    }
    const context = await getBundleMasterClosedContext(trx, tenant, data.masterTicketId);
    if (!context) {
      return actionError('Master ticket not found.', 'features/tickets:errors.bundle.masterNotFound');
    }
    return {
      isClosed: context.isClosed,
      allowedChoices: context.allowedChoices,
      hasResolutionComment: Boolean(context.resolutionComment),
      masterStatusName: context.statusName,
      openChildrenCount: context.openChildrenCount,
    };
  });
  } catch (error) {
    const expected = ticketBundleActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

const promoteMasterSchema = z.object({
  oldMasterTicketId: z.string().uuid(),
  newMasterTicketId: z.string().uuid(),
});

export const promoteBundleMasterAction = withAuth(async (user, { tenant }, input: z.input<typeof promoteMasterSchema>) => {
  try {
  const data = promoteMasterSchema.parse(input);
  if (data.oldMasterTicketId === data.newMasterTicketId) {
    throw new Error('New master ticket must be different from the current master.');
  }
  const { knex: db } = await createTenantKnex();
  const occurredAt = nowIso();
  const workflowCtx = buildTicketBundleWorkflowCtx({ tenantId: tenant, actorUserId: user.user_id, occurredAt });

  const result = await withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'update', trx)) {
      throw new Error('Permission denied: Cannot modify ticket bundles');
    }

    const oldMaster = await tenantScopedTable(trx, 'tickets', tenant)
      .select('ticket_id', 'master_ticket_id')
      .where({ ticket_id: data.oldMasterTicketId })
      .first();
    if (!oldMaster) throw new Error('Old master ticket not found');
    if (oldMaster.master_ticket_id) throw new Error('Old master ticket is not a master');

    const newMaster = await tenantScopedTable(trx, 'tickets', tenant)
      .select('ticket_id', 'master_ticket_id')
      .where({ ticket_id: data.newMasterTicketId })
      .first();
    if (!newMaster) throw new Error('New master ticket not found');
    if (newMaster.master_ticket_id !== data.oldMasterTicketId) {
      throw new Error('New master ticket must be a child of the current master');
    }

    const now = nowIso();

    // Prevent nesting bundles: the promoted ticket cannot itself have children
    const promotedMasterConflicts = await findBundleMasterIds(trx, tenant, [data.newMasterTicketId]);
    if (promotedMasterConflicts.length > 0) {
      throw new Error('Promoted ticket already has children of its own.');
    }

    // Move bundle settings to new master
    const settings = await tenantScopedTable(trx, 'ticket_bundle_settings', tenant)
      .where({ master_ticket_id: data.oldMasterTicketId })
      .first();
    if (settings) {
      await tenantScopedTable(trx, 'ticket_bundle_settings', tenant)
        .where({ master_ticket_id: data.oldMasterTicketId })
        .delete();
      await tenantScopedTable(trx, 'ticket_bundle_settings', tenant)
        .insert({
          ...settings,
          master_ticket_id: data.newMasterTicketId,
        })
        .onConflict(['tenant', 'master_ticket_id'])
        .merge({
          mode: settings.mode,
          reopen_on_child_reply: settings.reopen_on_child_reply,
        });
    }

    // Re-point children to new master (including old master)
    await tenantScopedTable(trx, 'tickets', tenant)
      .where({ master_ticket_id: data.oldMasterTicketId })
      .andWhereNot({ ticket_id: data.newMasterTicketId })
      .update({
        master_ticket_id: data.newMasterTicketId,
        updated_by: user.user_id,
        updated_at: now,
      });

    // New master becomes root
    await tenantScopedTable(trx, 'tickets', tenant)
      .where({ ticket_id: data.newMasterTicketId })
      .update({
        master_ticket_id: null,
        updated_by: user.user_id,
        updated_at: now,
      });

    // Old master becomes child
    await tenantScopedTable(trx, 'tickets', tenant)
      .where({ ticket_id: data.oldMasterTicketId })
      .update({
        master_ticket_id: data.newMasterTicketId,
        updated_by: user.user_id,
        updated_at: now,
      });

    return { oldMasterTicketId: data.oldMasterTicketId, newMasterTicketId: data.newMasterTicketId };
  });

  await publishWorkflowEvent({
    eventType: 'TICKET_MERGED',
    ctx: workflowCtx,
    eventName: 'Ticket Merged',
    payload: {
      sourceTicketId: result.oldMasterTicketId,
      targetTicketId: result.newMasterTicketId,
      mergedAt: occurredAt,
      reason: 'bundle:promote_master',
    },
  });

  return result;
  } catch (error) {
    const expected = ticketBundleActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

const updateBundleSettingsSchema = z.object({
  masterTicketId: z.string().uuid(),
  mode: z.enum(['link_only', 'sync_updates']).optional(),
  reopenOnChildReply: z.boolean().optional(),
});

export const updateBundleSettingsAction = withAuth(async (user, { tenant }, input: z.input<typeof updateBundleSettingsSchema>) => {
  try {
  const data = updateBundleSettingsSchema.parse(input);
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'update', trx)) {
      throw new Error('Permission denied: Cannot modify ticket bundles');
    }

    const existing = await tenantScopedTable(trx, 'ticket_bundle_settings', tenant)
      .where({ master_ticket_id: data.masterTicketId })
      .first();
    if (!existing) throw new Error('Bundle settings not found');

    const update: any = {};
    if (data.mode) update.mode = data.mode;
    if (data.reopenOnChildReply !== undefined) update.reopen_on_child_reply = data.reopenOnChildReply;

    if (Object.keys(update).length === 0) {
      return {
        master_ticket_id: existing.master_ticket_id,
        mode: existing.mode,
        reopen_on_child_reply: existing.reopen_on_child_reply,
      };
    }

    const [updated] = await tenantScopedTable(trx, 'ticket_bundle_settings', tenant)
      .where({ master_ticket_id: data.masterTicketId })
      .update(update)
      .returning(['master_ticket_id', 'mode', 'reopen_on_child_reply']);

    return updated;
  });
  } catch (error) {
    const expected = ticketBundleActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

const removeChildSchema = z.object({
  childTicketId: z.string().uuid(),
});

export const removeChildFromBundleAction = withAuth(async (user, { tenant }, input: z.input<typeof removeChildSchema>) => {
  try {
  const data = removeChildSchema.parse(input);
  const { knex: db } = await createTenantKnex();
  const occurredAt = nowIso();
  const workflowCtx = buildTicketBundleWorkflowCtx({ tenantId: tenant, actorUserId: user.user_id, occurredAt });

  const result = await withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'update', trx)) {
      throw new Error('Permission denied: Cannot modify ticket bundles');
    }

    const child = await tenantScopedTable(trx, 'tickets', tenant)
      .select('ticket_id', 'master_ticket_id')
      .where({ ticket_id: data.childTicketId })
      .first();

    if (!child) throw new Error('Ticket not found');
    if (!child.master_ticket_id) throw new Error('Ticket is not bundled');

    const masterTicketId = child.master_ticket_id;

    await tenantScopedTable(trx, 'tickets', tenant)
      .where({ ticket_id: data.childTicketId })
      .update({
        master_ticket_id: null,
        updated_by: user.user_id,
        updated_at: nowIso(),
      });

    // If the master now has no children, remove bundle settings
    const [{ count }] = await tenantScopedTable(trx, 'tickets', tenant)
      .where({ master_ticket_id: masterTicketId })
      .count('ticket_id as count');
    const remaining = Number.parseInt(String(count), 10) || 0;
    if (remaining === 0) {
      await tenantScopedTable(trx, 'ticket_bundle_settings', tenant)
        .where({ master_ticket_id: masterTicketId })
        .delete();
    }

    return { masterTicketId, childTicketId: data.childTicketId, remainingChildren: remaining };
  });

  await publishWorkflowEvent({
    eventType: 'TICKET_SPLIT',
    ctx: workflowCtx,
    eventName: 'Ticket Split',
    payload: {
      originalTicketId: result.masterTicketId,
      newTicketIds: [result.childTicketId],
      splitAt: occurredAt,
      reason: 'bundle:remove_child',
    },
  });

  return result;
  } catch (error) {
    const expected = ticketBundleActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

const unbundleSchema = z.object({
  masterTicketId: z.string().uuid(),
});

const getBundleMasterStatusSchema = z.object({
  ticketIds: z.array(z.string().uuid()).min(1).max(500),
});

export const getBundleMasterStatusAction = withAuth(async (
  user,
  { tenant },
  input: z.input<typeof getBundleMasterStatusSchema>
): Promise<{ masterTicketIds: string[] } | TicketActionError> => {
  try {
  const data = getBundleMasterStatusSchema.parse(input);
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'read', trx)) {
      throw new Error('Permission denied: Cannot view tickets');
    }
    const masterTicketIds = await findBundleMasterIds(trx, tenant, data.ticketIds);
    return { masterTicketIds };
  });
  } catch (error) {
    const expected = ticketBundleActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

const searchEligibleChildTicketsSchema = z.object({
  boardId: z.string().uuid(),
  searchQuery: z.string().min(1).max(100),
  excludeTicketId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(20).default(10),
});

export type EligibleChildTicket = {
  ticket_id: string;
  ticket_number: string;
  title: string;
  client_id: string | null;
  client_name?: string;
};

export const searchEligibleChildTicketsAction = withAuth(async (user, { tenant }, input: z.input<typeof searchEligibleChildTicketsSchema>): Promise<EligibleChildTicket[] | TicketActionError> => {
  try {
  const data = searchEligibleChildTicketsSchema.parse(input);
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'read', trx)) {
      throw new Error('Permission denied: Cannot view tickets');
    }

    // Search for tickets on the same board with open status, not already bundled
    const facade = tenantDb(trx, tenant);
    let query = facade
      .tenantJoin(
        facade.tenantJoin(
          tenantScopedTable(trx, 'tickets as t', tenant),
          'statuses as s',
          't.status_id',
          's.status_id'
        ),
        'clients as c',
        't.client_id',
        'c.client_id',
        { type: 'left' }
      )
      .select(
        't.ticket_id',
        't.ticket_number',
        't.title',
        't.client_id',
        'c.client_name'
      )
      .where({
        't.board_id': data.boardId
      })
      .andWhere((builder) => {
        builder.where('s.is_closed', false).orWhereNull('s.is_closed');
      })
      .whereNull('t.master_ticket_id') // Not already bundled
      .andWhere((builder) => {
        builder.where('t.ticket_number', 'ilike', `%${data.searchQuery}%`)
          .orWhere('t.title', 'ilike', `%${data.searchQuery}%`);
      })
      .orderBy('t.entered_at', 'desc')
      .limit(data.limit);

    // Exclude the master ticket itself if provided
    if (data.excludeTicketId) {
      query = query.andWhereNot('t.ticket_id', data.excludeTicketId);
    }

    const tickets = await query;
    return tickets;
  });
  } catch (error) {
    const expected = ticketBundleActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const unbundleMasterTicketAction = withAuth(async (user, { tenant }, input: z.input<typeof unbundleSchema>) => {
  try {
  const data = unbundleSchema.parse(input);
  const { knex: db } = await createTenantKnex();
  const occurredAt = nowIso();
  const workflowCtx = buildTicketBundleWorkflowCtx({ tenantId: tenant, actorUserId: user.user_id, occurredAt });

  const result = await withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'update', trx)) {
      throw new Error('Permission denied: Cannot modify ticket bundles');
    }

    // Ensure master exists and is not itself a child
    const master = await tenantScopedTable(trx, 'tickets', tenant)
      .select('ticket_id', 'master_ticket_id')
      .where({ ticket_id: data.masterTicketId })
      .first();
    if (!master) throw new Error('Master ticket not found');
    if (master.master_ticket_id) throw new Error('Cannot unbundle from a child ticket id');

    const childTicketRows = await tenantScopedTable(trx, 'tickets', tenant)
      .select('ticket_id')
      .where({ master_ticket_id: data.masterTicketId });
    const childTicketIds = childTicketRows.map((r: any) => r.ticket_id);

    await tenantScopedTable(trx, 'tickets', tenant)
      .where({ master_ticket_id: data.masterTicketId })
      .update({
        master_ticket_id: null,
        updated_by: user.user_id,
        updated_at: nowIso(),
      });

    await tenantScopedTable(trx, 'ticket_bundle_settings', tenant)
      .where({ master_ticket_id: data.masterTicketId })
      .delete();

    return { masterTicketId: data.masterTicketId, childTicketIds };
  });

  if (result.childTicketIds.length > 0) {
    await publishWorkflowEvent({
      eventType: 'TICKET_SPLIT',
      ctx: workflowCtx,
      eventName: 'Ticket Split',
      payload: {
        originalTicketId: result.masterTicketId,
        newTicketIds: result.childTicketIds,
        splitAt: occurredAt,
        reason: 'bundle:unbundle_master',
      },
    });
  }

  return result;
  } catch (error) {
    const expected = ticketBundleActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});
