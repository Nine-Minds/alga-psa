/**
 * Widen the maintenance_type CHECK on asset_maintenance_schedules and
 * asset_maintenance_history to include 'corrective'.
 *
 * Why: three definitions disagreed. The public API Zod schema
 * (server/src/lib/api/schemas/asset.ts) and the mobile client type
 * (ee/mobile/src/api/assets.ts) both accept 'corrective', but the domain type
 * and these CHECK constraints do not — so POST /api/v1/assets/{id}/maintenance
 * with maintenance_type:"corrective" passed validation and then died on a
 * Postgres constraint violation, returning 500 instead of 400.
 *
 * Widening (rather than removing it from the API) is the compatible direction:
 * any client already sending 'corrective' starts working instead of newly
 * breaking, and corrective is a standard maintenance category.
 *
 * Citus notes — these are tenant-distributed tables in production:
 *   * ADD/DROP CONSTRAINT is propagated to shards by Citus automatically; this
 *     needs no run_command_on_shards and no separate EE migration. (There is no
 *     ee/server/migrations/citus/ folder and must never be one — see
 *     docs/architecture/citus-migration-best-practices.md.)
 *   * ADD CONSTRAINT ... CHECK normally takes ACCESS EXCLUSIVE and rescans every
 *     shard. We add NOT VALID (instant, no scan) then VALIDATE separately, which
 *     takes only SHARE UPDATE EXCLUSIVE and does not block reads or writes.
 *   * Skipping validation entirely would be unsound in general, but here the new
 *     constraint is strictly weaker than the one it replaces: every existing row
 *     already satisfied the narrower set, so validation cannot fail. It is run
 *     anyway so the constraint is not left in a NOT VALID state that would let
 *     future bad rows in through a later ALTER.
 *
 * Runs in a transaction: no CONCURRENTLY / distribution calls here.
 */

const TABLES = ['asset_maintenance_schedules', 'asset_maintenance_history'];
const WIDENED = ['preventive', 'corrective', 'inspection', 'calibration', 'replacement'];
const ORIGINAL = ['preventive', 'inspection', 'calibration', 'replacement'];

const list = (values) => values.map((value) => `'${value}'`).join(', ');

async function setCheck(knex, table, values) {
  const constraint = `${table}_maintenance_type_check`;
  await knex.raw(`ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ??`, [table, constraint]);
  await knex.raw(
    `ALTER TABLE ?? ADD CONSTRAINT ?? CHECK (maintenance_type = ANY (ARRAY[${list(values)}]::text[])) NOT VALID`,
    [table, constraint]
  );
  await knex.raw(`ALTER TABLE ?? VALIDATE CONSTRAINT ??`, [table, constraint]);
}

exports.up = async function up(knex) {
  for (const table of TABLES) {
    await setCheck(knex, table, WIDENED);
  }
};

exports.down = async function down(knex) {
  // Narrowing again would fail if any 'corrective' rows exist by then, so clear
  // them to the closest surviving category first rather than aborting the
  // rollback halfway through.
  for (const table of TABLES) {
    await knex(table).where({ maintenance_type: 'corrective' }).update({ maintenance_type: 'replacement' });
    await setCheck(knex, table, ORIGINAL);
  }
};
