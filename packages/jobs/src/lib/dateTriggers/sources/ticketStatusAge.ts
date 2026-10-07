import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { Temporal } from '@js-temporal/polyfill';
import type { DateOccurrence, DateTriggerScanContext, DateTriggerSource } from '../types';

/** The launcher passes params already validated and normalized (see normalizeTicketStatusAgeParams). */
type StatusAgeParams = {
  statusName: string;
  boardId: string | null;
  days: number;
  repeatEveryDays: number | null;
  requireNoActivity: boolean;
};

/**
 * "Last activity" for `requireNoActivity`: the newest comment, or the newest audit-log entry a person
 * or integration made. Deliberately NOT tickets.updated_at: the auto-close warning, SLA bookkeeping,
 * response-state updates and bundle propagation all bump updated_at without anyone touching the ticket,
 * which would keep an idle ticket "active" forever. System-actor audit rows and the auto-close warning
 * are excluded for the same reason.
 */
const LAST_ACTIVITY_SQL = `GREATEST(
  (SELECT MAX(c.created_at) FROM comments c WHERE c.tenant = t.tenant AND c.ticket_id = t.ticket_id),
  (SELECT MAX(l.occurred_at) FROM ticket_audit_logs l
     WHERE l.tenant = t.tenant AND l.ticket_id = t.ticket_id
       AND l.actor_type <> 'system' AND l.event_type <> 'TICKET_AUTO_CLOSE_WARNING_SENT')
)`;

/** Whole days between two YYYY-MM-DD dates. */
const daysBetween = (from: string, to: string): number =>
  Temporal.PlainDate.from(from).until(Temporal.PlainDate.from(to), { largestUnit: 'day' }).days;

export const ticketStatusAgeSource: DateTriggerSource = {
  id: 'ticket.status_age',
  async findOccurrences(knex: Knex, tenant: string, _fromDate: string, _toDate: string, context?: DateTriggerScanContext): Promise<DateOccurrence[]> {
    if (!context?.params) throw new Error('ticket.status_age requires trigger params');
    const params = context.params as unknown as StatusAgeParams;
    const { today, timezone } = context;
    const lastDueAnchorDate = Temporal.PlainDate.from(today).subtract({ days: params.days }).toString();
    const dayAfterLastDueAnchorDate = Temporal.PlainDate.from(lastDueAnchorDate).add({ days: 1 }).toString();

    // The anchor is when the ticket entered its status; with requireNoActivity, the later of that and
    // the last activity. status_changed_at is nullable (re-runnable backfill) so fall back to entered_at like the backfill does (tickets has no created_at).
    const statusEnteredSql = 'COALESCE(t.status_changed_at, t.entered_at)';
    const anchorSql = params.requireNoActivity ? `GREATEST(${statusEnteredSql}, ${LAST_ACTIVITY_SQL})` : statusEnteredSql;

    const query = tenantDb(knex, tenant).table('tickets as t')
      .join('statuses as s', function joinStatus() { this.on('s.status_id', '=', 't.status_id').andOn('s.tenant', '=', 't.tenant'); })
      .leftJoin('boards as b', function joinBoard() { this.on('b.board_id', '=', 't.board_id').andOn('b.tenant', '=', 't.tenant'); })
      .select('t.ticket_id', 't.ticket_number', 't.title', 't.status_id', 't.board_id', 't.client_id', 't.contact_name_id', 't.assigned_to')
      .select({ status_name: 's.name', board_name: 'b.board_name' })
      .select(knex.raw(`${anchorSql} as anchor_at`))
      .select(knex.raw(`(${anchorSql} AT TIME ZONE ?)::date::text as anchor_local_date`, [timezone]))
      .select(knex.raw(`${statusEnteredSql} as status_entered_at`))
      .select(knex.raw(`(${statusEnteredSql} AT TIME ZONE ?)::date::text as status_entered_local_date`, [timezone]))
      .whereRaw('lower(s.name) = ?', [params.statusName.toLowerCase()])
      .where('s.is_closed', false)
      .orderBy('t.ticket_id', 'asc');
    if (params.boardId) query.where('t.board_id', params.boardId);
    // Sargable pre-filter on the indexed column. The precise tenant-local-date test follows below; for
    // requireNoActivity the anchor can only be later than status entry, so the pre-filter still holds.
    query.whereRaw(`${statusEnteredSql} < (?::date::timestamp AT TIME ZONE ?)`, [dayAfterLastDueAnchorDate, timezone]);
    const rows = await query;

    // Client name is not needed to qualify; fetch it for the qualifying tickets only.
    const clientIds = Array.from(new Set(rows.map((r: any) => r.client_id).filter(Boolean)));
    const clientNames = new Map<string, string>();
    if (clientIds.length > 0) {
      const clients = await tenantDb(knex, tenant).table('clients').select('client_id', 'client_name').whereIn('client_id', clientIds);
      for (const c of clients) clientNames.set(c.client_id, c.client_name);
    }

    const occurrences: DateOccurrence[] = [];
    for (const r of rows as any[]) {
      const anchorDate = String(r.anchor_local_date);
      const first = Temporal.PlainDate.from(anchorDate).add({ days: params.days });
      if (Temporal.PlainDate.compare(first, Temporal.PlainDate.from(today)) > 0) continue;
      const elapsed = daysBetween(first.toString(), today);
      const repeatIndex = params.repeatEveryDays ? Math.floor(elapsed / params.repeatEveryDays) : 0;
      const occursOn = first.add({ days: repeatIndex * (params.repeatEveryDays ?? 0) }).toString();
      const enteredAt = new Date(r.status_entered_at).toISOString();
      const anchorAt = new Date(r.anchor_at).toISOString();
      occurrences.push({
        entityId: r.ticket_id,
        clientId: r.client_id ?? '',
        occursOn,
        // The full anchor timestamp: leaving and re-entering the status (even the same day) is a new cycle.
        cycleKey: anchorAt,
        payload: {
          ticketId: r.ticket_id,
          ticketNumber: r.ticket_number,
          title: r.title,
          statusId: r.status_id,
          statusName: r.status_name,
          boardId: r.board_id,
          boardName: r.board_name ?? '',
          clientId: r.client_id ?? undefined,
          clientName: r.client_id ? clientNames.get(r.client_id) : undefined,
          contactId: r.contact_name_id ?? undefined,
          assignedUserId: r.assigned_to ?? undefined,
          enteredStatusAt: enteredAt,
          daysInStatus: Math.max(0, daysBetween(String(r.status_entered_local_date), today)),
          repeatIndex,
        },
      });
    }
    return occurrences;
  },
};
