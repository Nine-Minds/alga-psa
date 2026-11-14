'use strict';

/**
 * Contact locations: a contact works at one or more of its client's locations.
 *
 *   contact_locations (tenant, contact_name_id, location_id, is_primary, created_at, created_by)
 *
 * The link references the client's `client_locations` row rather than copying the address, so
 * editing the address on the client updates every linked contact. At most one link per contact is
 * primary (partial unique index, not a trigger: Citus rejects triggers on distributed tables).
 *
 * Deleting a contact takes its links with it (CASCADE). Deleting a location a contact still uses is
 * refused at the database (RESTRICT); `deleteLocation` in packages/clients reports the count first
 * so the operator never meets a bare FK error.
 *
 * Citus: `contacts` and `client_locations` are both tenant-scoped, so contact_locations is
 * distributed on `tenant` co-located with `contacts` when `contacts` is distributed, and stays
 * coordinator-local otherwise. Either way both sides of each composite FK share a distribution
 * state, so ensureCompositeFk adds the constraint; where they do not it is skipped rather than
 * guessed, exactly as 20260518120000_add_location_id_to_assets.cjs does. Distribution runs before
 * the FKs: whether an FK is legal is only knowable once the referencing table is distributed.
 *
 * No backfill: existing contacts stay unlinked and the effective-location resolver falls back to
 * the client's default location.
 */

const TABLE = 'contact_locations';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('contact_name_id').notNullable();
      table.uuid('location_id').notNullable();
      table.boolean('is_primary').notNullable().defaultTo(false);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.uuid('created_by');

      table.primary(['tenant', 'contact_name_id', 'location_id']);
    });
  }

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_${TABLE}_primary
    ON ${TABLE} (tenant, contact_name_id)
    WHERE is_primary
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_${TABLE}_location
    ON ${TABLE} (tenant, location_id)
  `);

  const {
    ensureCompositeFk, hasCitus, isDistributed, canCreateDistributedTable,
  } = require('./utils/citusDistribution.cjs');

  // Match contacts' distribution so the composite FKs are legal in both cases.
  if (
    (await hasCitus(knex)) &&
    (await canCreateDistributedTable(knex)) &&
    (await isDistributed(knex, 'contacts')) &&
    !(await isDistributed(knex, TABLE))
  ) {
    await knex.raw(`SELECT create_distributed_table('${TABLE}', 'tenant', colocate_with => 'contacts')`);
  }

  await ensureCompositeFk(knex, {
    table: TABLE,
    constraint: `${TABLE}_contact_foreign`,
    columns: ['tenant', 'contact_name_id'],
    referencedTable: 'contacts',
    referencedColumns: ['tenant', 'contact_name_id'],
    onDelete: 'CASCADE',
  });

  await ensureCompositeFk(knex, {
    table: TABLE,
    constraint: `${TABLE}_location_foreign`,
    // client_locations' primary key is (location_id, tenant); keep that column order.
    columns: ['location_id', 'tenant'],
    referencedTable: 'client_locations',
    referencedColumns: ['location_id', 'tenant'],
    onDelete: 'RESTRICT',
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE);
};

// create_distributed_table cannot run inside a transaction on Citus.
exports.config = { transaction: false };
