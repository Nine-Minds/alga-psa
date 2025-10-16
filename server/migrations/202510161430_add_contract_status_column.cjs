/**
 * Adds status column to contracts table with values: 'active', 'draft', 'terminated', 'expired'
 */
exports.up = async function up(knex) {
  // Add status column as text to avoid distributed enum limitations
  await knex.raw(`
    ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS status text;
  `);

  // Populate status based on existing is_active field
  // is_active = true -> 'active'
  // is_active = false -> 'draft'
  await knex.raw(`
    UPDATE contracts
    SET status = CASE
      WHEN is_active = true THEN 'active'
      ELSE 'draft'
    END
    WHERE status IS NULL;
  `);

  // Make status column NOT NULL and set default
  await knex.raw(`
    ALTER TABLE contracts
    ALTER COLUMN status SET NOT NULL,
    ALTER COLUMN status SET DEFAULT 'draft';
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`
    ALTER TABLE contracts
    DROP COLUMN IF EXISTS status;
  `);
};
