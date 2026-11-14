/**
 * Co-managed seat and workspace shapes on one seat pool, slice S18.
 *
 * `users.seat_reader`: this user is bound by a seat assignment that is not revoked. It is the
 * signal a read path that already holds the user row uses to know, with no statement of its own,
 * that an internal user is MSP staff: `false` is staff, and anything else sends the read to the
 * seat tables (`shared/lib/commentAudience.ts`). The seat tables stay the source of truth for who a
 * seat technician is and what they may read; the marker only says when they need not be asked.
 *
 * The marker cannot say `false` for a bound user. That is a foreign key, not a convention:
 *
 * - `co_managed_seat_assignments.binds_seat_reader` is generated: `true` while the assignment
 *   names a user and is not revoked, otherwise NULL.
 * - `(tenant, user_id, binds_seat_reader)` references `users (tenant, user_id, seat_reader)`.
 *   A NULL column takes the row out of the constraint (MATCH SIMPLE), so only a binding
 *   assignment is checked, and it requires `seat_reader = true` on its user. Clearing the marker
 *   while such an assignment exists is refused the same way.
 *
 * A stale `true` (the last assignment revoked, the marker not yet cleared) is safe: the read asks
 * the seat tables and finds staff.
 *
 * Who sets it: on plain Postgres a trigger keeps the marker in step with the assignments, so a
 * row written directly needs nothing more. Citus rejects triggers on a distributed table, so
 * there the command that binds a user sets `users.seat_reader = true` first (the foreign key
 * refuses the assignment otherwise) and the command that revokes the last one clears it.
 *
 * Existing rows are backfilled from the assignments. Idempotent; safe to re-run.
 */
const { ensureCompositeFk, supportsTriggers } = require('./utils/citusDistribution.cjs');

const ASSIGNMENTS = 'co_managed_seat_assignments';
const FK = 'co_managed_seat_assignments_seat_reader_foreign';
const TARGET_INDEX = 'users_tenant_user_id_seat_reader_unique';
const BOUND = `state <> 'revoked' AND user_id IS NOT NULL`;

