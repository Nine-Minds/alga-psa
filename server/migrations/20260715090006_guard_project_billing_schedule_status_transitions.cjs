/**
 * Enforce the project-billing schedule lifecycle at the database boundary.
 *
 * Application actions already use optimistic source-status predicates. This
 * trigger protects raw model/SQL updates from skipping lifecycle states while
 * retaining the explicit rollback and cancellation transitions used by invoice
 * unfinalization, project closure, holds, and phase reopen.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  const { rows: citusRows } = await knex.raw(
    "SELECT 1 FROM pg_extension WHERE extname = 'citus' LIMIT 1"
  );
  if (citusRows.length > 0) {
    // Ordinary coordinator triggers are not propagated to distributed shard
    // placements. Lifecycle enforcement is provided by the atomic model
    // transition API on Citus and, after the hardening migration, everywhere.
    return;
  }

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

  await knex.raw(`
    CREATE TRIGGER project_billing_schedule_status_transition_guard
    BEFORE UPDATE OF status ON project_billing_schedule_entries
    FOR EACH ROW
    EXECUTE FUNCTION guard_project_billing_schedule_status_transition()
  `);
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex.raw(`
    DROP TRIGGER IF EXISTS project_billing_schedule_status_transition_guard
    ON project_billing_schedule_entries
  `);
  await knex.raw('DROP FUNCTION IF EXISTS guard_project_billing_schedule_status_transition()');
};
