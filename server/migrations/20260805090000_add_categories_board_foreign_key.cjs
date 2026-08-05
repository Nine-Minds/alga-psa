/**
 * Adds the categories -> boards foreign key that production already carries as
 * `categories_board_fkey`. The channels->boards rename deferred the FK to an EE
 * Citus migration that never runs, so CE drifted: deleting a board silently
 * orphaned its categories instead of failing like prod does.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Detach categories pointing at boards that no longer exist, otherwise the
  // constraint cannot be validated on drifted CE databases.
  await knex.raw(`
    UPDATE categories c
    SET board_id = NULL
    WHERE c.board_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM boards b
        WHERE b.tenant = c.tenant
          AND b.board_id = c.board_id
      )
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'categories_board_fkey'
      ) THEN
        ALTER TABLE categories
        ADD CONSTRAINT categories_board_fkey
        FOREIGN KEY (tenant, board_id)
        REFERENCES boards (tenant, board_id);
      END IF;
    END
    $$;
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.raw('ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_board_fkey');
};

// Citus requires ALTER TABLE with foreign key constraints to run outside a transaction block
exports.config = { transaction: false };
