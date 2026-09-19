/**
 * Additive auth-failure tracking columns for the inbound auto-pause feature.
 *
 * Tracks consecutive, strictly classified unrecoverable auth failures at the
 * provider source-fetch boundary. Plain additive ALTERs on an already
 * tenant-distributed table: no uniqueness, no constraint builds, valid on both
 * plain Postgres and Citus.
 */

const COLUMNS = [
  { name: 'inbound_auth_failure_count', kind: 'integer' },
  { name: 'inbound_auth_failure_last_at', kind: 'timestamptz' },
  { name: 'inbound_auth_failure_code', kind: 'text' },
];

exports.up = async function up(knex) {
  const existing = await knex('information_schema.columns')
    .where('table_name', 'email_providers')
    .pluck('column_name');
  const present = new Set(existing);

  await knex.schema.alterTable('email_providers', (table) => {
    for (const column of COLUMNS) {
      if (present.has(column.name)) continue;
      if (column.kind === 'integer') {
        table.integer(column.name).notNullable().defaultTo(0);
      } else if (column.kind === 'timestamptz') {
        table.timestamp(column.name, { useTz: true }).nullable();
      } else {
        table.text(column.name).nullable();
      }
    }
  });

  // Widen the pause-reason allowlist to include the automatic auth-failure
  // pause. Dropping/re-adding a CHECK constraint is metadata-only on plain
  // Postgres and valid on Citus distributed tables (no rewrite, no locks
  // beyond a brief ACCESS EXCLUSIVE that ADD CONSTRAINT CHECK requires).
  await knex.raw(`
    ALTER TABLE email_providers
    DROP CONSTRAINT IF EXISTS email_providers_inbound_pause_reason_check
  `);
  await knex.raw(`
    ALTER TABLE email_providers
    ADD CONSTRAINT email_providers_inbound_pause_reason_check
    CHECK (
      (inbound_paused_at IS NULL AND inbound_pause_reason IS NULL)
      OR
      (inbound_paused_at IS NOT NULL AND inbound_pause_reason IN ('manual', 'tenant_cancelled', 'auth_failure'))
    )
  `);
};

exports.down = async function down(knex) {
  // Restore the pre-auth-failure world: clear any automatic auth-failure
  // pauses so the narrowed constraint can be re-added. Single-table update
  // on the distribution column's table — valid on plain Postgres and Citus.
  await knex.raw(`
    UPDATE email_providers
    SET inbound_paused_at = NULL, inbound_pause_reason = NULL
    WHERE inbound_pause_reason = 'auth_failure'
  `);

  await knex.raw(`
    ALTER TABLE email_providers
    DROP CONSTRAINT IF EXISTS email_providers_inbound_pause_reason_check
  `);
  await knex.raw(`
    ALTER TABLE email_providers
    ADD CONSTRAINT email_providers_inbound_pause_reason_check
    CHECK (
      (inbound_paused_at IS NULL AND inbound_pause_reason IS NULL)
      OR
      (inbound_paused_at IS NOT NULL AND inbound_pause_reason IN ('manual', 'tenant_cancelled'))
    )
  `);

  const existing = await knex('information_schema.columns')
    .where('table_name', 'email_providers')
    .pluck('column_name');
  const present = new Set(existing);

  await knex.schema.alterTable('email_providers', (table) => {
    for (const column of COLUMNS) {
      if (present.has(column.name)) {
        table.dropColumn(column.name);
      }
    }
  });
};
