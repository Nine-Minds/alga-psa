/**
 * Add nullable contact authorship linkage on comments.
 * FK and index are added in a follow-up migration step.
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
        table.dropColumn('contact_id');
      });
    }
  });
};
