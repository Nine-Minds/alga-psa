const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'co_management_in_app_receipts';
exports.up = async function (knex) {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    table.uuid('tenant').notNullable(); table.text('delivery_key').notNullable();
    table.uuid('event_id').notNullable(); table.uuid('recipient_user_id').notNullable();
    // Soft qualified historical references; customer deletion cannot erase MSP receipts.
    table.uuid('customer_tenant').notNullable(); table.uuid('relationship_id').notNullable();
    table.uuid('ticket_id').notNullable(); table.uuid('comment_id').notNullable();
    table.uuid('notification_id').nullable(); table.string('outcome', 16).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'delivery_key']);
    table.index(['tenant', 'customer_tenant', 'relationship_id', 'ticket_id'], 'co_management_in_app_resource_idx');
    table.check('tenant <> customer_tenant');
    table.check("(outcome IS NULL AND notification_id IS NULL) OR (outcome IS NOT NULL AND ((outcome = 'disabled' AND notification_id IS NULL) OR (outcome = 'created' AND notification_id IS NOT NULL)))");
  });
  await ensureTenantDistribution(knex, TABLE);
};
exports.down = async function (knex) {
  if (await knex.schema.hasTable(TABLE) && await knex(TABLE).first()) throw new Error('Cannot discard retained co-managed notification receipts');
  await knex.schema.dropTableIfExists(TABLE);
};
exports.config = { transaction: false };
