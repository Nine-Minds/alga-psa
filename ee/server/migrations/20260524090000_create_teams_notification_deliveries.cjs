const DELIVERY_ERROR_CODES = [
  'graph_throttled',
  'graph_unauthorized',
  'graph_not_found',
  'graph_server_error',
  'user_not_mapped',
  'addon_inactive',
  'integration_inactive',
  'package_misconfigured',
  'transient',
  'unknown',
];

function monthStart(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(date, months) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function partitionName(start) {
  const year = start.getUTCFullYear();
  const month = String(start.getUTCMonth() + 1).padStart(2, '0');
  return `teams_notification_deliveries_${year}_${month}`;
}

function sqlDate(date) {
  return date.toISOString().slice(0, 10);
}

async function citusFunctionAvailable(knex) {
  const result = await knex.raw(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_proc
      WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);

  return Boolean(result.rows?.[0]?.exists);
}

async function isDistributed(knex, tableName) {
  const result = await knex.raw(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_dist_partition
      WHERE logicalrelid = ?::regclass
    ) AS distributed;
  `, [tableName]);

  return Boolean(result.rows?.[0]?.distributed);
}

async function distributeIfNeeded(knex, tableName) {
  if (!(await citusFunctionAvailable(knex))) {
    console.warn(`[teams_notification_deliveries] Skipping create_distributed_table for ${tableName} (function unavailable)`);
    return;
  }

  if (!(await isDistributed(knex, tableName))) {
    await knex.raw(
      `SELECT create_distributed_table(?, 'tenant', colocate_with => 'teams_integrations')`,
      [tableName]
    );
  }
}

exports.up = async function up(knex) {
  await knex.raw(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS teams_notification_delivery_idempotency (
      tenant uuid NOT NULL,
      idempotency_key text NOT NULL,
      delivery_id uuid NOT NULL DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT teams_notification_delivery_idempotency_pk PRIMARY KEY (tenant, idempotency_key)
    );
  `);

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS teams_notification_deliveries (
      tenant uuid NOT NULL,
      delivery_id uuid NOT NULL DEFAULT gen_random_uuid(),
      internal_notification_id uuid,
      category text,
      destination_type text NOT NULL,
      destination_id text NOT NULL,
      attempt_number integer NOT NULL DEFAULT 1,
      idempotency_key text NOT NULL,
      provider_message_id text,
      status text NOT NULL,
      error_code text,
      error_message text,
      retryable boolean,
      provider_request_id text,
      sent_at timestamptz,
      delivered_at timestamptz,
      responded_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT teams_notification_deliveries_pk PRIMARY KEY (tenant, delivery_id, created_at),
      CONSTRAINT teams_notification_deliveries_status_check
        CHECK (status IN ('skipped', 'sent', 'delivered', 'failed')),
      CONSTRAINT teams_notification_deliveries_error_code_check
        CHECK (error_code IS NULL OR error_code IN (${DELIVERY_ERROR_CODES.map((code) => `'${code}'`).join(', ')}))
    ) PARTITION BY RANGE (created_at);
  `);

  const current = monthStart(new Date());
  for (let offset = 0; offset < 3; offset += 1) {
    const start = addMonths(current, offset);
    const end = addMonths(current, offset + 1);
    await knex.raw(`
      CREATE TABLE IF NOT EXISTS ${partitionName(start)}
      PARTITION OF teams_notification_deliveries
      FOR VALUES FROM ('${sqlDate(start)}') TO ('${sqlDate(end)}');
    `);
  }

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS teams_notification_deliveries_internal_notification_idx
    ON teams_notification_deliveries (tenant, internal_notification_id);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS teams_notification_deliveries_status_created_idx
    ON teams_notification_deliveries (tenant, status, created_at DESC);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS teams_notification_deliveries_idempotency_lookup_idx
    ON teams_notification_deliveries (tenant, idempotency_key);
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION cleanup_teams_notification_deliveries(retention_interval interval DEFAULT interval '90 days')
    RETURNS integer
    LANGUAGE plpgsql
    AS $cleanup$
    DECLARE
      partition_record record;
      dropped_count integer := 0;
      cutoff timestamptz := now() - retention_interval;
      upper_bound timestamptz;
    BEGIN
      FOR partition_record IN
        SELECT
          child.relname AS partition_name,
          pg_get_expr(child.relpartbound, child.oid) AS partition_bound
        FROM pg_inherits
        JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
        JOIN pg_class child ON pg_inherits.inhrelid = child.oid
        WHERE parent.relname = 'teams_notification_deliveries'
      LOOP
        SELECT (regexp_match(partition_record.partition_bound, $$TO \('([^']+)'\)$$))[1]::timestamptz
        INTO upper_bound;

        IF upper_bound IS NOT NULL AND upper_bound < cutoff THEN
          EXECUTE format('DROP TABLE IF EXISTS %I', partition_record.partition_name);
          dropped_count := dropped_count + 1;
        END IF;
      END LOOP;

      RETURN dropped_count;
    END;
    $cleanup$;
  `);

  await distributeIfNeeded(knex, 'teams_notification_delivery_idempotency');
  await distributeIfNeeded(knex, 'teams_notification_deliveries');

  if (await citusFunctionAvailable(knex)) {
    const smoke = await knex.raw(`
      SELECT count(*)::integer AS distributed_count
      FROM pg_dist_partition
      WHERE logicalrelid = 'teams_notification_deliveries'::regclass;
    `);
    console.log(
      `[teams_notification_deliveries] Citus distribution smoke count: ${smoke.rows?.[0]?.distributed_count ?? 0}`
    );
  }
};

exports.down = async function down(knex) {
  await knex.raw(`DROP FUNCTION IF EXISTS cleanup_teams_notification_deliveries(interval);`);
  await knex.raw(`DROP TABLE IF EXISTS teams_notification_deliveries CASCADE;`);
  await knex.raw(`DROP TABLE IF EXISTS teams_notification_delivery_idempotency CASCADE;`);
};

exports.config = { transaction: false };
