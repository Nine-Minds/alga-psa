/**
 * Defense-in-depth DB guardrails for the application role.
 *
 * A stuck transaction holding a tickets row lock used to stall every later
 * write to that row until pgbouncer's idle_transaction_timeout (300s) reaped
 * the session. The root cause (SLA backend re-entrant write deadlock) is
 * fixed in code; these role-level GUCs make any *future* stuck transaction
 * self-abort in seconds instead of minutes:
 *
 * - idle_in_transaction_session_timeout=60s: a session idle mid-transaction
 *   is aborted, releasing its locks. 60s (not lower) so a legitimate slow
 *   external call awaited between statements (SMTP/HTTP timeouts are
 *   routinely 30-60s) doesn't abort the transaction; waiters are already
 *   protected by lock_timeout regardless of how long the holder sits.
 * - lock_timeout=8s: a statement waiting on a lock fails fast instead of
 *   queueing behind a stuck holder.
 *
 * Role-level (not pool afterCreate) because pgbouncer runs in transaction
 * pooling mode: session-level SETs issued at connection creation do not
 * reliably follow the client across backend remapping, while role GUCs
 * resolve server-side at backend session start. Applied to the app role
 * only — the admin/migration role keeps unlimited timeouts so long DDL
 * stays legal.
 */

// DO blocks cannot take bound parameters; sanitize and inline the role name.
const APP_ROLE = (process.env.DB_USER_SERVER || 'app_user').replace(/[^a-zA-Z0-9_]/g, '');

exports.up = async function (knex) {
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
        EXECUTE format('ALTER ROLE %I SET idle_in_transaction_session_timeout = ''60s''', '${APP_ROLE}');
        EXECUTE format('ALTER ROLE %I SET lock_timeout = ''8s''', '${APP_ROLE}');
      ELSE
        RAISE NOTICE 'Role ${APP_ROLE} not found; skipping DB guardrail timeouts';
      END IF;
    END
    $$;
  `);
};

exports.down = async function (knex) {
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
        EXECUTE format('ALTER ROLE %I RESET idle_in_transaction_session_timeout', '${APP_ROLE}');
        EXECUTE format('ALTER ROLE %I RESET lock_timeout', '${APP_ROLE}');
      END IF;
    END
    $$;
  `);
};
