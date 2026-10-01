/**
 * Ticket time → project attribution (alga-2026-0002622).
 *
 * One resolver, reused by every consumer that rolls time up to a project: the
 * billing engine's two time-entry loaders, the pre-generation contract-line
 * attribution writer, project budget actuals, the profitability report and the
 * client pulse WIP query.
 *
 * `project_ticket_links` is unique only on (tenant, link_id), so one ticket can
 * carry several links and a naive join would multiply its time entries. The
 * derived table collapses a ticket's billable links into a single row, and the
 * `project_count = 1` predicate means a ticket flagged into two different
 * projects attributes nothing at all — ambiguity is reported to the biller, not
 * guessed at. `MIN(project_id::text)` only has to be well-formed for that
 * single-project case.
 *
 * Grouping by the Citus distribution column (`tenant`) keeps the derived table
 * pushdown-friendly, and the partial index
 * `idx_project_ticket_links_tenant_ticket_billable` matches it column for
 * column.
 *
 * It lives in shared/ rather than next to the engine because
 * `@alga-psa/clients` must not depend on `@alga-psa/billing`.
 */

export const TICKET_PROJECT_ATTRIBUTION_ALIAS = 'ticket_project';

/**
 * Links that may carry a ticket's time: flagged on, and pointing at a project
 * of the ticket's *own* client.
 *
 * Nothing validates the client when a link is made — the link dialog lists
 * tickets unscoped — so without the client predicate a cross-client link would
 * move one client's hour onto another client's project invoice (the loaders'
 * `projects.client_id = ? OR tickets.client_id = ?` gate is satisfied through
 * the linked project). A foreign-client link is never a billing candidate, the
 * same invariant manual ticket invoices already enforce, so it is dropped here
 * rather than counted as ambiguity.
 */
function billableTicketLinkSource(): string {
  return `FROM project_ticket_links link
      JOIN tickets link_ticket
        ON link_ticket.tenant = link.tenant
       AND link_ticket.ticket_id = link.ticket_id
      JOIN projects link_project
        ON link_project.tenant = link.tenant
       AND link_project.project_id = link.project_id
      WHERE link.bill_under_project
        AND link_project.client_id = link_ticket.client_id`;
}

/**
 * `LEFT JOIN` that exposes `<alias>.project_id` for ticket time entries.
 *
 * @param timeEntryAlias alias of the `time_entries` relation being joined to.
 */
export function ticketProjectAttributionJoin(
  timeEntryAlias: string,
  alias: string = TICKET_PROJECT_ATTRIBUTION_ALIAS,
): string {
  return `LEFT JOIN (
      SELECT link.tenant, link.ticket_id,
             MIN(link.project_id::text)::uuid AS project_id,
             COUNT(DISTINCT link.project_id) AS project_count
      ${billableTicketLinkSource()}
      GROUP BY link.tenant, link.ticket_id
    ) ${alias}
      ON ${alias}.tenant = ${timeEntryAlias}.tenant
     AND ${alias}.ticket_id = ${timeEntryAlias}.work_item_id
     AND ${timeEntryAlias}.work_item_type = 'ticket'
     AND ${alias}.project_count = 1`;
}

/**
 * The project a time entry bills under: its phase's project for project-task
 * time, the resolved link project for ticket time.
 */
export function ticketProjectIdExpression(
  phaseAlias: string,
  alias: string = TICKET_PROJECT_ATTRIBUTION_ALIAS,
): string {
  return `COALESCE(${phaseAlias}.project_id, ${alias}.project_id)`;
}

/**
 * Tickets the resolver refuses to attribute because their billable links point
 * at more than one project, as `(tenant, ticket_id)`.
 *
 * Shares `billableTicketLinkSource()` with the resolver so the warning can
 * never disagree with what actually billed.
 */
export function ambiguousTicketProjectLinksQuery(): string {
  return `SELECT link.tenant, link.ticket_id
      ${billableTicketLinkSource()}
      GROUP BY link.tenant, link.ticket_id
      HAVING COUNT(DISTINCT link.project_id) > 1`;
}
