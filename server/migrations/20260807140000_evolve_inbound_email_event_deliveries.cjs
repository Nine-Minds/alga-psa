/**
 * Evolve `inbound_email_event_deliveries` into a crash-safe state machine.
 *
 * The original ledger was a one-shot terminal claim: a worker inserted a row
 * BEFORE producing its notification effect and the gate skipped redelivery as
 * soon as a row existed. A crash between the insert and the effect therefore
 * permanently lost the effect.
 *
 * This follow-on migration turns the ledger row into a recoverable reservation:
 *
 *   status          delivering | delivered | retryable_failed | terminal_failed
 *   lease_owner/token/version  fencing lease on `delivering` (reclaimable when
 *                              `lease_expires_at` passes)
 *   attempt_count   failure retries (honors getDurableMaxAttempts()); crash
 *                   reclaims do not count, mirroring the other durable tables
 *   next_attempt_at backoff for retryable failures
 *   completed_at    set on terminal states (delivered / terminal_failed)
 *
 * The primary key stays `(tenant, outbox_id, consumer)` — every key is
 * tenant-first (Citus). No new table is created, so `ensureTenantDistribution`
 * is re-asserted as a no-op guard and `tenantTableMetadata.ts` already
 * registers the table as tenant-scoped.
 *
 * Existing rows predate the state machine and represent the OLD claim-before-
 * effect inserts. This branch is unmerged, so those rows are test/dev only;
 * they are backfilled to `delivered` so past events are never re-sent once the
 * fix lands.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

  // Columns. Per-column ADD COLUMN IF NOT EXISTS so a mid-migration crash (this
  // migration runs with transaction: false) that already added some columns does
  // not make the re-run fail on duplicate columns — the file is genuinely
  // idempotent, matching the DO-block guarding used for constraints below.
  const columnAdds = [
    ["status", "text NOT NULL DEFAULT 'delivering'"],
    ['attempt_count', 'integer NOT NULL DEFAULT 0'],
    ['lease_owner', 'text'],
    ['lease_token', 'uuid'],
    ['lease_version', 'bigint NOT NULL DEFAULT 0'],
    ['lease_expires_at', 'timestamp with time zone'],
    ['next_attempt_at', 'timestamp with time zone'],
    ['last_error', 'text'],
    ['updated_at', "timestamp with time zone NOT NULL DEFAULT now()"],
    ['completed_at', 'timestamp with time zone'],
  ];
  for (const [name, definition] of columnAdds) {
    await knex.raw(
      `ALTER TABLE "inbound_email_event_deliveries" ADD COLUMN IF NOT EXISTS "${name}" ${definition}`
    );
  }

  // Backfill pre-existing rows BEFORE adding the delivering_lease_check. Rows
  // written by the old one-shot gate carry the new status default ('delivering')
  // with NULL lease_owner/lease_token/lease_expires_at, so ADD CONSTRAINT would
  // fail validating them if it ran first. Mark them completed up front so every
  // pre-existing row satisfies the lease checks by the time the constraints are
  // added. The predicate (`lease_token IS NULL`) leaves genuine new-code
  // reservations (delivering with a real lease) untouched.
  await knex.raw(`
    UPDATE "inbound_email_event_deliveries"
    SET status = 'delivered', completed_at = COALESCE("updated_at", "created_at"), "updated_at" = now()
    WHERE status = 'delivering' AND lease_token IS NULL;
  `);

  // Constraints (DO-block guarded so a partially-applied migration is safe).
  const constraintSql = `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inbound_email_event_deliveries_status_check') THEN
        ALTER TABLE "inbound_email_event_deliveries" ADD CONSTRAINT "inbound_email_event_deliveries_status_check"
          CHECK (status IN ('delivering','delivered','retryable_failed','terminal_failed'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inbound_email_event_deliveries_delivering_lease_check') THEN
        ALTER TABLE "inbound_email_event_deliveries" ADD CONSTRAINT "inbound_email_event_deliveries_delivering_lease_check"
          CHECK (status <> 'delivering' OR (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inbound_email_event_deliveries_retryable_next_attempt_check') THEN
        ALTER TABLE "inbound_email_event_deliveries" ADD CONSTRAINT "inbound_email_event_deliveries_retryable_next_attempt_check"
          CHECK (status <> 'retryable_failed' OR next_attempt_at IS NOT NULL);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inbound_email_event_deliveries_terminal_lease_check') THEN
        ALTER TABLE "inbound_email_event_deliveries" ADD CONSTRAINT "inbound_email_event_deliveries_terminal_lease_check"
          CHECK (status NOT IN ('delivered','terminal_failed') OR (lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL AND completed_at IS NOT NULL));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inbound_email_event_deliveries_attempt_count_check') THEN
        ALTER TABLE "inbound_email_event_deliveries" ADD CONSTRAINT "inbound_email_event_deliveries_attempt_count_check"
          CHECK (attempt_count >= 0);
      END IF;
    END
    $$;
  `;
  await knex.raw(constraintSql);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS "inbound_email_event_deliveries_recovery_idx"
      ON "inbound_email_event_deliveries" ("tenant", "status", "next_attempt_at", "lease_expires_at");
  `);

  await ensureTenantDistribution(knex, 'inbound_email_event_deliveries');
};

/**
 * Local/test-only rollback: drop the added columns and constraints. Production
 * rollback of an evolved distributed table is out of scope for a local tool.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.raw(`
    DO $$
    BEGIN
      EXECUTE 'ALTER TABLE "inbound_email_event_deliveries" DROP CONSTRAINT IF EXISTS "inbound_email_event_deliveries_status_check"';
      EXECUTE 'ALTER TABLE "inbound_email_event_deliveries" DROP CONSTRAINT IF EXISTS "inbound_email_event_deliveries_delivering_lease_check"';
      EXECUTE 'ALTER TABLE "inbound_email_event_deliveries" DROP CONSTRAINT IF EXISTS "inbound_email_event_deliveries_retryable_next_attempt_check"';
      EXECUTE 'ALTER TABLE "inbound_email_event_deliveries" DROP CONSTRAINT IF EXISTS "inbound_email_event_deliveries_terminal_lease_check"';
      EXECUTE 'ALTER TABLE "inbound_email_event_deliveries" DROP CONSTRAINT IF EXISTS "inbound_email_event_deliveries_attempt_count_check"';
    END
    $$;
  `);
  await knex.schema.alterTable('inbound_email_event_deliveries', (table) => {
    table.dropColumn('status');
    table.dropColumn('attempt_count');
    table.dropColumn('lease_owner');
    table.dropColumn('lease_token');
    table.dropColumn('lease_version');
    table.dropColumn('lease_expires_at');
    table.dropColumn('next_attempt_at');
    table.dropColumn('last_error');
    table.dropColumn('updated_at');
    table.dropColumn('completed_at');
  });
  await knex.raw('DROP INDEX IF EXISTS "inbound_email_event_deliveries_recovery_idx"');
};

// Disable transaction for Citus DB compatibility (ALTERs on a distributed
// table are applied node-side; a transaction wrapper is unnecessary).
exports.config = { transaction: false };
