const AUDIT_ACTION_IDS = [
  'assign_ticket',
  'add_note',
  'reply_to_contact',
  'log_time',
  'approval_response',
  'create_ticket_from_message',
  'update_from_message',
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

exports.up = async function up(knex) {
  await knex.raw(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS teams_audit_events (
      tenant uuid NOT NULL,
      event_id uuid NOT NULL DEFAULT gen_random_uuid(),
      actor_user_id uuid,
      microsoft_user_id text,
      surface text NOT NULL,
      action_id text NOT NULL,
      target_type text,
      target_id text,
      idempotency_key text,
      payload_hash text,
      result_status text NOT NULL,
      error_code text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT teams_audit_events_pk PRIMARY KEY (tenant, event_id),
      CONSTRAINT teams_audit_events_surface_check
        CHECK (surface IN ('bot', 'message_extension', 'quick_action', 'tab')),
      CONSTRAINT teams_audit_events_result_status_check
        CHECK (result_status IN ('success', 'failure')),
      CONSTRAINT teams_audit_events_action_id_check
        CHECK (action_id IN (${AUDIT_ACTION_IDS.map((actionId) => `'${actionId}'`).join(', ')}))
    );
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS teams_audit_events_actor_created_idx
    ON teams_audit_events (tenant, actor_user_id, created_at DESC);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS teams_audit_events_target_idx
    ON teams_audit_events (tenant, target_type, target_id);
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION cleanup_teams_audit_events(retention_interval interval DEFAULT interval '365 days')
    RETURNS integer
    LANGUAGE plpgsql
    AS $$
    DECLARE
      deleted_count integer;
    BEGIN
      DELETE FROM teams_audit_events
      WHERE created_at < now() - retention_interval;

      GET DIAGNOSTICS deleted_count = ROW_COUNT;
      RETURN deleted_count;
    END;
    $$;
  `);

  if (await citusFunctionAvailable(knex)) {
    if (!(await isDistributed(knex, 'teams_audit_events'))) {
      await knex.raw(
        `SELECT create_distributed_table(?, 'tenant', colocate_with => 'teams_integrations')`,
        ['teams_audit_events']
      );
    }
  } else {
    console.warn('[teams_audit_events] Skipping create_distributed_table (function unavailable)');
  }
};

exports.down = async function down(knex) {
  await knex.raw(`DROP FUNCTION IF EXISTS cleanup_teams_audit_events(interval);`);
  await knex.raw(`DROP TABLE IF EXISTS teams_audit_events;`);
};

exports.config = { transaction: false };
