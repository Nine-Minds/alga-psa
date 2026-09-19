exports.up = async function up(knex) {
  await knex.schema.raw(`CREATE TYPE portal_domain_status AS ENUM (
    'pending_dns',
    'verifying_dns',
    'dns_failed',
    'pending_certificate',
    'certificate_issuing',
    'certificate_failed',
    'deploying',
    'active',
    'disabled'
  )`);

  await knex.schema.raw(`CREATE TYPE portal_domain_verification_method AS ENUM ('cname')`);

  await knex.schema.createTable('portal_domains', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant').notNullable();
    table.text('domain').notNullable();
    table.text('canonical_host').notNullable();
    table
      .specificType('status', 'portal_domain_status')
      .notNullable()
      .defaultTo('pending_dns');
    table.text('status_message');
    table
      .timestamp('last_checked_at', { useTz: true })
      .defaultTo(knex.fn.now());
    table
      .specificType('verification_method', 'portal_domain_verification_method')
      .notNullable()
      .defaultTo('cname');
    table
      .jsonb('verification_details')
      .notNullable()
      .defaultTo(knex.raw(`'{}'::jsonb`));
    table.text('certificate_secret_name');
    table.text('last_synced_resource_version');
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    table
      .foreign('tenant')
      .references('tenant')
      .inTable('tenants')
      .onDelete('CASCADE');

    table.unique(['tenant']);
  });

  await knex.schema.raw(
    'CREATE UNIQUE INDEX portal_domains_domain_unique_idx ON portal_domains (lower(domain))'
  );

  await knex.schema.raw(
    'CREATE UNIQUE INDEX portal_domains_canonical_unique_idx ON portal_domains (lower(canonical_host))'
  );
};

exports.down = async function down(knex) {
  await knex.schema.raw('DROP INDEX IF EXISTS portal_domains_canonical_unique_idx');
  await knex.schema.raw('DROP INDEX IF EXISTS portal_domains_domain_unique_idx');
  await knex.schema.dropTableIfExists('portal_domains');
  await knex.schema.raw('DROP TYPE IF EXISTS portal_domain_verification_method');
  await knex.schema.raw('DROP TYPE IF EXISTS portal_domain_status');
};
