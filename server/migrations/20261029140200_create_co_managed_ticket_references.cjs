const { ensureTenantDistribution, ensureCompositeFk } = require('./utils/citusDistribution.cjs');

// Co-managed L3b1: MSP-side routing row for a customer's shared ticket. It is
// never a second ticket. Deliberately has NO cross-tenant foreign key to the
// customer's work/ticket rows, so it survives departure/deletion of the
// customer tenant for billing and archives. Its own-tenant client/board links
// are plain composite FKs (RESTRICT).
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('co_managed_ticket_references'))) {
    await knex.schema.createTable('co_managed_ticket_references', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('reference_id').notNullable();
      table.uuid('customer_tenant').notNullable();
      table.uuid('relationship_id').notNullable();
      table.uuid('ticket_id').notNullable();
      table.uuid('work_id').notNullable();
      table.uuid('client_id').notNullable();
      table.uuid('board_id').notNullable();
      table.uuid('assigned_to').nullable();
      table.uuid('assigned_team_id').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable();
      table.timestamp('updated_at', { useTz: true }).notNullable();
      table.primary(['tenant', 'reference_id']);
      table.unique(['tenant', 'customer_tenant', 'relationship_id', 'ticket_id']);
      table.check('tenant <> customer_tenant');
    });
  }
  await ensureTenantDistribution(knex, 'co_managed_ticket_references');
  await ensureCompositeFk(knex, { table: 'co_managed_ticket_references', constraint: 'co_ticket_reference_client_fk', columns: ['tenant', 'client_id'], referencedTable: 'clients', referencedColumns: ['tenant', 'client_id'], onDelete: 'RESTRICT' });
  await ensureCompositeFk(knex, { table: 'co_managed_ticket_references', constraint: 'co_ticket_reference_board_fk', columns: ['tenant', 'board_id'], referencedTable: 'boards', referencedColumns: ['tenant', 'board_id'], onDelete: 'RESTRICT' });
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('co_managed_ticket_references'))) return;
  if (await knex('co_managed_ticket_references').first()) {
    throw new Error('Cannot remove retained co-managed ticket references');
  }
  await knex.schema.dropTable('co_managed_ticket_references');
};

exports.config = { transaction: false };
