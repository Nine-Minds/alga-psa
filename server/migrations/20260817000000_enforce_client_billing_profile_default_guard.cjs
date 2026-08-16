'use strict';

/**
 * Billing profiles — F002 default-profile integrity guard (slice S1 follow-up).
 *
 * The partial unique index from 20260816000000
 * (`client_billing_profiles_default_per_client_unique`, on (tenant, client_id)
 * WHERE is_default = true) enforces *at most* one default per client. This
 * migration closes the *zero-default* gap: a client with profiles but no
 * is_default row breaks the resolution chain's step 5 ("client default
 * profile") and the D6 invisibility contract. This migration makes that state
 * unreachable at the database layer for any client that has profiles.
 *
 * Mechanism — a deferred constraint trigger (`AFTER INSERT OR UPDATE OR
 * DELETE ... DEFERRABLE INITIALLY DEFERRED`):
 *
 *   - Deferred to COMMIT means an *atomic* default switch still works: setting
 *     the new default and unsetting the old one in the same statement (or the
 *     same transaction, e.g. UPDATE A SET is_default=false; UPDATE B SET
 *     is_default=true) leaves a transient zero-default state inside the
 *     transaction, which the trigger only rejects if it survives to COMMIT.
 *   - It rejects any committed end-state where a client has >=1 profile and 0
 *     is_default rows: unsetting the sole default, deleting the sole default
 *     while a sibling profile remains, or inserting a client's first profile
 *     as non-default.
 *   - The partial unique index still enforces at-most-one; together the two
 *     give exactly-one-default per client with profiles.
 *
 * Citus — the table is tenant-distributed, and Citus cannot create triggers on
 * distributed tables (documented limitation). The official workaround is used:
 * the trigger is created on each shard placement directly on the workers via
 * `run_command_on_shards`. The trigger function is a single coordinator-side
 * CREATE OR REPLACE FUNCTION (Citus auto-propagates functions to workers) that
 * resolves the shard table dynamically from TG_TABLE_SCHEMA/TG_TABLE_NAME, so
 * one function definition serves every shard and the plain-PostgreSQL table.
 *
 * DISCLOSED CITUS LIMITATION (extends the S1 migration's note):
 *   1. Triggers applied via run_command_on_shards do not automatically follow
 *      future shard rebalancing; they must be re-applied after rebalancing
 *      (Citus-documented behavior). A re-apply is the same
 *      `CREATE CONSTRAINT TRIGGER ... ON <shard>` DDL this migration runs.
 *   2. The guard is per-shard. It is sound because the table is distributed on
 *      `tenant` and every profile row of one client shares the client's tenant,
 *      hence lives on the same shard — the shard-local check sees the client's
 *      whole profile set.
 */

const TABLE = 'client_billing_profiles';
const FUNCTION_NAME = 'enforce_client_billing_profiles_has_default';
const TRIGGER_NAME = 'client_billing_profiles_has_default_guard';

async function isCitusDistributedTable(knex) {
  try {
    const result = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass
      ) AS is_distributed
    `, [TABLE]);
    return Boolean(result.rows?.[0]?.is_distributed);
  } catch {
    return false;
  }
}

async function triggerExistsOn(knex, tableExpr) {
  const result = await knex.raw(
    `SELECT EXISTS (
       SELECT 1 FROM pg_trigger WHERE tgname = ? AND tgrelid = ?::regclass
     ) AS present`,
    [TRIGGER_NAME, tableExpr]
  );
  return Boolean(result.rows?.[0]?.present);
}

async function functionExists(knex) {
  const result = await knex.raw(
    `SELECT EXISTS (
       SELECT 1 FROM pg_proc WHERE proname = ?
     ) AS present`,
    [FUNCTION_NAME]
  );
  return Boolean(result.rows?.[0]?.present);
}

// One function for every deployment shape. It reads the *current* trigger
// table's name (the shard table on workers, the plain table on the
// coordinator/CE), so a single definition serves both.
function functionSql() {
  return `
    CREATE OR REPLACE FUNCTION ${FUNCTION_NAME}() RETURNS trigger
    LANGUAGE plpgsql AS $fn$
    DECLARE
      v_tenant uuid;
      v_client uuid;
      v_total bigint;
      v_defaults bigint;
    BEGIN
      IF TG_OP = 'DELETE' THEN
        v_tenant := OLD.tenant;
        v_client := OLD.client_id;
      ELSE
        v_tenant := NEW.tenant;
        v_client := NEW.client_id;
      END IF;

      EXECUTE format(
        'SELECT count(*), count(*) FILTER (WHERE is_default) FROM %I.%I WHERE tenant = $1 AND client_id = $2',
        TG_TABLE_SCHEMA, TG_TABLE_NAME
      ) INTO v_total, v_defaults USING v_tenant, v_client;

      IF v_total > 0 AND v_defaults = 0 THEN
        RAISE EXCEPTION 'client % has % billing profile(s) but no default profile', v_client, v_total;
      END IF;
      RETURN NULL;
    END;
    $fn$;
  `;
}

function triggerSql(tableExpr) {
  return `
    CREATE CONSTRAINT TRIGGER ${TRIGGER_NAME}
    AFTER INSERT OR UPDATE OR DELETE ON ${tableExpr}
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION ${FUNCTION_NAME}()
  `;
}

exports.up = async function up(knex) {
  // Function first: plain Postgres creates it locally; Citus auto-propagates it
  // to the workers where the shard triggers run.
  if (!(await functionExists(knex))) {
    await knex.raw(functionSql());
  }

  const distributed = await isCitusDistributedTable(knex);
  if (distributed) {
    // Citus cannot create triggers on distributed tables; create the guard on
    // every shard placement via the documented run_command_on_shards
    // workaround. run_command_on_shards calls format(command, shardname), so
    // the command must contain exactly one %s placeholder — used here to bind
    // the shard name into the idempotent DO block.
    await knex.raw(`
      SELECT * FROM run_command_on_shards(
        ${JSON.stringify(TABLE)},
        $guard$
          DO $dyn$
          DECLARE
            shard_tbl text := '%s';
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_trigger
              WHERE tgname = ${JSON.stringify(TRIGGER_NAME)}
                AND tgrelid = shard_tbl::regclass
            ) THEN
              EXECUTE 'CREATE CONSTRAINT TRIGGER ${TRIGGER_NAME} AFTER INSERT OR UPDATE OR DELETE ON ' || quote_ident(shard_tbl) || ' DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${FUNCTION_NAME}()';
            END IF;
          END;
          $dyn$;
        $guard$
      )
    `);
    return;
  }

  if (!(await triggerExistsOn(knex, TABLE))) {
    await knex.raw(triggerSql(TABLE));
  }
};

exports.down = async function down(knex) {
  const distributed = await isCitusDistributedTable(knex);
  if (distributed) {
    await knex.raw(`
      SELECT * FROM run_command_on_shards(
        ${JSON.stringify(TABLE)},
        $guard$
          DROP TRIGGER IF EXISTS ${TRIGGER_NAME} ON %s
        $guard$
      )
    `);
  } else {
    await knex.raw(`DROP TRIGGER IF EXISTS ${TRIGGER_NAME} ON ${TABLE}`);
  }

  await knex.raw(`DROP FUNCTION IF EXISTS ${FUNCTION_NAME}()`);
};

// run_command_on_shards cannot run inside a transaction on Citus.
exports.config = { transaction: false };
