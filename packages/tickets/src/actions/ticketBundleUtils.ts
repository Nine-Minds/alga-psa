'use server';

import type { Knex } from 'knex';
import { registerAfterCommit, tenantDb } from '@alga-psa/db';
import { v4 as uuidv4 } from 'uuid';
import {
  TICKET_ACTIVITY_ACTOR,
  TICKET_ACTIVITY_ENTITY,
  TICKET_ACTIVITY_EVENT,
  TICKET_ACTIVITY_SOURCE,
  writeTicketActivity,
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

async function findOpenTicketStatusId(trx: Knex.Transaction, tenant: string): Promise<string | null> {
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

  const openStatusId = await findOpenTicketStatusId(trx, tenant);
  if (!openStatusId) {
    return { reopened: false, masterTicketId };
  }

  const previousStatusId = master.status_id;
  const reopenedAt = nowIso();

  // Keep the denormalized `is_closed` column on tickets in sync with the
  // open status we're moving to — mirrors how updateTicketWithCache flips
  // is_closed when the status transitions across the closed boundary.
  // Without this, the master row reads "closed" in list/detail surfaces
  // even though its status_id points to an open status.
  await tenantScopedTable(trx, 'tickets', tenant)
    .where({ ticket_id: masterTicketId })
    .update({
      status_id: openStatusId,
      is_closed: false,
      closed_at: null,
      closed_by: null,
      updated_by: updatedByUserId,
      updated_at: reopenedAt,
    });

  // Activity row for the master ticket so the dispatcher can see that the
  // bundle reopen was system-triggered by a child reply (not a user click).
  // We classify the actor as SYSTEM because no human directly performed the
  // master-ticket action, even though we record the triggering user for
  // traceability.
  await writeTicketActivity(trx, {
    tenant,
    ticketId: masterTicketId,
    eventType: TICKET_ACTIVITY_EVENT.BUNDLE_REOPENED,
    entityType: TICKET_ACTIVITY_ENTITY.TICKET,
    entityId: masterTicketId,
    actor: {
      actorType: TICKET_ACTIVITY_ACTOR.SYSTEM,
      userId: updatedByUserId ?? null,
    },
    source: TICKET_ACTIVITY_SOURCE.SYSTEM,
    occurredAt: reopenedAt,
    changes: {
      status_id: { old: previousStatusId, new: openStatusId },
      closed_at: { old: null, new: null },
    },
    details: {
      reopen_trigger: 'child_reply',
      child_ticket_id: childTicketId,
    },
  });

  return { reopened: true, masterTicketId };
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

    const childRows = await tenantScopedTable(trx, 'tickets', ctx.tenant)
      .where({ master_ticket_id: masterId })
      .select(['ticket_id', 'status_id', 'assigned_to', 'priority_id', 'closed_at', 'closed_by', 'is_closed']);

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

    if (openChildIds.length > 0) {
      await tenantScopedTable(trx, 'tickets', ctx.tenant)
        .whereIn('ticket_id', openChildIds)
        .update({ ...propagateFields, updated_by: ctx.user.user_id, updated_at: updatedAt });
    }
    if (closedChildIds.length > 0 && Object.keys(closedFields).length > 0) {
      await tenantScopedTable(trx, 'tickets', ctx.tenant)
        .whereIn('ticket_id', closedChildIds)
        .update({ ...closedFields, updated_by: ctx.user.user_id, updated_at: updatedAt });
    }

    for (const publish of childPublishes) {
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

  if (options.propagateToChildren === undefined) {
    const preview = await previewBundleStatusPropagation(trx, ctx.tenant, masterId, nextStatusId as string);
    throw new BundlePropagationConfirmationRequiredError(preview);
  }

  if (options.propagateToChildren === false) {
    await writeBundlePropagationActivity(trx, ctx, masterId, crossesBoundary, [], false);
    return { propagated: false, action: crossesBoundary, affectedChildIds: [] };
  }

  const propagateUpdatedAt = nowIso();
  const propagate: Record<string, unknown> = {
    status_id: master?.status_id ?? nextStatusId,
    is_closed: crossesBoundary === 'close',
    closed_at: crossesBoundary === 'close' ? master?.closed_at ?? null : null,
    closed_by: crossesBoundary === 'close' ? master?.closed_by ?? null : null,
    updated_by: ctx.user.user_id,
    updated_at: propagateUpdatedAt,
  };
  if (Object.prototype.hasOwnProperty.call(updateData, 'assigned_to')) {
    propagate.assigned_to = updateData.assigned_to;
  }
  if (Object.prototype.hasOwnProperty.call(updateData, 'priority_id')) {
    propagate.priority_id = updateData.priority_id;
  }

  const childPublishes = affected
    .map((child) => ({
      ticketId: child.ticket_id,
      updatedFields: diffTicketFields(child as unknown as Record<string, unknown>, propagate),
    }))
    .filter((publish) => publish.updatedFields.length > 0);

  await tenantScopedTable(trx, 'tickets', ctx.tenant)
    .whereIn('ticket_id', affectedChildIds)
    .update(propagate);

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

  for (const publish of childPublishes) {
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
