/**
 * Ticket time → project attribution (alga-2026-0002622), shared by the billing
 * engine's two time-entry loaders, the contract-line attribution writer,
 * project actuals, the profitability report and the client pulse WIP query.
 *
 * `project_ticket_links` is unique only on (tenant, link_id), so a naive join
 * would multiply a multi-linked ticket's time entries; the derived table
 * collapses them to one row. `project_count = 1` means a ticket flagged into
 * two projects attributes nothing — ambiguity is reported, not guessed at — so
 * `MIN(project_id::text)` only has to be well-formed for the single case.
 *
 * Grouping by the distribution column (`tenant`) keeps this pushdown-friendly;
 * `idx_project_ticket_links_tenant_ticket_billable` matches it column for
 * column. Lives in shared/ because `@alga-psa/clients` must not depend on
 * `@alga-psa/billing`.
 */

export const TICKET_PROJECT_ATTRIBUTION_ALIAS = 'ticket_project';

/**
 * Links that may carry a ticket's time: flagged on, and pointing at a project
 * of the ticket's *own* client.
 *
 * Link creation never validates the client (the dialog lists tickets unscoped),
 * so without this predicate a cross-client link would bill one client's hour
 * onto another's project. Dropped rather than counted as ambiguity, matching
 * what manual ticket invoices already enforce.
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

/**
 * The distinct projects one ticket's billable links point at, for callers that
 * show where a single ticket bills: exactly one row means that project carries
 * its time, anything else means none does. Bindings: `[tenant, ticketId]`.
 */
export function billableTicketProjectsQuery(): string {
  return `SELECT DISTINCT link.project_id
      ${billableTicketLinkSource()}
        AND link.tenant = ?
        AND link.ticket_id = ?`;
}
