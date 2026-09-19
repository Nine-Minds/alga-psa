/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // 1) Add the column first (nullable).
  const hasDefaultPriorityColumn = await knex.schema.hasColumn('boards', 'default_priority_id');
  if (!hasDefaultPriorityColumn) {
    await knex.schema.alterTable('boards', (table) => {
      table.uuid('default_priority_id').nullable();
    });
  }

  // 2) Backfill existing boards so Quick Add can pick a per-board default immediately.
  // - ITIL boards: prefer ITIL level 3 (medium) if present, otherwise lowest order ITIL priority.
  // - Custom boards: prefer lowest order custom priority (non-ITIL).
  // Falls back to any ticket priority if the preferred subset is empty.
  await knex.raw(`
    UPDATE boards b
    SET default_priority_id = (
      SELECT c.priority_id
      FROM (
        -- Preferred subset first.
        SELECT
          p.priority_id,
          0 AS pref,
          p.order_number,
          p.priority_name,
          p.itil_priority_level
        FROM priorities p
        WHERE p.tenant = b.tenant
          AND p.item_type = 'ticket'
          AND (
            (COALESCE(b.priority_type, 'custom') = 'itil' AND p.is_from_itil_standard = TRUE)
            OR
            (COALESCE(b.priority_type, 'custom') <> 'itil' AND (p.is_from_itil_standard IS NULL OR p.is_from_itil_standard = FALSE))
          )

        UNION ALL

        -- Fallback to any ticket priority if the preferred subset is empty.
        SELECT
          p.priority_id,
          1 AS pref,
          p.order_number,
          p.priority_name,
          p.itil_priority_level
        FROM priorities p
        WHERE p.tenant = b.tenant
          AND p.item_type = 'ticket'
      ) c
      ORDER BY
        c.pref ASC,
        -- Prefer ITIL medium when board is ITIL.
        CASE
          WHEN COALESCE(b.priority_type, 'custom') = 'itil' AND c.itil_priority_level = 3 THEN 0
          ELSE 1
        END,
        c.order_number ASC,
        c.priority_name ASC
      LIMIT 1
    )
    WHERE b.default_priority_id IS NULL
  `);

  // 3) Add foreign key constraint (separate statement for Citus compatibility)
  // Note: ON DELETE SET NULL is not supported in CitusDB; priority deletion should be blocked if referenced.
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'boards_default_priority_fk'
      ) THEN
        ALTER TABLE boards
        ADD CONSTRAINT boards_default_priority_fk
        FOREIGN KEY (tenant, default_priority_id)
        REFERENCES priorities (tenant, priority_id);
      END IF;
    END
    $$;
  `);

  // 4) Add index for efficient lookups / joins.
  await knex.raw('CREATE INDEX IF NOT EXISTS boards_default_priority_idx ON boards (tenant, default_priority_id)');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.alterTable('boards', (table) => {
    table.dropIndex(['tenant', 'default_priority_id'], 'boards_default_priority_idx');
    table.dropForeign(['tenant', 'default_priority_id']);
    table.dropColumn('default_priority_id');
  });
};

// Citus requires ALTER TABLE with foreign key constraints to run outside a transaction block
exports.config = { transaction: false };
