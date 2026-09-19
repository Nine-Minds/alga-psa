/**
 * Create the tenant-scoped SCIM user lifecycle schema.
 *
 * The provider is inert until an administrator creates and enables a
 * connection. Token plaintext is never stored.
 */

const SCIM_TABLES = [
  'scim_connections',
  'scim_user_links',
  'scim_unresolved_identities',
  'scim_operations',
];

async function isCitusEnabled(knex) {
  const result = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) AS enabled
  `);
  return Boolean(result.rows?.[0]?.enabled);
}

async function isTableDistributed(knex, tableName) {
  const result = await knex.raw(
    `
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass
      ) AS distributed
    `,
    [tableName]
  );
  return Boolean(result.rows?.[0]?.distributed);
}

async function ensureDistributedTable(knex, tableName) {
  if (!await isTableDistributed(knex, tableName)) {
    await knex.raw(
      `SELECT create_distributed_table(?, 'tenant', colocate_with => 'tenants')`,
      [tableName]
    );
  }
}

exports.up = async function up(knex) {
  if (!await knex.schema.hasTable('scim_connections')) {
    await knex.schema.createTable('scim_connections', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('connection_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.boolean('enabled').notNullable().defaultTo(true);
      table.text('current_token_hash');
      table.integer('current_token_generation').notNullable().defaultTo(0);
      table.timestamp('current_token_created_at', { useTz: true });
      table.text('previous_token_hash');
      table.timestamp('previous_token_expires_at', { useTz: true });
      table.timestamp('last_authenticated_at', { useTz: true });
      table.timestamp('last_success_at', { useTz: true });
      table.text('last_error_code');
      table.text('last_error_detail');
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'connection_id']);
      table.foreign('tenant').references('tenants.tenant').onDelete('CASCADE');
      table.unique(['tenant']);
    });
  }

  if (!await knex.schema.hasTable('scim_user_links')) {
    await knex.schema.createTable('scim_user_links', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('link_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('connection_id').notNullable();
      table.uuid('user_id').notNullable();
      table.text('external_id').notNullable();
      table.text('observed_user_name').notNullable();
      table.text('observed_primary_email');
      table.text('observed_display_name');
      table.text('observed_given_name');
      table.text('observed_family_name');
      table.text('observed_title');
      table.boolean('upstream_active').notNullable().defaultTo(true);
      table.text('link_state').notNullable().defaultTo('active');
      table.timestamp('scim_inactive_at', { useTz: true });
      table.timestamp('last_operation_at', { useTz: true });
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'link_id']);
      table
        .foreign(['tenant', 'connection_id'])
        .references(['tenant', 'connection_id'])
        .inTable('scim_connections')
        .onDelete('CASCADE');
      table
        .foreign(['tenant', 'user_id'])
        .references(['tenant', 'user_id'])
        .inTable('users')
        .onDelete('RESTRICT');
    });
  }

  if (!await knex.schema.hasTable('scim_unresolved_identities')) {
    await knex.schema.createTable('scim_unresolved_identities', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('unresolved_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('connection_id').notNullable();
      table.text('external_id');
      table.text('observed_user_name').notNullable();
      table.text('observed_primary_email');
      table.text('observed_display_name');
      table.boolean('observed_active').notNullable().defaultTo(true);
      table.text('failure_reason').notNullable();
      table.integer('attempt_count').notNullable().defaultTo(1);
      table.text('resolution_state').notNullable().defaultTo('open');
      table.uuid('resolved_user_id');
      table.uuid('resolved_by');
      table.timestamp('resolved_at', { useTz: true });
      table.timestamp('first_seen_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('last_seen_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'unresolved_id']);
      table
        .foreign(['tenant', 'connection_id'])
        .references(['tenant', 'connection_id'])
        .inTable('scim_connections')
        .onDelete('CASCADE');
    });
  }

  if (!await knex.schema.hasTable('scim_operations')) {
    await knex.schema.createTable('scim_operations', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('operation_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('connection_id').notNullable();
      table.uuid('link_id');
      table.text('operation').notNullable();
      table.text('outcome').notNullable();
      table.text('external_id');
      table.text('detail_code');
      table.jsonb('sanitized_detail').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'operation_id']);
      table
        .foreign(['tenant', 'connection_id'])
        .references(['tenant', 'connection_id'])
        .inTable('scim_connections')
        .onDelete('CASCADE');
    });
  }

  if (!await knex.schema.hasColumn('scim_unresolved_identities', 'observed_active')) {
    await knex.schema.alterTable('scim_unresolved_identities', (table) => {
      table.boolean('observed_active').notNullable().defaultTo(true);
    });
  }

  const recovery = await knex.raw('SELECT pg_is_in_recovery() AS in_recovery');
  if (!recovery.rows?.[0]?.in_recovery && await isCitusEnabled(knex)) {
    for (const tableName of SCIM_TABLES) {
      await ensureDistributedTable(knex, tableName);
    }
  }

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_scim_links_external_identity
    ON scim_user_links (tenant, connection_id, external_id)
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_scim_links_managed_user
    ON scim_user_links (tenant, user_id)
    WHERE link_state <> 'unlinked'
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_scim_links_connection_username
    ON scim_user_links (tenant, connection_id, lower(observed_user_name))
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_scim_unresolved_open_identity
    ON scim_unresolved_identities (
      tenant,
      connection_id,
      COALESCE(external_id, ''),
      lower(observed_user_name)
    )
    WHERE resolution_state = 'open'
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_scim_unresolved_status
    ON scim_unresolved_identities (tenant, connection_id, resolution_state, last_seen_at DESC)
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_scim_operations_recent
    ON scim_operations (tenant, connection_id, created_at DESC)
  `);
  await knex.raw(`
    ALTER TABLE scim_user_links
    ADD CONSTRAINT ck_scim_user_links_state
    CHECK (link_state IN ('active', 'deprovisioned', 'unlinked'))
  `).catch((error) => {
    if (error?.code !== '42710') throw error;
  });
  await knex.raw(`
    ALTER TABLE scim_unresolved_identities
    ADD CONSTRAINT ck_scim_unresolved_state
    CHECK (resolution_state IN ('open', 'resolved', 'dismissed'))
  `).catch((error) => {
    if (error?.code !== '42710') throw error;
  });

  const dbUserServer = process.env.DB_USER_SERVER;
  if (dbUserServer) {
    const escapedUser = dbUserServer.replace(/"/g, '""');
    await knex.raw(`
      GRANT ALL PRIVILEGES ON TABLE scim_connections TO "${escapedUser}";
      GRANT ALL PRIVILEGES ON TABLE scim_user_links TO "${escapedUser}";
      GRANT ALL PRIVILEGES ON TABLE scim_unresolved_identities TO "${escapedUser}";
      GRANT ALL PRIVILEGES ON TABLE scim_operations TO "${escapedUser}";
    `);
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('scim_operations');
  await knex.schema.dropTableIfExists('scim_unresolved_identities');
  await knex.schema.dropTableIfExists('scim_user_links');
  await knex.schema.dropTableIfExists('scim_connections');
};

exports.config = { transaction: false };
