/**
 * time_entry_suggestion_dismissals (2026-10-10)
 *
 * A user's "not needed" decision for a work-trail time-entry suggestion, keyed per
 * (user, work item, local work date). Dismissals do not resurface when later activity arrives that
 * day. See docs/plans/2026-10-10-split-ticket-time-tracking-plan.md sections 4 and 8.
 *
 * Created empty and distributed immediately (no stale-local-heap risk); the unique index includes
 * `tenant`. Modelled on 20261006120000_create_board_notification_rules.cjs.
 */
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

async function addForeignKeyIfMissing(knex, constraintName, sql) {
  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = '${constraintName}'
      ) THEN
        ${sql};
      END IF;
    END $$;
  `);
}

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('time_entry_suggestion_dismissals'))) {
    await knex.schema.createTable('time_entry_suggestion_dismissals', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('dismissal_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('user_id').notNullable();
      table.text('work_item_type').notNullable();
      table.uuid('work_item_id').notNullable();
      table.date('work_date').notNullable();
      table.timestamp('dismissed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'dismissal_id']);
      table.unique(
        ['tenant', 'user_id', 'work_item_type', 'work_item_id', 'work_date'],
        { indexName: 'time_entry_suggestion_dismissals_unique_uq' }
      );
    });
  }

  // Distribute before FKs - Citus requires both sides distributed first.
  await ensureTenantDistribution(knex, 'time_entry_suggestion_dismissals');

  await addForeignKeyIfMissing(knex, 'time_entry_suggestion_dismissals_user_fkey', `
    ALTER TABLE time_entry_suggestion_dismissals
      ADD CONSTRAINT time_entry_suggestion_dismissals_user_fkey
      FOREIGN KEY (tenant, user_id) REFERENCES users(tenant, user_id)
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('time_entry_suggestion_dismissals');
};

// Citus requires FK manipulation to run outside a transaction block.
exports.config = { transaction: false };
