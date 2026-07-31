import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import { updateTicketInTransaction } from '@alga-psa/tickets/actions/optimizedTicketActions';
import { TicketModel } from '@alga-psa/shared/models/ticketModel';
import type { IUserWithRoles } from '@alga-psa/types';
import {
  TICKET_ACTIVITY_ACTOR,
  TICKET_ACTIVITY_ENTITY,
  TICKET_ACTIVITY_EVENT,
  TICKET_ACTIVITY_SOURCE,
  writeTicketActivity,
} from '@alga-psa/shared/lib/ticketActivity';

/**
 * Auto-close engine (docs/plans/2026-06-10-ticket-close-rules/PRD.md §5.3).
 *
 * One recurring scan per tenant every 15 minutes, three phases:
 *  - match: recompute pending closes from current DB state (board_auto_close_rules
 *    × open tickets in a trigger status). Activity resets the timer simply by
 *    shifting last_activity_at, which recomputes scheduled_close_at and clears
 *    any pending warning. State rows for tickets that no longer match are
 *    deleted. Stateless recomputation means rule edits apply next run with no
 *    timer invalidation problem.
 *  - warn: send the 'ticket-auto-close-warning' notification once per pending
 *    close when inside the warning window.
 *  - close: close due tickets through updateTicketInTransaction with a SYSTEM
 *    actor and a close-rules bypass, so every normal closure side effect
 *    (TICKET_CLOSED, emails, SLA resolution, surveys, webhooks, search) fires
 *    exactly as a manual close would. Inactivity is revalidated inside the
 *    closing transaction so a reply racing the scan never loses the ticket.
 */

export interface AutoCloseTicketsJobData extends Record<string, unknown> {
  tenantId: string;
}

/**
 * Audit events written by the engine itself must not count as ticket activity,
 * or every warning would push back the close it warned about.
 */
const NON_ACTIVITY_AUDIT_EVENTS = [
  TICKET_ACTIVITY_EVENT.AUTO_CLOSE_WARNING_SENT,
  TICKET_ACTIVITY_EVENT.CLOSE_RULES_BYPASSED,
  TICKET_ACTIVITY_EVENT.CLOSE_RULES_OVERRIDDEN,
];

/**
 * Placeholder for updateTicketInTransaction's required user parameter. With
 * systemActor: true the function never reads attribution off this object —
 * closed_by stays null and events/audit carry a SYSTEM actor.
 */
const SYSTEM_ACTOR_USER = {
  user_id: null,
  first_name: 'System',
  last_name: '',
  username: 'system',
  roles: [],
} as unknown as IUserWithRoles;

