/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  await knex.raw(`
    INSERT INTO next_number (tenant, entity_type, last_number, initial_value, prefix, padding_length)
    SELECT tenant, 'OPPORTUNITY', 0, 1, 'OPP-', 4
    FROM tenants
    ON CONFLICT (tenant, entity_type) DO NOTHING
  `);
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex('next_number').where({ entity_type: 'OPPORTUNITY' }).del();
};