/** @param { import("knex").Knex } knex */
exports.up = async function up(knex) {
  // Function DDL first: Citus propagates CREATE FUNCTION over one connection per worker.
  await knex.raw(`CREATE OR REPLACE FUNCTION co_managed_seat_assignment_marks_reader() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.user_id IS NOT NULL AND NEW.state <> 'revoked' THEN
        UPDATE users SET seat_reader = true
          WHERE tenant = NEW.tenant AND user_id = NEW.user_id AND seat_reader = false;
      END IF;
      RETURN NEW;
    END $$`);
  await knex.raw(`CREATE OR REPLACE FUNCTION co_managed_seat_assignment_unmarks_reader() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.user_id IS NOT NULL AND OLD.state <> 'revoked' THEN
        UPDATE users SET seat_reader = false
          WHERE tenant = OLD.tenant AND user_id = OLD.user_id AND seat_reader = true
            AND NOT EXISTS (SELECT 1 FROM ${ASSIGNMENTS} sa
              WHERE sa.tenant = OLD.tenant AND sa.user_id = OLD.user_id AND sa.state <> 'revoked');
      END IF;
      RETURN NULL;
    END $$`);

  if (!(await knex.schema.hasColumn('users', 'seat_reader'))) {
    // A constant default: no table rewrite.
    await knex.raw('ALTER TABLE users ADD COLUMN seat_reader boolean NOT NULL DEFAULT false');
  }
  if (!(await knex.schema.hasColumn(ASSIGNMENTS, 'binds_seat_reader'))) {
    await knex.raw(`ALTER TABLE ${ASSIGNMENTS} ADD COLUMN binds_seat_reader boolean
      GENERATED ALWAYS AS (CASE WHEN ${BOUND} THEN true END) STORED`);
  }
  // The foreign key's target. Built without blocking writes to `users`; an attempt that was
  // interrupted leaves an invalid index behind, which is dropped and rebuilt.
  const index = await knex.raw(
    `SELECT i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = ? AND i.indrelid = 'users'::regclass`, [TARGET_INDEX]);
  if (index.rows[0] && !index.rows[0].indisvalid) await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS ${TARGET_INDEX}`);
  await knex.raw(`CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ${TARGET_INDEX} ON users (tenant, user_id, seat_reader)`);

  // migration-lint: allow 5 - one-shot backfill of the new constant-default column; only users bound by a non-revoked seat assignment are visited, and that set is small because seat technicians are the paid exception, not the tenant population
  await knex.raw(`UPDATE users SET seat_reader = true
    WHERE seat_reader = false AND EXISTS (SELECT 1 FROM ${ASSIGNMENTS} sa
      WHERE sa.tenant = users.tenant AND sa.user_id = users.user_id AND sa.state <> 'revoked')`);

  if (await supportsTriggers(knex, ASSIGNMENTS)) {
    await knex.raw(`DROP TRIGGER IF EXISTS co_managed_seat_assignment_marks_reader ON ${ASSIGNMENTS}`);
    // migration-lint: allow 4 - created only when the table supports triggers (plain Postgres); Citus skips triggers by design and the foreign key plus the binding command carry the invariant there
    await knex.raw(`CREATE TRIGGER co_managed_seat_assignment_marks_reader
      BEFORE INSERT OR UPDATE OF user_id, state ON ${ASSIGNMENTS}
      FOR EACH ROW EXECUTE FUNCTION co_managed_seat_assignment_marks_reader()`);
    await knex.raw(`DROP TRIGGER IF EXISTS co_managed_seat_assignment_unmarks_reader ON ${ASSIGNMENTS}`);
    // migration-lint: allow 4 - created only when the table supports triggers (plain Postgres); Citus skips triggers by design and the foreign key plus the binding command carry the invariant there
    await knex.raw(`CREATE TRIGGER co_managed_seat_assignment_unmarks_reader
      AFTER DELETE OR UPDATE OF user_id, state ON ${ASSIGNMENTS}
      FOR EACH ROW EXECUTE FUNCTION co_managed_seat_assignment_unmarks_reader()`);
  }

  // Last: every binding assignment now has a marked user.
  const enforced = await ensureCompositeFk(knex, {
    table: ASSIGNMENTS,
    constraint: FK,
    columns: ['tenant', 'user_id', 'binds_seat_reader'],
    referencedTable: 'users',
    referencedColumns: ['tenant', 'user_id', 'seat_reader'],
  });
  // Without the constraint a bound user could carry `seat_reader = false` and be read as staff.
  if (!enforced) throw new Error(`${FK} cannot be enforced: ${ASSIGNMENTS} and users are not colocated`);
};

/** @param { import("knex").Knex } knex */
exports.down = async function down(knex) {
  if (await knex.schema.hasTable(ASSIGNMENTS)) {
    await knex.raw(`ALTER TABLE ${ASSIGNMENTS} DROP CONSTRAINT IF EXISTS ${FK}`);
    if (await supportsTriggers(knex, ASSIGNMENTS)) {
      await knex.raw(`DROP TRIGGER IF EXISTS co_managed_seat_assignment_marks_reader ON ${ASSIGNMENTS}`);
      await knex.raw(`DROP TRIGGER IF EXISTS co_managed_seat_assignment_unmarks_reader ON ${ASSIGNMENTS}`);
    }
    await knex.raw(`ALTER TABLE ${ASSIGNMENTS} DROP COLUMN IF EXISTS binds_seat_reader`);
  }
  await knex.raw('DROP FUNCTION IF EXISTS co_managed_seat_assignment_marks_reader()');
  await knex.raw('DROP FUNCTION IF EXISTS co_managed_seat_assignment_unmarks_reader()');
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS ${TARGET_INDEX}`);
  await knex.raw('ALTER TABLE users DROP COLUMN IF EXISTS seat_reader');
};

// CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
exports.config = { transaction: false };
