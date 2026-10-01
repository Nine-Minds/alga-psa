/**
 * Ticket time → project attribution (alga-2026-0002622).
 *
 * One resolver, reused by every consumer that rolls time up to a project: the
 * billing engine's two time-entry loaders, project budget actuals, the
 * profitability report and the client pulse WIP query.
 *
 * `project_ticket_links` is unique only on (tenant, link_id), so one ticket can
 * carry several links and a naive join would multiply its time entries. The
 * derived table collapses a ticket's flagged links into a single row, and the
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
 * `LEFT JOIN` that exposes `<alias>.project_id` for ticket time entries.
 *
 * @param timeEntryAlias alias of the `time_entries` relation being joined to.
 */
export function ticketProjectAttributionJoin(
  timeEntryAlias: string,
  alias: string = TICKET_PROJECT_ATTRIBUTION_ALIAS,
): string {
  return `LEFT JOIN (
      SELECT tenant, ticket_id,
             MIN(project_id::text)::uuid AS project_id,
             COUNT(DISTINCT project_id) AS project_count
      FROM project_ticket_links
      WHERE bill_under_project
      GROUP BY tenant, ticket_id
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
