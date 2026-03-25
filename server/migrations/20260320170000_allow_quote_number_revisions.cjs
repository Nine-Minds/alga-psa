/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_quotes_tenant_quote_number');
  await knex.raw(`
    CREATE INDEX idx_quotes_tenant_quote_number
    ON quotes (tenant, quote_number)
    WHERE quote_number IS NOT NULL
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_tenant_quote_number_version_unique
    ON quotes (tenant, quote_number, version)
    WHERE quote_number IS NOT NULL
  `);
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_quotes_tenant_quote_number_version_unique');
  await knex.raw('DROP INDEX IF EXISTS idx_quotes_tenant_quote_number');
  await knex.raw(`
    CREATE UNIQUE INDEX idx_quotes_tenant_quote_number
    ON quotes (tenant, quote_number)
    WHERE quote_number IS NOT NULL
  `);
};
