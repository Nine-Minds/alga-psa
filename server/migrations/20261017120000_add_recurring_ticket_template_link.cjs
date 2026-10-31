'use strict';

/**
 * Migration A (additive) for "recurring tickets on ticket templates".
 *
 *   ticket_templates.offer_for_manual_use              R5: hide migrated templates from the manual picker
 *   recurring_ticket_definitions.ticket_template_id    the live link to the shared template (nullable until
 *                                                      migration C, after #3728 has merged and the
 *                                                      equivalence test passed on a prod-shaped clone)
 *   recurring_ticket_definitions.overrides             definition-level overrides (same grouped schema as the
 *                                                      per-client overrides)
 *   FK (tenant, ticket_template_id) -> ticket_templates (tenant, template_id) ON DELETE RESTRICT   (R3)
 *
 * The legacy content columns (title_template, board_id, priority_id, ...) STAY in the table but the
 * application no longer reads or writes them, so the ones that were NOT NULL are relaxed here. Dropping
 * them is migration C and is deliberately not part of this draft.
 *
 * Citus: both tables are tenant-distributed and co-located (`colocate_with => 'tenants'`), and the FK
 * includes the distribution column, so it is allowed. It is added after the columns exist, guarded, and
 * skipped with a warning (never failed) if the two tables are not co-located distributed tables - the
 * application-level guard in deleteTicketTemplate still holds in that case.
 */

const DEFINITIONS = 'recurring_ticket_definitions';
const TEMPLATES = 'ticket_templates';
const FK_NAME = `${DEFINITIONS}_ticket_template_foreign`;
const LEGACY_NOT_NULL = ['title_template', 'board_id', 'priority_id'];

async function constraintExists(knex, tableName, constraintName) {
  const result = await knex.raw(
    `SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass) AS present`,
    [constraintName, tableName]
  );
  return Boolean(result.rows?.[0]?.present);
}

async function colocationOf(knex, tableName) {
  const citus = await knex.raw("SELECT to_regclass('pg_catalog.pg_dist_partition') IS NOT NULL AS has_citus");
  if (!citus.rows?.[0]?.has_citus) return { citus: false, colocationId: null };
  const result = await knex.raw(
    'SELECT colocationid FROM pg_dist_partition WHERE logicalrelid = ?::regclass',
    [tableName]
  );
  return { citus: true, colocationId: result.rows?.[0]?.colocationid ?? null };
}

exports.up = async function up(knex) {
  await knex.raw(`ALTER TABLE ${TEMPLATES} ADD COLUMN IF NOT EXISTS offer_for_manual_use boolean NOT NULL DEFAULT true`);
  await knex.raw(`ALTER TABLE ${DEFINITIONS} ADD COLUMN IF NOT EXISTS ticket_template_id uuid NULL`);
  await knex.raw(`ALTER TABLE ${DEFINITIONS} ADD COLUMN IF NOT EXISTS overrides jsonb NOT NULL DEFAULT '{}'::jsonb`);
  for (const column of LEGACY_NOT_NULL) {
    await knex.raw(`ALTER TABLE ${DEFINITIONS} ALTER COLUMN ${column} DROP NOT NULL`);
  }

  // migration-lint: allow 1 - retroactive: index on recurring_ticket_definitions built inside the migration transaction; merged before the lint existed
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_${DEFINITIONS}_ticket_template
    ON ${DEFINITIONS} (tenant, ticket_template_id)
  `);

  // Foreign key, after distribution. A composite key with a NULL ticket_template_id is not enforced
  // (MATCH SIMPLE), so definitions awaiting migration B are unaffected.
  if (!(await constraintExists(knex, DEFINITIONS, FK_NAME))) {
    const [definitions, templates] = await Promise.all([colocationOf(knex, DEFINITIONS), colocationOf(knex, TEMPLATES)]);
    const bothColocated = !definitions.citus || (definitions.colocationId !== null && definitions.colocationId === templates.colocationId);
    if (bothColocated) {
      // migration-lint: allow 2 - retroactive: FK added only when both tables are colocated and guarded by a constraint-exists probe; merged before the lint existed
      await knex.raw(
        `ALTER TABLE ${DEFINITIONS} ADD CONSTRAINT ${FK_NAME}
         FOREIGN KEY (tenant, ticket_template_id) REFERENCES ${TEMPLATES} (tenant, template_id) ON DELETE RESTRICT`
      );
    } else {
      console.warn(`[${FK_NAME}] skipped: ${DEFINITIONS} and ${TEMPLATES} are not co-located distributed tables`);
    }
  }
};

exports.down = async function down(knex) {
  await knex.raw(`ALTER TABLE ${DEFINITIONS} DROP CONSTRAINT IF EXISTS ${FK_NAME}`);
  await knex.raw(`DROP INDEX IF EXISTS idx_${DEFINITIONS}_ticket_template`);

  // Definitions created after this migration carry no legacy content: fill it from their template so
  // the NOT NULL constraints can come back. Fails loudly if a template has no board or priority.
  await knex.raw(`
    UPDATE ${DEFINITIONS} d
    SET title_template = COALESCE(d.title_template, t.title),
        board_id = COALESCE(d.board_id, t.board_id),
        priority_id = COALESCE(d.priority_id, t.priority_id)
    FROM ${TEMPLATES} t
    WHERE t.tenant = d.tenant AND t.template_id = d.ticket_template_id
      AND (d.title_template IS NULL OR d.board_id IS NULL OR d.priority_id IS NULL)
  `);
  for (const column of LEGACY_NOT_NULL) {
    await knex.raw(`ALTER TABLE ${DEFINITIONS} ALTER COLUMN ${column} SET NOT NULL`);
  }
  await knex.raw(`ALTER TABLE ${DEFINITIONS} DROP COLUMN IF EXISTS overrides`);
  await knex.raw(`ALTER TABLE ${DEFINITIONS} DROP COLUMN IF EXISTS ticket_template_id`);
  await knex.raw(`ALTER TABLE ${TEMPLATES} DROP COLUMN IF EXISTS offer_for_manual_use`);
};

// Mirrors the table migrations: no wrapping transaction (Citus DDL on distributed tables).
exports.config = { transaction: false };
