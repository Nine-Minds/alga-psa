/**
 * Migration: Create Entra integration Phase 1 schema (EE)
 *
 * This migration is intentionally idempotent for shared/dev databases.
 */

const ensureTable = async (knex, tableName, createFn) => {
  const exists = await knex.schema.hasTable(tableName);
  if (!exists) {
    await createFn();
  }
};

const ensureColumn = async (knex, tableName, columnName, alterFn) => {
  const exists = await knex.schema.hasColumn(tableName, columnName);
  if (!exists) {
    await knex.schema.alterTable(tableName, alterFn);
  }
};

const ENTRA_DISTRIBUTED_TABLES = [
  'entra_partner_connections',
  'entra_managed_tenants',
  'entra_client_tenant_mappings',
  'entra_sync_settings',
  'entra_sync_runs',
  'entra_sync_run_tenants',
  'entra_contact_links',
  'entra_contact_reconciliation_queue',
];

const isCitusEnabled = async (knex) => {
  const result = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) AS enabled
  `);

  return Boolean(result.rows?.[0]?.enabled);
};

const isTableDistributed = async (knex, tableName) => {
  const result = await knex.raw(
    `
      SELECT EXISTS (
        SELECT 1
        FROM pg_dist_partition
        WHERE logicalrelid = ?::regclass
      ) AS distributed
    `,
    [tableName]
  );

  return Boolean(result.rows?.[0]?.distributed);
};

const ensureDistributedTable = async (knex, tableName) => {
  const exists = await knex.schema.hasTable(tableName);
  if (!exists) {
    return;
  }

  const distributed = await isTableDistributed(knex, tableName);
  if (distributed) {
    return;
  }

  await knex.raw(`SELECT create_distributed_table('${tableName}', 'tenant', colocate_with => 'tenants')`);
};

exports.up = async function up(knex) {
  await ensureTable(knex, 'entra_partner_connections', async () => {
    await knex.schema.createTable('entra_partner_connections', (table) => {
      table.uuid('tenant').notNullable();
      table
        .uuid('connection_id')
        .defaultTo(knex.raw('gen_random_uuid()'))
        .notNullable();
      table.text('connection_type').notNullable();
      table.text('status').notNullable().defaultTo('disconnected');
      table.boolean('is_active').notNullable().defaultTo(false);
      table.text('cipp_base_url');
      table.text('token_secret_ref');
      table.timestamp('connected_at', { useTz: true });
      table.timestamp('disconnected_at', { useTz: true });
      table.timestamp('last_validated_at', { useTz: true });
      table.jsonb('last_validation_error').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
      table.uuid('created_by');
      table.uuid('updated_by');
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'connection_id']);
      table.foreign('tenant').references('tenants.tenant').onDelete('CASCADE');
      table.unique(['tenant', 'connection_id']);
    });
  });

  await ensureTable(knex, 'entra_managed_tenants', async () => {
    await knex.schema.createTable('entra_managed_tenants', (table) => {
      table.uuid('tenant').notNullable();
      table
        .uuid('managed_tenant_id')
        .defaultTo(knex.raw('gen_random_uuid()'))
        .notNullable();
      table.text('entra_tenant_id').notNullable();
      table.text('display_name');
      table.text('primary_domain');
      table.integer('source_user_count').notNullable().defaultTo(0);
      table.timestamp('discovered_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('last_seen_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.jsonb('metadata').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'managed_tenant_id']);
      table.foreign('tenant').references('tenants.tenant').onDelete('CASCADE');
      table.unique(['tenant', 'entra_tenant_id']);
    });
  });

  await ensureTable(knex, 'entra_client_tenant_mappings', async () => {
    await knex.schema.createTable('entra_client_tenant_mappings', (table) => {
      table.uuid('tenant').notNullable();
      table
        .uuid('mapping_id')
        .defaultTo(knex.raw('gen_random_uuid()'))
        .notNullable();
      table.uuid('managed_tenant_id').notNullable();
      table.uuid('client_id');
      table.text('mapping_state').notNullable().defaultTo('needs_review');
      table.decimal('confidence_score', 5, 2);
      table.boolean('is_active').notNullable().defaultTo(true);
      table.uuid('decided_by');
      table.timestamp('decided_at', { useTz: true });
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'mapping_id']);
      table
        .foreign(['tenant', 'managed_tenant_id'])
        .references(['tenant', 'managed_tenant_id'])
        .inTable('entra_managed_tenants')
        .onDelete('CASCADE');
      table
        .foreign(['tenant', 'client_id'])
        .references(['tenant', 'client_id'])
        .inTable('clients')
        .onDelete('RESTRICT');
    });
  });

  await ensureTable(knex, 'entra_sync_settings', async () => {
    await knex.schema.createTable('entra_sync_settings', (table) => {
      table.uuid('tenant').notNullable();
      table
        .uuid('settings_id')
        .defaultTo(knex.raw('gen_random_uuid()'))
        .notNullable();
      table.boolean('sync_enabled').notNullable().defaultTo(true);
      table.integer('sync_interval_minutes').notNullable().defaultTo(1440);
      table.jsonb('field_sync_config').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
      table.jsonb('user_filter_config').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'settings_id']);
      table.foreign('tenant').references('tenants.tenant').onDelete('CASCADE');
    });
  });

  await ensureTable(knex, 'entra_sync_runs', async () => {
    await knex.schema.createTable('entra_sync_runs', (table) => {
      table.uuid('tenant').notNullable();
      table
        .uuid('run_id')
        .defaultTo(knex.raw('gen_random_uuid()'))
        .notNullable();
      table.text('workflow_id');
      table.text('run_type').notNullable().defaultTo('manual');
      table.text('status').notNullable().defaultTo('queued');
      table.uuid('initiated_by');
      table.timestamp('started_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('completed_at', { useTz: true });
      table.integer('total_tenants').notNullable().defaultTo(0);
      table.integer('processed_tenants').notNullable().defaultTo(0);
      table.integer('succeeded_tenants').notNullable().defaultTo(0);
      table.integer('failed_tenants').notNullable().defaultTo(0);
      table.jsonb('summary').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'run_id']);
      table.foreign('tenant').references('tenants.tenant').onDelete('CASCADE');
    });
  });

  await ensureTable(knex, 'entra_sync_run_tenants', async () => {
    await knex.schema.createTable('entra_sync_run_tenants', (table) => {
      table.uuid('tenant').notNullable();
      table
        .uuid('run_tenant_id')
        .defaultTo(knex.raw('gen_random_uuid()'))
        .notNullable();
      table.uuid('run_id').notNullable();
      table.uuid('managed_tenant_id');
      table.uuid('client_id');
      table.text('status').notNullable().defaultTo('queued');
      table.integer('created_count').notNullable().defaultTo(0);
      table.integer('linked_count').notNullable().defaultTo(0);
      table.integer('updated_count').notNullable().defaultTo(0);
      table.integer('ambiguous_count').notNullable().defaultTo(0);
      table.integer('inactivated_count').notNullable().defaultTo(0);
      table.text('error_message');
      table.timestamp('started_at', { useTz: true });
      table.timestamp('completed_at', { useTz: true });
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'run_tenant_id']);
      table
        .foreign(['tenant', 'run_id'])
        .references(['tenant', 'run_id'])
        .inTable('entra_sync_runs')
        .onDelete('CASCADE');
      table
        .foreign(['tenant', 'managed_tenant_id'])
        .references(['tenant', 'managed_tenant_id'])
        .inTable('entra_managed_tenants')
        .onDelete('RESTRICT');
      table
        .foreign(['tenant', 'client_id'])
        .references(['tenant', 'client_id'])
        .inTable('clients')
        .onDelete('RESTRICT');
    });
  });

  await ensureTable(knex, 'entra_contact_links', async () => {
    await knex.schema.createTable('entra_contact_links', (table) => {
      table.uuid('tenant').notNullable();
      table
        .uuid('link_id')
        .defaultTo(knex.raw('gen_random_uuid()'))
        .notNullable();
      table.uuid('contact_name_id').notNullable();
      table.uuid('client_id');
      table.text('entra_tenant_id').notNullable();
      table.text('entra_object_id').notNullable();
      table.text('link_status').notNullable().defaultTo('active');
      table.boolean('is_active').notNullable().defaultTo(true);
      table.timestamp('last_seen_at', { useTz: true });
      table.timestamp('last_synced_at', { useTz: true });
      table.jsonb('metadata').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'link_id']);
      table
        .foreign(['tenant', 'contact_name_id'])
        .references(['tenant', 'contact_name_id'])
        .inTable('contacts')
        .onDelete('CASCADE');
      table
        .foreign(['tenant', 'client_id'])
        .references(['tenant', 'client_id'])
        .inTable('clients')
        .onDelete('RESTRICT');
    });
  });

  await ensureTable(knex, 'entra_contact_reconciliation_queue', async () => {
    await knex.schema.createTable('entra_contact_reconciliation_queue', (table) => {
      table.uuid('tenant').notNullable();
      table
        .uuid('queue_item_id')
        .defaultTo(knex.raw('gen_random_uuid()'))
        .notNullable();
      table.uuid('managed_tenant_id');
      table.uuid('client_id');
      table.text('entra_tenant_id').notNullable();
      table.text('entra_object_id').notNullable();
      table.text('user_principal_name');
      table.text('display_name');
      table.text('email');
      table.jsonb('candidate_contacts').notNullable().defaultTo(knex.raw(`'[]'::jsonb`));
      table.text('status').notNullable().defaultTo('open');
      table.text('resolution_action');
      table.uuid('resolved_contact_id');
      table.uuid('resolved_by');
      table.timestamp('resolved_at', { useTz: true });
      table.jsonb('payload').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'queue_item_id']);
      table
        .foreign(['tenant', 'managed_tenant_id'])
        .references(['tenant', 'managed_tenant_id'])
        .inTable('entra_managed_tenants')
        .onDelete('RESTRICT');
      table
        .foreign(['tenant', 'client_id'])
        .references(['tenant', 'client_id'])
        .inTable('clients')
        .onDelete('RESTRICT');
      table
        .foreign(['tenant', 'resolved_contact_id'])
        .references(['tenant', 'contact_name_id'])
        .inTable('contacts')
        .onDelete('RESTRICT');
    });
  });

  await ensureColumn(knex, 'clients', 'entra_tenant_id', (table) => {
    table.text('entra_tenant_id');
  });

  await ensureColumn(knex, 'clients', 'entra_primary_domain', (table) => {
    table.text('entra_primary_domain');
  });

  await ensureColumn(knex, 'contacts', 'entra_object_id', (table) => {
    table.text('entra_object_id');
  });

  await ensureColumn(knex, 'contacts', 'entra_sync_source', (table) => {
    table.text('entra_sync_source');
  });

  await ensureColumn(knex, 'contacts', 'last_entra_sync_at', (table) => {
    table.timestamp('last_entra_sync_at', { useTz: true });
  });

  await ensureColumn(knex, 'contacts', 'entra_user_principal_name', (table) => {
    table.text('entra_user_principal_name');
  });

  await ensureColumn(knex, 'contacts', 'entra_account_enabled', (table) => {
    table.boolean('entra_account_enabled');
  });

  await ensureColumn(knex, 'contacts', 'entra_sync_status', (table) => {
    table.text('entra_sync_status');
  });

  await ensureColumn(knex, 'contacts', 'entra_sync_status_reason', (table) => {
    table.text('entra_sync_status_reason');
  });

  const inRecovery = await knex.raw(`SELECT pg_is_in_recovery() AS in_recovery`);
  if (!inRecovery.rows?.[0]?.in_recovery && await isCitusEnabled(knex)) {
    for (const tableName of ENTRA_DISTRIBUTED_TABLES) {
      await ensureDistributedTable(knex, tableName);
    }
  }

  await knex.schema.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_entra_partner_connections_active_per_tenant
    ON entra_partner_connections (tenant)
    WHERE is_active = true
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_entra_partner_connections_tenant_status
    ON entra_partner_connections (tenant, status)
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_entra_managed_tenants_tenant_last_seen
    ON entra_managed_tenants (tenant, last_seen_at DESC)
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_entra_managed_tenants_tenant_primary_domain
    ON entra_managed_tenants (tenant, lower(primary_domain))
  `);

  await knex.schema.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_entra_client_tenant_mappings_active
    ON entra_client_tenant_mappings (tenant, managed_tenant_id)
    WHERE is_active = true
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_entra_client_tenant_mappings_client
    ON entra_client_tenant_mappings (tenant, client_id, mapping_state)
  `);

  await knex.schema.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_entra_sync_settings_tenant
    ON entra_sync_settings (tenant)
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_entra_sync_runs_tenant_started_at
    ON entra_sync_runs (tenant, started_at DESC)
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_entra_sync_run_tenants_run
    ON entra_sync_run_tenants (tenant, run_id, status)
  `);

  await knex.schema.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_entra_contact_links_entra_identity
    ON entra_contact_links (tenant, entra_tenant_id, entra_object_id)
  `);

  await knex.schema.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_entra_contact_links_active_contact
    ON entra_contact_links (tenant, contact_name_id)
    WHERE is_active = true
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_entra_contact_links_client
    ON entra_contact_links (tenant, client_id, link_status)
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_entra_reconciliation_queue_status
    ON entra_contact_reconciliation_queue (tenant, status, created_at DESC)
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_entra_reconciliation_queue_identity
    ON entra_contact_reconciliation_queue (tenant, entra_tenant_id, entra_object_id)
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_clients_entra_tenant
    ON clients (tenant, entra_tenant_id)
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_contacts_entra_object
    ON contacts (tenant, entra_object_id)
  `);

  await knex.raw(`
    INSERT INTO entra_sync_settings (
      tenant,
      settings_id,
      sync_enabled,
      sync_interval_minutes,
      field_sync_config,
      user_filter_config,
      created_at,
      updated_at
    )
    SELECT
      tenants.tenant,
      gen_random_uuid(),
      true,
      1440,
      '{}'::jsonb,
      '{}'::jsonb,
      NOW(),
      NOW()
    FROM tenants
    WHERE NOT EXISTS (
      SELECT 1
      FROM entra_sync_settings
      WHERE entra_sync_settings.tenant = tenants.tenant
    )
  `);

  const dbUserServer = process.env.DB_USER_SERVER;
  if (dbUserServer) {
    const escapedUser = dbUserServer.replace(/"/g, '""');
    await knex.schema.raw(`
      GRANT ALL PRIVILEGES ON TABLE entra_partner_connections TO "${escapedUser}";
      GRANT ALL PRIVILEGES ON TABLE entra_managed_tenants TO "${escapedUser}";
      GRANT ALL PRIVILEGES ON TABLE entra_client_tenant_mappings TO "${escapedUser}";
      GRANT ALL PRIVILEGES ON TABLE entra_sync_settings TO "${escapedUser}";
      GRANT ALL PRIVILEGES ON TABLE entra_sync_runs TO "${escapedUser}";
      GRANT ALL PRIVILEGES ON TABLE entra_sync_run_tenants TO "${escapedUser}";
      GRANT ALL PRIVILEGES ON TABLE entra_contact_links TO "${escapedUser}";
      GRANT ALL PRIVILEGES ON TABLE entra_contact_reconciliation_queue TO "${escapedUser}";
    `);
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('entra_contact_reconciliation_queue');
  await knex.schema.dropTableIfExists('entra_contact_links');
  await knex.schema.dropTableIfExists('entra_sync_run_tenants');
  await knex.schema.dropTableIfExists('entra_sync_runs');
  await knex.schema.dropTableIfExists('entra_sync_settings');
  await knex.schema.dropTableIfExists('entra_client_tenant_mappings');
  await knex.schema.dropTableIfExists('entra_managed_tenants');
  await knex.schema.dropTableIfExists('entra_partner_connections');

  const dropColumnIfExists = async (tableName, columnName) => {
    const has = await knex.schema.hasColumn(tableName, columnName);
    if (has) {
      await knex.schema.alterTable(tableName, (table) => {
        table.dropColumn(columnName);
      });
    }
  };

  await dropColumnIfExists('clients', 'entra_tenant_id');
  await dropColumnIfExists('clients', 'entra_primary_domain');

  await dropColumnIfExists('contacts', 'entra_object_id');
  await dropColumnIfExists('contacts', 'entra_sync_source');
  await dropColumnIfExists('contacts', 'last_entra_sync_at');
  await dropColumnIfExists('contacts', 'entra_user_principal_name');
  await dropColumnIfExists('contacts', 'entra_account_enabled');
  await dropColumnIfExists('contacts', 'entra_sync_status');
  await dropColumnIfExists('contacts', 'entra_sync_status_reason');
};

exports.config = { transaction: false };
