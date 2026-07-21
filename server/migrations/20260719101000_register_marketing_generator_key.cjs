/**
 * Registers the marketing module as an opportunity-suggestion generator
 * (generator_key 'inbound-lead') by widening the CHECK constraints the
 * opportunities module put on generator_key.
 *
 * This is the opportunities module's designed extension point — a superset
 * enum, not a core -> marketing dependency. Dropping the marketing tables
 * leaves this constraint harmlessly permissive.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
// Citus cannot propagate a multi-subcommand ALTER TABLE ("cannot execute ADD
// CONSTRAINT command with other subcommands") on distributed tables, so each
// DROP/ADD runs as its own statement.
exports.up = async function up(knex) {
  await knex.raw(`
    ALTER TABLE opportunities
    DROP CONSTRAINT opportunities_generator_key_check
  `);
  await knex.raw(`
    ALTER TABLE opportunities
    ADD CONSTRAINT opportunities_generator_key_check
    CHECK (generator_key IS NULL OR generator_key IN ('renewal', 'tm_conversion', 'whitespace', 'asset_aging', 'inbound-lead'))
  `);
  await knex.raw(`
    ALTER TABLE opportunity_suggestions
    DROP CONSTRAINT opportunity_suggestions_generator_key_check
  `);
  await knex.raw(`
    ALTER TABLE opportunity_suggestions
    ADD CONSTRAINT opportunity_suggestions_generator_key_check
    CHECK (generator_key IN ('renewal', 'tm_conversion', 'whitespace', 'asset_aging', 'inbound-lead'))
  `);
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex.raw(`
    ALTER TABLE opportunities
    DROP CONSTRAINT opportunities_generator_key_check
  `);
  await knex.raw(`
    ALTER TABLE opportunities
    ADD CONSTRAINT opportunities_generator_key_check
    CHECK (generator_key IS NULL OR generator_key IN ('renewal', 'tm_conversion', 'whitespace', 'asset_aging'))
  `);
  await knex.raw(`
    ALTER TABLE opportunity_suggestions
    DROP CONSTRAINT opportunity_suggestions_generator_key_check
  `);
  await knex.raw(`
    ALTER TABLE opportunity_suggestions
    ADD CONSTRAINT opportunity_suggestions_generator_key_check
    CHECK (generator_key IN ('renewal', 'tm_conversion', 'whitespace', 'asset_aging'))
  `);
};
