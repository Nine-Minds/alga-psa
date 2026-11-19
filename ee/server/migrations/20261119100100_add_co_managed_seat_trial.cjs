/** Hosted EE co-managed Seat pilot ledger and allocation funding source. */
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

const TABLES = ['co_managed_seat_trials', 'co_managed_seat_trial_milestones'];

exports.up = async function up(knex) {

  if (!(await knex.schema.hasTable('co_managed_seat_trials'))) {
    await knex.schema.createTable('co_managed_seat_trials', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('trial_id').notNullable();
      table.uuid('client_id').notNullable();
      table.uuid('arrangement_id').notNullable();
      table.uuid('allocation_id').notNullable();
      table.uuid('assignment_id').notNullable();
      table.text('state').notNullable().defaultTo('pending');
      table.timestamp('activated_at', { useTz: true }).nullable();
      table.timestamp('deadline_at', { useTz: true }).nullable();
      table.text('conversion_state').notNullable().defaultTo('none');
      table.uuid('conversion_operation_id').nullable();
      table.integer('quoted_quantity').nullable();
      table.integer('revision').notNullable().defaultTo(1);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'trial_id']);
      // One claim per sponsor, retained after cancellation, expiry, archival and conversion.
      table.unique(['tenant']);
      table.unique(['tenant', 'arrangement_id']);
      table.unique(['tenant', 'allocation_id']);
      table.unique(['tenant', 'assignment_id']);
      table.check("state IN ('pending', 'active', 'ended', 'expired', 'paid')");
      table.check("conversion_state IN ('none', 'pending', 'cancelled', 'failed', 'paid')");
      table.check('(activated_at IS NULL) = (deadline_at IS NULL)');
      table.check("activated_at IS NULL OR deadline_at = activated_at + interval '360 hours'");
      table.check('quoted_quantity IS NULL OR quoted_quantity > 0');
      table.check('revision > 0');
    });
  }
  if (!(await knex.schema.hasTable('co_managed_seat_trial_milestones'))) {
    await knex.schema.createTable('co_managed_seat_trial_milestones', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('trial_id').notNullable();
      table.text('milestone').notNullable();
      table.timestamp('recorded_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'trial_id', 'milestone']);
      table.check("milestone IN ('technician_sign_in', 'shared_ticket_work', 'converted')");
    });
  }
  for (const name of TABLES) await ensureTenantDistribution(knex, name);
};

exports.down = async function down(knex) {
  const pilots = await knex('co_managed_seat_trials').first();
  if (pilots) throw new Error('Cannot remove co-managed Seat trial funding while pilot claims exist');
  for (const name of [...TABLES].reverse()) await knex.schema.dropTableIfExists(name);
};
exports.config = { transaction: false };
