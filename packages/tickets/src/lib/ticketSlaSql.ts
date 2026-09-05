/**
 * One definition of "SLA breached", shared by the filter and the count.
 *
 * The board header states a breach count; the `slaStatusFilter: 'breached'`
 * filter states a breach *set*. If those two derive the predicate separately,
 * they will eventually disagree — a header reading 3 that opens onto a list of
 * 2 is worse than no header, because the number is what the user trusts. So the
 * predicate is written once, here, and both call sites reference it.
 *
 * The definition itself (unchanged from what optimizedTicketActions applied
 * before this extraction): a ticket with an SLA policy is breached when either
 * clock ran out without being stopped, or when either met-flag was explicitly
 * recorded as false.
 *
 * Plain data (no "use server"), so the server action and the aggregate query can
 * both import it.
 */

/** Column prefix, e.g. `t` for `tickets as t`. */
export type TicketAlias = string;

/**
 * SQL boolean expression, with `?` bind placeholders for the current instant.
 * Use with {@link ticketSlaBreachedBindings} so the placeholder count can never
 * drift from the caller's bind array.
 */
export function ticketSlaBreachedSql(alias: TicketAlias = 't'): string {
  return `(
    ${alias}.sla_policy_id IS NOT NULL
    AND (
      (${alias}.sla_response_due_at < ? AND ${alias}.sla_response_at IS NULL)
      OR (${alias}.sla_resolution_due_at < ? AND ${alias}.sla_resolution_at IS NULL)
      OR ${alias}.sla_response_met = false
      OR ${alias}.sla_resolution_met = false
    )
  )`;
}

/** Bindings for {@link ticketSlaBreachedSql}, in placeholder order. */
export function ticketSlaBreachedBindings(nowIso: string): string[] {
  return [nowIso, nowIso];
}
