/**
 * Give project-billing holds a durable lifecycle and audit metadata.
 *
 * A held entry is deliberately excluded from the ready queue until a user
 * releases it. The existing ready_at value is retained so the original
 * readiness timestamp remains auditable.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('project_billing_schedule_entries', (table) => {
    table.text('hold_reason').nullable();
    table.timestamp('held_at', { useTz: true }).nullable();
    table.uuid('held_by').nullable();
  });

  const versionRow = await knex.raw("SELECT current_setting('server_version_num')::int AS v");
  const { rows: citusRows } = await knex.raw(
    "SELECT 1 FROM pg_extension WHERE extname = 'citus' LIMIT 1"
  );
  const deleteClause = versionRow.rows[0].v >= 150000 && citusRows.length === 0
    ? ' ON DELETE SET NULL (held_by)'
    : '';
  await knex.raw(`
    ALTER TABLE project_billing_schedule_entries
    ADD CONSTRAINT project_billing_schedule_entries_held_by_fk
    FOREIGN KEY (tenant, held_by)
    REFERENCES users (tenant, user_id)${deleteClause}
  `);

  await knex.raw(`
    ALTER TABLE project_billing_schedule_entries
    DROP CONSTRAINT project_billing_schedule_entries_status_check
  `);
  await knex.raw(`
    ALTER TABLE project_billing_schedule_entries
    ADD CONSTRAINT project_billing_schedule_entries_status_check
    CHECK (status IN ('pending', 'ready', 'held', 'approved', 'invoiced', 'canceled'))
  `);

  if (citusRows.length === 0) {
    await knex.raw(`
      CREATE OR REPLACE FUNCTION guard_project_billing_schedule_status_transition()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
          RETURN NEW;
        END IF;

        IF (OLD.status = 'pending' AND NEW.status IN ('ready', 'canceled'))
          OR (OLD.status = 'ready' AND NEW.status IN ('pending', 'held', 'approved', 'canceled'))
          OR (OLD.status = 'held' AND NEW.status IN ('ready', 'canceled'))
          OR (OLD.status = 'approved' AND NEW.status IN ('ready', 'invoiced', 'canceled'))
          OR (OLD.status = 'invoiced' AND NEW.status = 'approved')
        THEN
          RETURN NEW;
        END IF;

        RAISE EXCEPTION 'Illegal project billing schedule status transition: % -> %', OLD.status, NEW.status
          USING ERRCODE = 'P0001';
      END;
      $$
    `);
  }
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex('project_billing_schedule_entries')
    .where({ status: 'held' })
    .update({ status: 'ready' });

  await knex.raw(`
    ALTER TABLE project_billing_schedule_entries
    DROP CONSTRAINT IF EXISTS project_billing_schedule_entries_held_by_fk
  `);
  await knex.raw(`
    ALTER TABLE project_billing_schedule_entries
    DROP CONSTRAINT project_billing_schedule_entries_status_check
  `);
  await knex.raw(`
    ALTER TABLE project_billing_schedule_entries
    ADD CONSTRAINT project_billing_schedule_entries_status_check
    CHECK (status IN ('pending', 'ready', 'approved', 'invoiced', 'canceled'))
  `);
  await knex.raw(`
    CREATE OR REPLACE FUNCTION guard_project_billing_schedule_status_transition()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
      END IF;

      IF (OLD.status = 'pending' AND NEW.status IN ('ready', 'canceled'))
        OR (OLD.status = 'ready' AND NEW.status IN ('pending', 'approved', 'canceled'))
        OR (OLD.status = 'approved' AND NEW.status IN ('invoiced', 'canceled'))
        OR (OLD.status = 'invoiced' AND NEW.status = 'approved')
      THEN
        RETURN NEW;
      END IF;

      RAISE EXCEPTION 'Illegal project billing schedule status transition: % -> %', OLD.status, NEW.status
        USING ERRCODE = 'P0001';
    END;
    $$
  `);

  await knex.schema.alterTable('project_billing_schedule_entries', (table) => {
    table.dropColumn('held_by');
    table.dropColumn('held_at');
    table.dropColumn('hold_reason');
  });
};
