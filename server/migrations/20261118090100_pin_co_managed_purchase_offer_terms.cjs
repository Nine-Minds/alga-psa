/**
 * Pin the reviewed catalog terms on the durable co-managed purchase operation (alga-2026-0003362).
 * Nullable and inert on CE and for pre-catalog operations: those resume against the legacy
 * environment price exactly as before. `offer_version_id` has no foreign key: the catalog is an
 * EE platform table and this table is tenant-distributed.
 */
exports.up = async function up(knex) {
  for (const column of ['offer_version_id', 'price_id']) {
    if (!(await knex.schema.hasColumn('co_managed_purchase_operations', column))) {
      await knex.schema.alterTable('co_managed_purchase_operations', (t) => {
        if (column === 'offer_version_id') t.uuid(column); else t.text(column);
      });
    }
  }
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('co_managed_purchase_operations', (t) => { t.dropColumn('offer_version_id'); t.dropColumn('price_id'); });
};
