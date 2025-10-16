/**
 * Adds status column to contracts table with values: 'active', 'draft', 'terminated', 'expired'
 */
exports.up = async function up(knex) {
  // Create enum type for contract status
  await knex.raw(`
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contract_status') THEN
            CREATE TYPE contract_status AS ENUM ('active', 'draft', 'terminated', 'expired');
        END IF;
    END $$;
  `);

  // Add status column
  await knex.raw(`
    ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS status contract_status;
  `);

  // Populate status based on existing is_active field
  // is_active = true -> 'active'
  // is_active = false -> 'draft'
  await knex.raw(`
    UPDATE contracts
    SET status = CASE
      WHEN is_active = true THEN 'active'::contract_status
      ELSE 'draft'::contract_status
    END
    WHERE status IS NULL;
  `);

  // Make status column NOT NULL and set default
  await knex.raw(`
    ALTER TABLE contracts
    ALTER COLUMN status SET NOT NULL,
    ALTER COLUMN status SET DEFAULT 'draft'::contract_status;
  `);
};

exports.down = async function down(knex) {
  // Remove status column
  await knex.schema.alterTable('contracts', (table) => {
    table.dropColumn('status');
  });

  // Drop the enum type
  await knex.raw('DROP TYPE IF EXISTS contract_status');
};
