/**
 * Co-managed seat technicians are chosen from the arrangement's client's contacts (S34 repair).
 *
 * `co_managed_seat_assignments` holds both the pending invitation rows and the accepted seat rows,
 * so one nullable `contact_id` records which contact each seat technician is. Nullable because
 * rows written before this change have no contact; every row the commands write from here on has one.
 *
 * - A tenant-scoped composite foreign key (tenant, contact_id) -> contacts (tenant, contact_name_id),
 *   added through `ensureCompositeFk`, which skips it where Citus would not enforce it (a distributed
 *   table referencing a coordinator-local one) exactly as the sibling co-managed migrations do. RESTRICT:
 *   a contact that holds a seat is not deleted out from under it.
 * - A partial unique index: a contact holds at most one live seat or pending invitation, on any
 *   arrangement of the sponsor. A revoked assignment frees the contact. The index leads with `tenant`,
 *   the distribution column, as every key in this ledger does.
 *
 * Additive and idempotent. The column is metadata-only (no default, no rewrite).
 */
const { ensureCompositeFk } = require('./utils/citusDistribution.cjs');

const TABLE = 'co_managed_seat_assignments';
const FK = 'co_managed_seat_assignments_contact_fk';
const INDEX = 'co_managed_one_live_seat_per_contact';

/** @param { import("knex").Knex } knex */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  if (!(await knex.schema.hasColumn(TABLE, 'contact_id'))) {
    await knex.schema.alterTable(TABLE, (table) => table.uuid('contact_id').nullable());
  }
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS ${INDEX}
    ON ${TABLE} (tenant, contact_id) WHERE state <> 'revoked' AND contact_id IS NOT NULL`);
  if (await knex.schema.hasTable('contacts')) {
    await ensureCompositeFk(knex, {
      table: TABLE, constraint: FK, columns: ['tenant', 'contact_id'],
      referencedTable: 'contacts', referencedColumns: ['tenant', 'contact_name_id'], onDelete: 'RESTRICT',
    });
  }
};

/** @param { import("knex").Knex } knex */
exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable(TABLE)) || !(await knex.schema.hasColumn(TABLE, 'contact_id'))) return;
  // Never discard which contact a live technician is when an operator rolls back.
  if (await knex(TABLE).whereNotNull('contact_id').first()) {
    throw new Error(`Cannot roll back ${TABLE}.contact_id while assignments name a contact`);
  }
  await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${FK}`);
  await knex.raw(`DROP INDEX IF EXISTS ${INDEX}`);
  await knex.schema.alterTable(TABLE, (table) => table.dropColumn('contact_id'));
};
