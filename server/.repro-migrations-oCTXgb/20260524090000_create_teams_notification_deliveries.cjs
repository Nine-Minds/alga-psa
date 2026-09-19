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
      CONSTRAINT teams_notification_deliveries_pk PRIMARY KEY (tenant, delivery_id),
      CONSTRAINT teams_notification_deliveries_idempotency_uk UNIQUE (tenant, idempotency_key),
      CONSTRAINT teams_notification_deliveries_status_check
        CHECK (status IN ('skipped', 'sent', 'delivered', 'failed')),
      CONSTRAINT teams_notification_deliveries_error_code_check
        CHECK (error_code IS NULL OR error_code IN (${DELIVERY_ERROR_CODES.map((code) => `'${code}'`).join(', ')}))
    );
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS teams_notification_deliveries_internal_notification_idx
    ON teams_notification_deliveries (tenant, internal_notification_id);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS teams_notification_deliveries_status_created_idx
    ON teams_notification_deliveries (tenant, status, created_at DESC);
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION cleanup_teams_notification_deliveries(retention_interval interval DEFAULT interval '90 days')
    RETURNS integer
    LANGUAGE plpgsql
    AS $cleanup$
    DECLARE
      deleted_count integer;
    BEGIN
      DELETE FROM teams_notification_deliveries
      WHERE created_at < now() - retention_interval;
      GET DIAGNOSTICS deleted_count = ROW_COUNT;
      RETURN deleted_count;
    END;
    $cleanup$;
  `);

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
