/**
 * Add nullable contact authorship linkage on comments.
 * Adds tenant-scoped FK/index in the same migration.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  await knex.transaction(async (trx) => {
    const hasContactId = await trx.schema.hasColumn('comments', 'contact_id');
    if (!hasContactId) {
      await trx.schema.alterTable('comments', (table) => {
        table.uuid('contact_id').nullable();
      });
    }

    await trx.schema.alterTable('comments', (table) => {
      table.index(['tenant', 'contact_id'], 'comments_tenant_contact_id_idx');
      table
        .foreign(['tenant', 'contact_id'], 'comments_tenant_contact_id_fk')
        .references(['tenant', 'contact_name_id'])
        .inTable('contacts');
    });
  });
};

/**
 * Remove nullable contact authorship linkage from comments.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex.transaction(async (trx) => {
    const hasContactId = await trx.schema.hasColumn('comments', 'contact_id');
    if (hasContactId) {
      await trx.schema.alterTable('comments', (table) => {
        table.dropForeign(['tenant', 'contact_id'], 'comments_tenant_contact_id_fk');
        table.dropIndex(['tenant', 'contact_id'], 'comments_tenant_contact_id_idx');
        table.dropColumn('contact_id');
      });
    }
  });
};
