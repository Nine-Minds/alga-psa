exports.up = async function up(knex) {
  await knex.schema.createTable('portal_domain_session_otts', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant').notNullable();
    table.uuid('portal_domain_id').notNullable();
    table.uuid('user_id').notNullable();
    table.string('token_hash', 64).notNullable();
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.timestamp('consumed_at', { useTz: true });
    table.jsonb('metadata').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    table
      .foreign('tenant')
      .references('tenant')
      .inTable('tenants')
      .onDelete('CASCADE');

    table
      .foreign('portal_domain_id')
      .references('id')
      .inTable('portal_domains')
      .onDelete('CASCADE');

    table
      .foreign(['tenant', 'user_id'])
      .references(['tenant', 'user_id'])
      .inTable('users')
      .onDelete('CASCADE');
  });

  await knex.schema.alterTable('portal_domain_session_otts', (table) => {
    table.unique(['token_hash']);
    table.index(['portal_domain_id', 'expires_at'], 'portal_domain_session_otts_domain_exp_idx');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('portal_domain_session_otts', (table) => {
    table.dropIndex(['portal_domain_id', 'expires_at'], 'portal_domain_session_otts_domain_exp_idx');
    table.dropUnique(['token_hash']);
  });
  await knex.schema.dropTableIfExists('portal_domain_session_otts');
};
