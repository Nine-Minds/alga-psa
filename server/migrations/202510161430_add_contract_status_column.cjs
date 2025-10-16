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

  // Add check constraint for valid statuses
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'contracts_status_check'
      ) THEN
        ALTER TABLE contracts
        ADD CONSTRAINT contracts_status_check
        CHECK (status IN ('active', 'draft', 'terminated', 'expired'));
      END IF;
    END $$;
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'contracts_status_check'
      ) THEN
        ALTER TABLE contracts
        DROP CONSTRAINT contracts_status_check;
      END IF;
    END $$;
  `);

  await knex.raw(`
    ALTER TABLE contracts
    DROP COLUMN IF EXISTS status;
  `);
};
