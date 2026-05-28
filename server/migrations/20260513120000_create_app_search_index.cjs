/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm');

  await knex.raw(`
    CREATE TABLE app_search_index (
      tenant uuid NOT NULL,
      object_type text NOT NULL,
      object_id text NOT NULL,
      parent_type text,
      parent_id text,
      title text NOT NULL,
      subtitle text,
      body text,
      url text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      visible_to_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
      visible_to_roles text[] NOT NULL DEFAULT '{}'::text[],
      is_internal_only boolean NOT NULL DEFAULT false,
      is_private boolean NOT NULL DEFAULT false,
      client_scope_id uuid,
      required_permission text,
      search_vector tsvector NOT NULL,
      search_lang text NOT NULL DEFAULT 'english',
      source_updated_at timestamptz NOT NULL,
      indexed_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant, object_type, object_id)
    )
  `);

  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_extension
      WHERE extname = 'citus'
    ) AS enabled;
  `);

  if (citusEnabled.rows?.[0]?.enabled) {
    const alreadyDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_dist_partition
        WHERE logicalrelid = 'app_search_index'::regclass
      ) AS is_distributed;
    `);

    if (!alreadyDistributed.rows?.[0]?.is_distributed) {
      await knex.raw("SELECT create_distributed_table('app_search_index', 'tenant')");
    }
  } else {
    console.warn('[create_app_search_index] Skipping create_distributed_table (Citus extension unavailable)');
  }

  await knex.raw(`
    CREATE INDEX app_search_index_vector_gin
    ON app_search_index USING gin (search_vector)
  `);

  await knex.raw(`
    CREATE INDEX app_search_index_title_trgm
    ON app_search_index USING gin (title gin_trgm_ops)
  `);

  await knex.raw(`
    CREATE INDEX app_search_index_subtitle_trgm
    ON app_search_index USING gin (subtitle gin_trgm_ops)
  `);

  await knex.raw(`
    CREATE INDEX app_search_index_recent
    ON app_search_index (tenant, source_updated_at DESC)
  `);

  await knex.raw(`
    CREATE INDEX app_search_index_type
    ON app_search_index (tenant, object_type)
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('app_search_index');
};

// create_distributed_table cannot run inside a transaction block.
exports.config = { transaction: false };
