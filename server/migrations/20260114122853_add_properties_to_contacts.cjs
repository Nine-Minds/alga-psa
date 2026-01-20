/**
 * Citus requires DDL outside of transactions for distributed tables
 */
exports.config = { transaction: false };

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // Add properties JSONB column to contacts table for storing custom field values
    // This follows the same pattern as companies.properties
    // Default to empty object {} to avoid null checks throughout the codebase
    await knex.schema.raw(`
        ALTER TABLE contacts
        ADD COLUMN IF NOT EXISTS properties jsonb NOT NULL DEFAULT '{}'::jsonb
    `);

    // TODO(follow-up-ticket): Add GIN index on contacts.properties once usage patterns are established
    // This mirrors companies.properties which may also benefit from a GIN index for JSONB queries.
    // CREATE INDEX IF NOT EXISTS idx_contacts_properties ON contacts USING GIN (properties);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    await knex.schema.raw(`
        ALTER TABLE contacts
        DROP COLUMN IF EXISTS properties
    `);
};
