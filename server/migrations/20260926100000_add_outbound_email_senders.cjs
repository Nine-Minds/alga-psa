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
    table.foreign('tenant').references('tenants.tenant').onDelete('CASCADE');
    table.foreign(['microsoft_provider_id', 'tenant']).references(['email_providers.id', 'email_providers.tenant']);
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
    table.foreign('tenant').references('tenants.tenant').onDelete('CASCADE');
    table.foreign(['tenant', 'board_id']).references(['boards.tenant', 'boards.board_id']).onDelete('CASCADE');
    table.foreign(['tenant', 'sender_id']).references(['email_sender_addresses.tenant', 'email_sender_addresses.sender_id']).onDelete('RESTRICT');
  });

  await knex.raw("ALTER TABLE email_sender_addresses ADD CONSTRAINT email_sender_addresses_status_check CHECK (verification_status IN ('unverified', 'verified', 'failed'))");
  await knex.raw("ALTER TABLE email_sender_routes ADD CONSTRAINT email_sender_routes_shape_check CHECK ((route_type = 'default' AND mail_class IS NULL AND board_id IS NULL) OR (route_type = 'mail_class' AND mail_class IS NOT NULL AND board_id IS NULL) OR (route_type = 'board' AND board_id IS NOT NULL AND mail_class IS NULL))");
  await knex.raw("ALTER TABLE email_sender_routes ADD CONSTRAINT email_sender_routes_value_check CHECK (sender_id IS NOT NULL OR display_name IS NOT NULL)");
  await knex.raw("CREATE UNIQUE INDEX email_sender_routes_default_unique ON email_sender_routes (tenant) WHERE route_type = 'default'");
  await knex.raw("CREATE UNIQUE INDEX email_sender_routes_class_unique ON email_sender_routes (tenant, mail_class) WHERE route_type = 'mail_class'");
  await knex.raw("CREATE UNIQUE INDEX email_sender_routes_board_unique ON email_sender_routes (tenant, board_id) WHERE route_type = 'board'");

  const citus = await knex.raw("SELECT 1 FROM pg_extension WHERE extname = 'citus'");
  if (citus.rows.length) {
    await knex.raw("SELECT create_distributed_table('email_sender_addresses', 'tenant')");
    await knex.raw("SELECT create_distributed_table('email_sender_routes', 'tenant')");
  }

  await knex.raw(`
    INSERT INTO email_sender_addresses
      (tenant, email_address, display_name, microsoft_provider_id, verification_status)
    SELECT tes.tenant, lower(trim(tes.ticketing_from_email)), nullif(trim(tes.ticketing_from_name), ''),
      ep.id, 'verified'
    FROM tenant_email_settings tes
    LEFT JOIN email_providers ep
      ON ep.tenant = tes.tenant AND lower(ep.mailbox) = lower(trim(tes.ticketing_from_email))
      AND ep.provider_type = 'microsoft'
    WHERE nullif(trim(tes.ticketing_from_email), '') IS NOT NULL
    ON CONFLICT (tenant, email_address) DO NOTHING
  `);
  await knex.raw(`
    INSERT INTO email_sender_routes (tenant, route_type, mail_class, sender_id, display_name)
    SELECT tes.tenant, 'mail_class', 'ticket', esa.sender_id,
      CASE WHEN nullif(trim(tes.ticketing_from_email), '') IS NULL THEN nullif(trim(tes.ticketing_from_name), '') END
    FROM tenant_email_settings tes
    LEFT JOIN email_sender_addresses esa
      ON esa.tenant = tes.tenant AND esa.email_address = lower(trim(tes.ticketing_from_email))
    WHERE nullif(trim(tes.ticketing_from_email), '') IS NOT NULL
       OR nullif(trim(tes.ticketing_from_name), '') IS NOT NULL
    ON CONFLICT (tenant, mail_class) WHERE route_type = 'mail_class' DO NOTHING
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('email_sender_routes');
  await knex.schema.dropTableIfExists('email_sender_addresses');
};
