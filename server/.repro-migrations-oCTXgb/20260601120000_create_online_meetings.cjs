const ONLINE_MEETING_STATUSES = [
  'scheduled',
  'ended',
  'recording_pending',
  'recording_ready',
  'no_recording',
  'cancelled',
  'failed',
];

const ONLINE_MEETING_ARTIFACT_TYPES = ['recording', 'transcript'];

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
  const result = await knex.raw(
    `
    SELECT EXISTS (
      SELECT 1
      FROM pg_dist_partition
      WHERE logicalrelid = ?::regclass
    ) AS is_distributed;
  `,
    [tableName],
  );

  return Boolean(result.rows?.[0]?.is_distributed);
}

async function distributeIfNeeded(knex, tableName, colocateWith) {
  if (!(await citusFunctionAvailable(knex))) {
    console.warn(`[create_online_meetings] Skipping create_distributed_table for ${tableName} (function unavailable)`);
    return;
  }

  if (!(await isDistributed(knex, tableName))) {
    await knex.raw(
      `SELECT create_distributed_table(?, 'tenant', colocate_with => ?)`,
      [tableName, colocateWith],
    );
  }
}

exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS online_meetings (
      tenant uuid NOT NULL,
      meeting_id uuid NOT NULL DEFAULT gen_random_uuid(),
      provider text NOT NULL DEFAULT 'teams',
      provider_meeting_id text NOT NULL,
      provider_event_id text,
      organizer_upn text,
      organizer_user_id text,
      subject text NOT NULL,
      join_url text NOT NULL,
      start_time timestamptz NOT NULL,
      end_time timestamptz NOT NULL,
      status text NOT NULL DEFAULT 'scheduled',
      recording_fetch_attempts integer NOT NULL DEFAULT 0,
      last_fetch_at timestamptz,
      appointment_request_id uuid,
      interaction_id uuid,
      schedule_entry_id uuid,
      created_by uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT online_meetings_pk PRIMARY KEY (tenant, meeting_id),
      CONSTRAINT online_meetings_provider_meeting_uk UNIQUE (tenant, provider, provider_meeting_id),
      CONSTRAINT online_meetings_status_check
        CHECK (status IN (${ONLINE_MEETING_STATUSES.map((status) => `'${status}'`).join(', ')})),
      CONSTRAINT online_meetings_fetch_attempts_nonnegative_check
        CHECK (recording_fetch_attempts >= 0),
      CONSTRAINT online_meetings_time_order_check
        CHECK (end_time >= start_time)
    );
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS online_meetings_interaction_idx
    ON online_meetings (tenant, interaction_id);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS online_meetings_appointment_request_idx
    ON online_meetings (tenant, appointment_request_id);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS online_meetings_status_end_time_idx
    ON online_meetings (tenant, status, end_time);
  `);

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS online_meeting_artifacts (
      tenant uuid NOT NULL,
      artifact_id uuid NOT NULL DEFAULT gen_random_uuid(),
      meeting_id uuid NOT NULL,
      artifact_type text NOT NULL,
      provider_artifact_id text NOT NULL,
      content_url text,
      document_id uuid,
      file_id uuid,
      created_date_time timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT online_meeting_artifacts_pk PRIMARY KEY (tenant, artifact_id),
      CONSTRAINT online_meeting_artifacts_meeting_type_provider_uk
        UNIQUE (tenant, meeting_id, artifact_type, provider_artifact_id),
      CONSTRAINT online_meeting_artifacts_type_check
        CHECK (artifact_type IN (${ONLINE_MEETING_ARTIFACT_TYPES.map((type) => `'${type}'`).join(', ')}))
    );
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS online_meeting_artifacts_meeting_idx
    ON online_meeting_artifacts (tenant, meeting_id);
  `);

  await distributeIfNeeded(knex, 'online_meetings', 'tenants');
  await distributeIfNeeded(knex, 'online_meeting_artifacts', 'online_meetings');
};

exports.down = async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS online_meeting_artifacts CASCADE;`);
  await knex.raw(`DROP TABLE IF EXISTS online_meetings CASCADE;`);
};

exports.config = { transaction: false };
