/**
 * Add an optional default notification contact to RMM organization mappings.
 *
 * No database foreign key: Citus rejects ON DELETE SET NULL on a tenant-scoped
 * FK (it would null the distribution column), and the desired behavior is to
 * unlink a deleted contact rather than block its deletion. The reference is
 * cleared in the backend when a contact is deleted (see deleteContact), and the
 * runtime resolver validates the contact on read.
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('rmm_organization_mappings', (table) => {
    table.uuid('default_contact_id').nullable();
    table.index(['tenant', 'default_contact_id'], 'idx_rmm_org_mappings_default_contact');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('rmm_organization_mappings', (table) => {
    table.dropIndex(['tenant', 'default_contact_id'], 'idx_rmm_org_mappings_default_contact');
    table.dropColumn('default_contact_id');
  });
};
