const { ensureTenantDistribution, ensureCompositeFk } = require('./utils/citusDistribution.cjs');

// Co-managed L3b1: durable responsibility for a shared ticket. One row per
// (relationship, ticket); `revision` is the optimistic token for every handoff
// command. First-escalation columns are nullable so a technician can be
// pre-assigned before the first escalation (customer-handled, grant not open).
// New table only; no trigger (Citus skips them) - append-only is enforced in app code.
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('co_management_ticket_work'))) {
    await knex.schema.createTable('co_management_ticket_work', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('relationship_id').notNullable();
      table.uuid('ticket_id').notNullable();
      table.uuid('work_id').notNullable();
      table.integer('revision').notNullable();
      table.text('responsibility').notNullable();
      table.boolean('can_collaborate').notNullable().defaultTo(true);
      table.timestamp('grant_revoked_at', { useTz: true }).nullable();
      table.timestamp('first_escalated_at', { useTz: true }).nullable();
      table.timestamp('last_transition_at', { useTz: true }).nullable();
      table.primary(['tenant', 'relationship_id', 'ticket_id']);
      table.unique(['tenant', 'work_id']);
      table.check('revision > 0');
      table.check("responsibility IN ('customer', 'msp')");
      table.check(
        `(first_escalated_at IS NOT NULL AND last_transition_at IS NOT NULL) OR
         (first_escalated_at IS NULL AND last_transition_at IS NULL AND responsibility = 'customer' AND grant_revoked_at IS NOT NULL AND can_collaborate = false)`,
        [],
        'co_ticket_work_escalation_state_check'
      );
    });
  }
  await ensureTenantDistribution(knex, 'co_management_ticket_work');
  await ensureCompositeFk(knex, { table: 'co_management_ticket_work', constraint: 'co_ticket_work_relationship_fk', columns: ['tenant', 'relationship_id'], referencedTable: 'co_management_relationships', referencedColumns: ['tenant', 'relationship_id'], onDelete: 'CASCADE' });
  await ensureCompositeFk(knex, { table: 'co_management_ticket_work', constraint: 'co_ticket_work_ticket_fk', columns: ['tenant', 'ticket_id'], referencedTable: 'tickets', referencedColumns: ['tenant', 'ticket_id'], onDelete: 'CASCADE' });
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('co_management_ticket_work'))) return;
  if (await knex('co_management_ticket_work').first()) {
    throw new Error('Cannot remove retained co-managed ticket work');
  }
  await knex.schema.dropTable('co_management_ticket_work');
};

exports.config = { transaction: false };
