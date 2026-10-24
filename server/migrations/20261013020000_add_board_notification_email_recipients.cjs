/**
 * Board notification rules: plain email-address recipients (2026-10-13, alga-2026-0002379)
 *
 * Adds recipient_type = 'email' to board_notification_rule_recipients with a nullable,
 * normalized `email` column. Every ALTER carries one subcommand (Citus) and every step is
 * re-runnable. No unique-index dedupe or local-heap truncation is needed: the column is new
 * and empty, and the partial index excludes rows where email IS NULL.
 *
 * See docs/plans/2026-10-13-board-notification-email-recipient-plan.md.
 */
const TABLE = 'board_notification_rule_recipients';
const TYPE_CHECK = 'board_notification_rule_recipients_type_check';
const SHAPE_CHECK = 'board_notification_rule_recipients_shape_check';
const EMAIL_CHECK = 'board_notification_rule_recipients_email_normalized_check';
const EMAIL_INDEX = 'board_notification_rule_recipients_email_uq';

async function constraintExists(knex, name) {
  const result = await knex.raw(
    `SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass`,
    [name, `public.${TABLE}`]
  );
  return result.rows.length > 0;
}

async function dropConstraintIfExists(knex, name) {
  if (await constraintExists(knex, name)) {
    await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT ${name}`);
  }
}

async function replaceConstraint(knex, name, definition) {
  await dropConstraintIfExists(knex, name);
  await knex.raw(`ALTER TABLE ${TABLE} ADD CONSTRAINT ${name} CHECK (${definition})`);
}

exports.up = async function (knex) {
  if (!(await knex.schema.hasColumn(TABLE, 'email'))) {
    await knex.raw(`ALTER TABLE ${TABLE} ADD COLUMN email text NULL`);
  }

  await replaceConstraint(knex, TYPE_CHECK, `recipient_type IN ('user', 'team', 'email')`);
  await replaceConstraint(
    knex,
    SHAPE_CHECK,
    `
      (recipient_type = 'user' AND user_id IS NOT NULL AND team_id IS NULL AND email IS NULL)
      OR (recipient_type = 'team' AND team_id IS NOT NULL AND user_id IS NULL AND email IS NULL)
      OR (recipient_type = 'email' AND email IS NOT NULL AND user_id IS NULL AND team_id IS NULL)
    `
  );
  // Backstop only: the server action performs the real validation.
  await replaceConstraint(
    knex,
    EMAIL_CHECK,
    `email IS NULL OR (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254 AND position('@' in email) > 1)`
  );

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${EMAIL_INDEX}
    ON ${TABLE} (tenant, rule_id, email) WHERE email IS NOT NULL
  `);
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn(TABLE, 'email')) {
    await knex.raw(`DELETE FROM ${TABLE} WHERE recipient_type = 'email'`);
  }
  await knex.raw(`DROP INDEX IF EXISTS ${EMAIL_INDEX}`);
  await dropConstraintIfExists(knex, EMAIL_CHECK);

  await replaceConstraint(
    knex,
    SHAPE_CHECK,
    `
      (recipient_type = 'user' AND user_id IS NOT NULL AND team_id IS NULL)
      OR (recipient_type = 'team' AND team_id IS NOT NULL AND user_id IS NULL)
    `
  );
  await replaceConstraint(knex, TYPE_CHECK, `recipient_type IN ('user', 'team')`);

  if (await knex.schema.hasColumn(TABLE, 'email')) {
    await knex.raw(`ALTER TABLE ${TABLE} DROP COLUMN email`);
  }
};

// Citus requires constraint/DDL manipulation on distributed tables outside a transaction block.
exports.config = { transaction: false };
