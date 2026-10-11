const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'co_management_workflow_ticket_emails';
exports.up = async function (knex) {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    table.uuid('tenant').notNullable(); table.string('delivery_key', 64).notNullable();
    table.uuid('workflow_run_id').notNullable(); table.uuid('workflow_id').notNullable(); table.integer('workflow_version').notNullable();
    table.uuid('actor_user_id').notNullable(); table.uuid('ticket_id').notNullable();
    table.uuid('client_id').notNullable(); table.uuid('contact_id').notNullable();
    table.timestamp('closed_at', { useTz: true }).notNullable(); table.jsonb('email').notNullable().defaultTo('{}');
    table.string('status', 16).notNullable().defaultTo('pending'); table.integer('attempt_count').notNullable().defaultTo(0);
    table.timestamp('next_attempt_at', { useTz: true }).nullable().defaultTo(knex.fn.now());
    table.timestamp('completed_at', { useTz: true }).nullable(); table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.string('error_code', 100).nullable(); table.primary(['tenant', 'delivery_key']);
    table.index(['tenant', 'status', 'next_attempt_at'], 'co_management_workflow_ticket_email_due_idx');
    table.check("attempt_count >= 0 AND workflow_version > 0 AND jsonb_typeof(email) = 'object'");
    table.check("(status = 'pending' AND next_attempt_at IS NOT NULL AND completed_at IS NULL) OR (status IN ('delivered', 'skipped', 'failed') AND next_attempt_at IS NULL AND completed_at IS NOT NULL)");
    // Owner-local soft references preserve delivery history after source deletion.
    // Recipient addresses and canonical ticket content are reloaded for delivery.
  });
  await ensureTenantDistribution(knex, TABLE);
};
exports.down = async function (knex) {
  if (await knex(TABLE).first()) throw new Error('Cannot discard retained workflow ticket email history');
  await knex.schema.dropTable(TABLE);
};
exports.config = { transaction: false };
