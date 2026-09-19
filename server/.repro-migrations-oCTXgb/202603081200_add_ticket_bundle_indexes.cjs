/**
 * Add supporting indexes for bundle-heavy queries.
 *
 * These indexes accelerate:
 * 1. Fetching bundle children/client counts in the ticket list query
 * 2. Aggregating additional agents for tickets
 */

exports.up = async function up(knex) {
  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS "tickets_master_ticket_client_idx"
    ON "tickets" ("tenant", "master_ticket_id", "client_id")
    WHERE "master_ticket_id" IS NOT NULL
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS "ticket_resources_tenant_ticket_additional_idx"
    ON "ticket_resources" ("tenant", "ticket_id", "additional_user_id")
    WHERE "additional_user_id" IS NOT NULL
  `);
};

exports.down = async function down(knex) {
  await knex.schema.raw('DROP INDEX IF EXISTS "ticket_resources_tenant_ticket_additional_idx"');
  await knex.schema.raw('DROP INDEX IF EXISTS "tickets_master_ticket_client_idx"');
};
