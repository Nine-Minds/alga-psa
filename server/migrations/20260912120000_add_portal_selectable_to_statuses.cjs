/**
 * Per-status control over which ticket statuses client portal users may set.
 *
 * A single `ADD COLUMN ... NOT NULL DEFAULT true` is deliberate:
 *
 *   - `statuses` is a Citus distributed table (sharded on `tenant`), and a
 *     single ADD COLUMN with a default never scans the parent heap, so it
 *     sidesteps the stranded-coordinator-row failure mode that makes a separate
 *     `ALTER ... SET NOT NULL` fail with a spurious "contains null values".
 *   - The column default backfills every existing row uniformly. There is no
 *     non-uniform per-row value to compute, so no select-then-update backfill
 *     (the `client_portal_config` idiom) is needed.
 *   - Defaulting to true makes the deploy a no-op: every status stays
 *     selectable until an admin says otherwise.
 *
 * One subcommand per ALTER: Citus rejects an ALTER carrying two utility
 * subcommands with "cannot execute multiple utility events".
 */

exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('statuses', 'portal_selectable'))) {
    await knex.schema.alterTable('statuses', (table) => {
      table.boolean('portal_selectable').notNullable().defaultTo(true);
    });
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('statuses', 'portal_selectable')) {
    await knex.schema.alterTable('statuses', (table) => {
      table.dropColumn('portal_selectable');
    });
  }
};
