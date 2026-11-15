/**
 * Co-managed seat and workspace shapes on one seat pool, slice S1 (F003).
 *
 * `co_managed_allocations` learns a second kind of allocation. A `workspace` row is what the
 * table holds today: seats taken for a customer tenant under a relationship. A `seat` row takes
 * seats for one of the sponsor's own clients and has no customer tenant and no relationship.
 *
 * Expand-only and N-1 compatible:
 * - `allocation_kind` has a constant default, so every existing row reads as `workspace` without
 *   a rewrite, and writers that never name the column keep producing workspace rows.
 * - `sponsor_client_id` is nullable and is not required on workspace rows.
 * - `customer_tenant` and `relationship_id` lose NOT NULL; the kind-aware CHECK below keeps them
 *   required for workspace rows. A NOT VALID check is still enforced on every new or updated
 *   row, so there is no window in which a workspace row can lose its target.
 * - The original anonymous `tenant <> customer_tenant` check and the `co_managed_one_live_allocation`
 *   index stay. Both already pass a NULL `customer_tenant`.
 *
 * The CHECKs are added NOT VALID (no scan under the ALTER lock). 20261111100100 validates them
 * and builds the live-seat index, in its own non-transactional file.
 *
 * No FK, no trigger, no backfill; one utility statement per raw call (the table is distributed
 * on Citus). Idempotent: an already-present constraint is left alone, so a re-run never
 * un-validates it.
 */
const TABLE = 'co_managed_allocations';
const KIND_CHECK = 'co_managed_allocations_kind_check';
const TARGET_CHECK = 'co_managed_allocations_kind_target_check';

async function hasConstraint(knex, name) {
  const { rows } = await knex.raw(
    `SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass`,
    [name, TABLE]
  );
  return rows.length > 0;
}

/** @param { import("knex").Knex } knex */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;

  await knex.raw(`ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS allocation_kind text NOT NULL DEFAULT 'workspace'`);
  await knex.raw(`ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS sponsor_client_id uuid`);

  if (!(await hasConstraint(knex, KIND_CHECK))) {
    await knex.raw(`
      ALTER TABLE ${TABLE} ADD CONSTRAINT ${KIND_CHECK}
        CHECK (allocation_kind IN ('workspace', 'seat')) NOT VALID
    `);
  }
  // The target of an allocation follows its kind. The inequality repeats the original anonymous
  // check for workspace rows, so the kind-aware constraint states the whole rule on its own.
  if (!(await hasConstraint(knex, TARGET_CHECK))) {
    await knex.raw(`
      ALTER TABLE ${TABLE} ADD CONSTRAINT ${TARGET_CHECK}
        CHECK (
          (allocation_kind = 'workspace'
            AND customer_tenant IS NOT NULL AND relationship_id IS NOT NULL
            AND tenant <> customer_tenant)
          OR
          (allocation_kind = 'seat'
            AND sponsor_client_id IS NOT NULL
            AND customer_tenant IS NULL AND relationship_id IS NULL)
        ) NOT VALID
    `);
  }

  // Only after the kind-aware check is in place. DROP NOT NULL is a no-op when already nullable.
  await knex.raw(`ALTER TABLE ${TABLE} ALTER COLUMN customer_tenant DROP NOT NULL`);
  await knex.raw(`ALTER TABLE ${TABLE} ALTER COLUMN relationship_id DROP NOT NULL`);
};

/** @param { import("knex").Knex } knex */
exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  // Never discard live capacity: a seat allocation cannot be expressed in the old shape.
  if (await knex.schema.hasColumn(TABLE, 'allocation_kind')) {
    const seat = await knex(TABLE)
      .where('allocation_kind', '<>', 'workspace')
      .orWhereNull('customer_tenant')
      .orWhereNull('relationship_id')
      .first('allocation_id');
    if (seat) throw new Error(`Cannot roll back allocation kinds while ${TABLE} holds seat allocations`);
  }
  await knex.raw(`ALTER TABLE ${TABLE} ALTER COLUMN customer_tenant SET NOT NULL`);
  await knex.raw(`ALTER TABLE ${TABLE} ALTER COLUMN relationship_id SET NOT NULL`);
  await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${TARGET_CHECK}`);
  await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${KIND_CHECK}`);
  await knex.raw(`ALTER TABLE ${TABLE} DROP COLUMN IF EXISTS sponsor_client_id`);
  await knex.raw(`ALTER TABLE ${TABLE} DROP COLUMN IF EXISTS allocation_kind`);
};
