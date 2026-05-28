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
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS teams_conversation_references (
      tenant uuid NOT NULL,
      microsoft_user_id text NOT NULL,
      conversation_id text NOT NULL,
      conversation_type text NOT NULL,
      service_url text NOT NULL,
      tenant_id_aad text,
      channel_id_bot_framework text,
      last_activity_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT teams_conversation_references_pk PRIMARY KEY (tenant, microsoft_user_id, conversation_id)
    );
  `);

  if (await citusFunctionAvailable(knex)) {
    if (!(await isDistributed(knex, 'teams_conversation_references'))) {
      await knex.raw(
        `SELECT create_distributed_table(?, 'tenant', colocate_with => 'teams_integrations')`,
        ['teams_conversation_references']
      );
    }
  } else {
    console.warn('[teams_conversation_references] Skipping create_distributed_table (function unavailable)');
  }
};

exports.down = async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS teams_conversation_references;`);
};

exports.config = { transaction: false };
