const { canCreateDistributedTable } = require('./utils/citusDistribution.cjs');

exports.up = async function up(knex) {
  await knex.schema.createTable('email_sender_addresses', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('sender_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('email_address').notNullable();
    table.text('display_name').nullable();
    table.uuid('microsoft_provider_id').nullable();
    table.text('verification_status').notNullable().defaultTo('unverified');
    table.timestamp('verified_at', { useTz: true }).nullable();
    table.text('last_verification_error').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'sender_id']);
    table.unique(['tenant', 'email_address']);
  });

  await knex.schema.createTable('email_sender_routes', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('route_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('route_type').notNullable();
    table.text('mail_class').nullable();
    table.uuid('board_id').nullable();
    table.uuid('sender_id').nullable();
    table.text('display_name').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'route_id']);
  });

  await knex.raw("CREATE UNIQUE INDEX email_sender_routes_default_unique ON email_sender_routes (tenant) WHERE route_type = 'default'");
  await knex.raw("CREATE UNIQUE INDEX email_sender_routes_class_unique ON email_sender_routes (tenant, mail_class) WHERE route_type = 'mail_class'");
  await knex.raw("CREATE UNIQUE INDEX email_sender_routes_board_unique ON email_sender_routes (tenant, board_id) WHERE route_type = 'board'");

  const citus = await knex.raw("SELECT 1 FROM pg_extension WHERE extname = 'citus'");
  if (citus.rows.length) {
    await knex.raw("SELECT create_distributed_table('email_sender_addresses', 'tenant')");
    await knex.raw("SELECT create_distributed_table('email_sender_routes', 'tenant')");
  }

  await knex.raw("ALTER TABLE email_sender_addresses ADD CONSTRAINT email_sender_addresses_status_check CHECK (verification_status IN ('unverified', 'verified', 'failed'))");
  await knex.raw("ALTER TABLE email_sender_routes ADD CONSTRAINT email_sender_routes_shape_check CHECK ((route_type = 'default' AND mail_class IS NULL AND board_id IS NULL) OR (route_type = 'mail_class' AND mail_class IS NOT NULL AND board_id IS NULL) OR (route_type = 'board' AND board_id IS NOT NULL AND mail_class IS NULL))");
  await knex.raw("ALTER TABLE email_sender_routes ADD CONSTRAINT email_sender_routes_value_check CHECK (sender_id IS NOT NULL OR display_name IS NOT NULL)");

  await knex.raw('ALTER TABLE email_sender_addresses ADD CONSTRAINT email_sender_addresses_tenant_fk FOREIGN KEY (tenant) REFERENCES tenants(tenant) ON DELETE CASCADE');
  // email_providers is not distributed/reference on Citus, so that FK is
  // unsupported there. createEmailSender validates the provider in tenant scope.
  if (!(await canCreateDistributedTable(knex))) {
    await knex.raw('ALTER TABLE email_sender_addresses ADD CONSTRAINT email_sender_addresses_microsoft_provider_fk FOREIGN KEY (microsoft_provider_id, tenant) REFERENCES email_providers(id, tenant) ON DELETE RESTRICT');
  }
  await knex.raw('ALTER TABLE email_sender_routes ADD CONSTRAINT email_sender_routes_tenant_fk FOREIGN KEY (tenant) REFERENCES tenants(tenant) ON DELETE CASCADE');
  await knex.raw('ALTER TABLE email_sender_routes ADD CONSTRAINT email_sender_routes_board_fk FOREIGN KEY (tenant, board_id) REFERENCES boards(tenant, board_id) ON DELETE CASCADE');
  await knex.raw('ALTER TABLE email_sender_routes ADD CONSTRAINT email_sender_routes_sender_fk FOREIGN KEY (tenant, sender_id) REFERENCES email_sender_addresses(tenant, sender_id) ON DELETE RESTRICT');

  await knex.raw(`
    INSERT INTO email_sender_addresses
      (tenant, email_address, display_name, microsoft_provider_id, verification_status)
    SELECT tes.tenant, lower(trim(tes.ticketing_from_email)), coalesce(nullif(trim(tes.ticketing_from_name), ''), nullif(trim(ep.sender_display_name), '')),
      ep.id, CASE WHEN lower(tes.email_provider) = 'resend' AND ed.domain_name IS NULL THEN 'unverified' ELSE 'verified' END
    FROM tenant_email_settings tes
    LEFT JOIN email_providers ep
      ON ep.tenant = tes.tenant AND lower(ep.mailbox) = lower(trim(tes.ticketing_from_email))
      AND ep.provider_type = 'microsoft'
      AND lower(tes.email_provider) = 'microsoft'
    LEFT JOIN email_domains ed
      ON ed.tenant = tes.tenant
      AND ed.domain_name = lower(split_part(trim(tes.ticketing_from_email), '@', 2))
      AND ed.status = 'verified'
    WHERE nullif(trim(tes.ticketing_from_email), '') IS NOT NULL
    ON CONFLICT (tenant, email_address) DO NOTHING
  `);
  await knex.raw(`
    -- An unverified legacy Resend address is retained as an identity for review,
    -- but not installed as a ticket sender. The name-only route below preserves
    -- configured branding while delivery uses the tenant's existing default.
    INSERT INTO email_sender_routes (tenant, route_type, mail_class, sender_id, display_name)
    SELECT tes.tenant, 'mail_class', 'ticket',
      CASE WHEN esa.verification_status = 'verified' THEN esa.sender_id END,
      coalesce(nullif(trim(tes.ticketing_from_name), ''), nullif(trim(ep.sender_display_name), ''))
    FROM tenant_email_settings tes
    LEFT JOIN email_sender_addresses esa
      ON esa.tenant = tes.tenant AND esa.email_address = lower(trim(tes.ticketing_from_email))
    LEFT JOIN email_providers ep
      ON ep.tenant = tes.tenant AND lower(ep.mailbox) = lower(trim(tes.ticketing_from_email))
      AND ep.provider_type = 'microsoft'
      AND lower(tes.email_provider) = 'microsoft'
    WHERE (nullif(trim(tes.ticketing_from_email), '') IS NOT NULL
       OR nullif(trim(tes.ticketing_from_name), '') IS NOT NULL)
      AND (esa.verification_status = 'verified'
        OR nullif(trim(tes.ticketing_from_name), '') IS NOT NULL
        OR nullif(trim(ep.sender_display_name), '') IS NOT NULL)
    ON CONFLICT (tenant, mail_class) WHERE route_type = 'mail_class' DO NOTHING
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('email_sender_routes');
  await knex.schema.dropTableIfExists('email_sender_addresses');
};
