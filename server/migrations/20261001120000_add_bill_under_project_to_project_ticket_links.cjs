/**
 * Linking a ticket to a project task means the ticket's time is project work
 * (alga-2026-0002622). The choice lives on the link so a reference-only link
 * can opt out without touching time entries.
 *
 * `ADD COLUMN ... NOT NULL DEFAULT true` is metadata-only on Postgres 11+ and
 * on a Citus distributed table, so every existing link is backfilled to true
 * without rewriting the shards. Transactions are disabled to match the
 * neighbouring index migration (20260127140000): index creation on a
 * distributed table should not sit inside the migration transaction.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.raw(`
    ALTER TABLE project_ticket_links
    ADD COLUMN IF NOT EXISTS bill_under_project boolean NOT NULL DEFAULT true
  `);

  // Serves the per-ticket attribution resolver (ticketProjectAttribution.ts),
  // which groups the flagged links of one ticket by the distribution column.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_project_ticket_links_tenant_ticket_billable
    ON project_ticket_links (tenant, ticket_id)
    WHERE bill_under_project
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_project_ticket_links_tenant_ticket_billable');
  await knex.raw('ALTER TABLE project_ticket_links DROP COLUMN IF EXISTS bill_under_project');
};

exports.config = { transaction: false };