interface PendingClose {
  ticket_id: string;
  rule_id: string;
  inactivity_days: number;
  warning_days_before: number | null;
  close_to_status_id: string;
  last_activity_at: Date;
  scheduled_close_at: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function tenantScopedTable(conn: Knex | Knex.Transaction, table: string, tenant: string) {
  return tenantDb(conn, tenant).table(table);
}

async function computePendingCloses(
  conn: Knex | Knex.Transaction,
  tenant: string,
  ticketId?: string
): Promise<PendingClose[]> {
  const db = tenantDb(conn, tenant);
  const commentActivity = db.table('comments as c')
    .select('c.tenant', 'c.ticket_id')
    .max('c.created_at as last_comment_at')
    .groupBy('c.tenant', 'c.ticket_id')
    .as('comment_activity');
  const auditActivity = db.table('ticket_audit_logs as a')
    .select('a.tenant', 'a.ticket_id')
    .max('a.occurred_at as last_audit_at')
    .whereNotIn('a.event_type', NON_ACTIVITY_AUDIT_EVENTS)
    .groupBy('a.tenant', 'a.ticket_id')
    .as('audit_activity');

  const pendingQuery = db.table('tickets as t');
  db.tenantJoin(pendingQuery, 'board_auto_close_rules as r', 'r.board_id', 't.board_id', {
    on(join) {
      join
        .andOn('r.trigger_status_id', '=', 't.status_id')
        .andOnVal('r.is_enabled', '=', true);
    },
  });
  db.tenantJoinSubquery(pendingQuery, commentActivity, 't.ticket_id', 'comment_activity.ticket_id', {
    type: 'left',
    rootTenantColumn: 't.tenant',
    joinedTenantColumn: 'comment_activity.tenant',
  });
  db.tenantJoinSubquery(pendingQuery, auditActivity, 't.ticket_id', 'audit_activity.ticket_id', {
    type: 'left',
    rootTenantColumn: 't.tenant',
    joinedTenantColumn: 'audit_activity.tenant',
  });

  if (ticketId) {
    pendingQuery.where('t.ticket_id', ticketId);
  }

  const rows = (await pendingQuery
    .whereNull('t.closed_at')
    .whereNull('t.master_ticket_id')
    .select(
      't.ticket_id',
      'r.rule_id',
      'r.inactivity_days',
      'r.warning_days_before',
      'r.close_to_status_id',
      conn.raw(
        `GREATEST(
          COALESCE(comment_activity.last_comment_at, to_timestamp(0)),
          COALESCE(audit_activity.last_audit_at, to_timestamp(0)),
          COALESCE(t.entered_at, t.updated_at, now())
        ) AS last_activity_at`
      )
    )) as Array<Record<string, any>>;

  return rows.map((row: Record<string, any>) => {
    const lastActivity = new Date(row.last_activity_at);
    return {
      ticket_id: row.ticket_id,
      rule_id: row.rule_id,
      inactivity_days: Number(row.inactivity_days),
      warning_days_before: row.warning_days_before === null ? null : Number(row.warning_days_before),
      close_to_status_id: row.close_to_status_id,
      last_activity_at: lastActivity,
      scheduled_close_at: new Date(lastActivity.getTime() + Number(row.inactivity_days) * DAY_MS),
    };
  });
}

async function syncAutoCloseState(
  knex: Knex,
  tenant: string,
  pending: PendingClose[]
): Promise<void> {
  const existing = await tenantScopedTable(knex, 'ticket_auto_close_state', tenant)
    .select('ticket_id', 'rule_id', 'scheduled_close_at', 'warning_sent_at');
  const existingByTicket = new Map<string, (typeof existing)[number]>(
    existing.map((row: any) => [row.ticket_id, row])
  );

  const pendingTicketIds = new Set(pending.map((p) => p.ticket_id));

  // Drop state for tickets that stopped matching: activity moved them out of
  // the trigger status, the rule was disabled/deleted, or they closed.
  const staleIds = existing
    .filter((row: any) => !pendingTicketIds.has(row.ticket_id))
    .map((row: any) => row.ticket_id);
  if (staleIds.length > 0) {
    await tenantScopedTable(knex, 'ticket_auto_close_state', tenant)
      .whereIn('ticket_id', staleIds)
      .del();
  }

  for (const p of pending) {
    const current = existingByTicket.get(p.ticket_id);
    if (!current) {
      await tenantScopedTable(knex, 'ticket_auto_close_state', tenant)
        .insert({
          tenant,
          ticket_id: p.ticket_id,
          rule_id: p.rule_id,
          scheduled_close_at: p.scheduled_close_at.toISOString(),
        })
        .onConflict(['tenant', 'ticket_id'])
        .merge(['rule_id', 'scheduled_close_at']);
      continue;
    }

    const currentScheduled = new Date(current.scheduled_close_at).getTime();
    if (currentScheduled !== p.scheduled_close_at.getTime() || current.rule_id !== p.rule_id) {
      // Timer moved (new activity or rule change) — reset any pending warning
      // so the customer is warned again before the new deadline.
      await tenantScopedTable(knex, 'ticket_auto_close_state', tenant)
        .where({ ticket_id: p.ticket_id })
        .update({
          rule_id: p.rule_id,
          scheduled_close_at: p.scheduled_close_at.toISOString(),
          warning_sent_at:
            p.scheduled_close_at.getTime() > currentScheduled ? null : current.warning_sent_at,
          updated_at: knex.fn.now(),
        });
    }
  }
}

async function sendWarnings(knex: Knex, tenant: string): Promise<void> {
  const now = new Date();
  const db = tenantDb(knex, tenant);
  const dueQuery = tenantScopedTable(knex, 'ticket_auto_close_state as s', tenant);
  db.tenantJoin(dueQuery, 'board_auto_close_rules as r', 'r.rule_id', 's.rule_id');
  db.tenantJoin(dueQuery, 'tickets as t', 't.ticket_id', 's.ticket_id');

  const due = (await dueQuery
    .whereNull('s.warning_sent_at')
    .whereNotNull('r.warning_days_before')
    .whereRaw("s.scheduled_close_at - (r.warning_days_before * interval '1 day') <= now()")
    .whereRaw('s.scheduled_close_at > now()')
    .select(
      's.ticket_id',
      's.scheduled_close_at',
      'r.warning_days_before',
      'r.suppress_contact_notifications',
      'r.suppress_internal_notifications',
      't.title',
      't.ticket_number',
      't.contact_name_id',
      't.assigned_to',
      't.entered_by'
    )) as Array<Record<string, any>>;

  if (!due.length) return;

  for (const row of due) {
    try {
      if (row.suppress_contact_notifications) {
        await withTransaction(knex, async (trx: Knex.Transaction) => {
          await tenantScopedTable(trx, 'ticket_auto_close_state', tenant)
            .where({ ticket_id: row.ticket_id })
            .update({ warning_sent_at: now.toISOString(), updated_at: trx.fn.now() });

          await writeTicketActivity(trx, {
            tenant,
            ticketId: row.ticket_id,
            eventType: TICKET_ACTIVITY_EVENT.AUTO_CLOSE_WARNING_SENT,
            entityType: TICKET_ACTIVITY_ENTITY.TICKET,
            actor: { actorType: TICKET_ACTIVITY_ACTOR.SYSTEM },
            source: TICKET_ACTIVITY_SOURCE.SYSTEM,
            details: {
              scheduled_close_at: new Date(row.scheduled_close_at).toISOString(),
              recipient: null,
              outcome: 'warning_suppressed',
              notification_suppression: {
                suppress_contact_notifications: true,
                suppress_internal_notifications: Boolean(row.suppress_internal_notifications),
              },
            },
          });
        });
        continue;
      }

      // The handler runs in the Temporal worker (plain Node ESM) and must not
      // depend on @alga-psa/notifications. It only emits a domain event; the
      // server-side ticketAutoCloseWarningSubscriber resolves the contact email
      // and portal user and sends the actual warning notification.
      await publishEvent({
        eventType: 'TICKET_AUTO_CLOSE_WARNING',
        payload: {
          tenantId: tenant,
          occurredAt: new Date().toISOString(),
          ticketId: row.ticket_id,
          ticketNumber: row.ticket_number,
          title: row.title,
          scheduledCloseAt: new Date(row.scheduled_close_at).toISOString(),
          contactNameId: row.contact_name_id ?? null,
          assignedTo: row.assigned_to ?? null,
          enteredBy: row.entered_by ?? null,
        },
      });

      await withTransaction(knex, async (trx: Knex.Transaction) => {
        await tenantScopedTable(trx, 'ticket_auto_close_state', tenant)
          .where({ ticket_id: row.ticket_id })
          .update({ warning_sent_at: now.toISOString(), updated_at: trx.fn.now() });

        await writeTicketActivity(trx, {
          tenant,
          ticketId: row.ticket_id,
          eventType: TICKET_ACTIVITY_EVENT.AUTO_CLOSE_WARNING_SENT,
          entityType: TICKET_ACTIVITY_ENTITY.TICKET,
          actor: { actorType: TICKET_ACTIVITY_ACTOR.SYSTEM },
          source: TICKET_ACTIVITY_SOURCE.SYSTEM,
          details: {
            scheduled_close_at: new Date(row.scheduled_close_at).toISOString(),
            recipient: null,
            outcome: 'warning_emitted',
          },
        });
      });
    } catch (error) {
      // Leave warning_sent_at null so the next run retries this warning.
      logger.error(`[auto-close] Failed to send warning for ticket ${row.ticket_id}`, { error });
    }
  }
}

async function closeDueTickets(knex: Knex, tenant: string): Promise<{ closed: number; skipped: number }> {
  const db = tenantDb(knex, tenant);
  const dueQuery = tenantScopedTable(knex, 'ticket_auto_close_state as s', tenant);
  db.tenantJoin(dueQuery, 'board_auto_close_rules as r', 'r.rule_id', 's.rule_id');

  const due = (await dueQuery
    .where('s.scheduled_close_at', '<=', knex.fn.now())
    .where('r.is_enabled', true)
    .select(
      's.ticket_id',
      's.rule_id',
      'r.inactivity_days',
      'r.close_to_status_id',
      'r.suppress_contact_notifications',
      'r.suppress_internal_notifications'
    )) as Array<Record<string, any>>;

  let closed = 0;
  let skipped = 0;

  for (const row of due) {
    try {
      await withTransaction(knex, async (trx: Knex.Transaction) => {
        // Revalidate from current state inside the transaction: the ticket
        // must still match the rule and still be inactive past the deadline.
        const [stillPending] = await computePendingCloses(trx, tenant, row.ticket_id);
        if (!stillPending || stillPending.rule_id !== row.rule_id) {
          await tenantScopedTable(trx, 'ticket_auto_close_state', tenant)
            .where({ ticket_id: row.ticket_id })
            .del();
          skipped++;
          return;
        }
        if (stillPending.scheduled_close_at.getTime() > Date.now()) {
          // Activity arrived after the scan snapshot — push the timer back.
          await tenantScopedTable(trx, 'ticket_auto_close_state', tenant)
            .where({ ticket_id: row.ticket_id })
            .update({
              scheduled_close_at: stillPending.scheduled_close_at.toISOString(),
              warning_sent_at: null,
              updated_at: trx.fn.now(),
            });
          skipped++;
          return;
        }

        const targetStatus = await tenantScopedTable(trx, 'statuses', tenant)
          .where({ status_id: row.close_to_status_id })
          .first();
        if (!targetStatus?.is_closed) {
          throw new Error(`Auto-close target status ${row.close_to_status_id} is missing or not closed`);
        }

        // The comment precedes the status change, mirroring the manual
        // close-with-comment flow; closes_ticket suppresses the duplicate
        // comment email.
        await TicketModel.createComment(
          {
            ticket_id: row.ticket_id,
            content: `Closed automatically after ${row.inactivity_days} days of inactivity.`,
            is_internal: false,
            is_resolution: true,
            author_type: 'system',
            metadata: { closes_ticket: true, source: 'auto_close', rule_id: row.rule_id },
          },
          tenant,
          trx
        );

        await updateTicketInTransaction(
          trx,
          SYSTEM_ACTOR_USER,
          tenant,
          row.ticket_id,
          { status_id: row.close_to_status_id },
          {
            systemActor: true,
            bypassCloseRules: { source: 'auto_close' },
            suppressContactNotifications: Boolean(row.suppress_contact_notifications),
            suppressInternalNotifications: Boolean(row.suppress_internal_notifications),
          }
        );

        await tenantScopedTable(trx, 'ticket_auto_close_state', tenant)
          .where({ ticket_id: row.ticket_id })
          .del();
        closed++;
      });
    } catch (error) {
      // One bad ticket never stalls the sweep; this row retries next run.
      skipped++;
      logger.error(`[auto-close] Failed to close ticket ${row.ticket_id}`, { error });
    }
  }

  return { closed, skipped };
}

export async function autoCloseTicketsHandler(data: AutoCloseTicketsJobData): Promise<void> {
  const { tenantId } = data;
  if (!tenantId) {
    logger.warn('[auto-close] Missing tenantId in job data; skipping');
    return;
  }

  const { knex } = await createTenantKnex();

  const pending = await computePendingCloses(knex, tenantId);
  await syncAutoCloseState(knex, tenantId, pending);
  await sendWarnings(knex, tenantId);
  const { closed, skipped } = await closeDueTickets(knex, tenantId);

  if (pending.length > 0 || closed > 0 || skipped > 0) {
    logger.info(
      `[auto-close] tenant=${tenantId} pending=${pending.length} closed=${closed} skipped=${skipped}`
    );
  }
}
