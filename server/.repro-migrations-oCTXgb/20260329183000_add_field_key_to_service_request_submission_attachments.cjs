/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('service_request_submission_attachments', 'field_key');
  if (!hasColumn) {
    await knex.schema.alterTable('service_request_submission_attachments', (table) => {
      table.text('field_key').nullable();
    });
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('service_request_submission_attachments', 'field_key');
  if (hasColumn) {
    await knex.schema.alterTable('service_request_submission_attachments', (table) => {
      table.dropColumn('field_key');
    });
  }
};

exports.config = { transaction: false };
