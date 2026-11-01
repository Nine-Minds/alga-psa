const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('email_oauth_grants');
  if (!hasTable) {
    await knex.schema.createTable('email_oauth_grants', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('id').notNullable();
      table.uuid('provider_id').notNullable();
      table.uuid('initiated_by_user_id').notNullable();
      table.text('purpose').notNullable();
      table.text('redirect_uri').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('expires_at', { useTz: true }).notNullable();
      table.timestamp('consumed_at', { useTz: true }).nullable();

      table.primary(['tenant', 'id']);
      table.foreign('tenant').references('tenants.tenant').onDelete('CASCADE');
      table.index(['tenant', 'provider_id', 'expires_at']);
    });
  }

  await ensureTenantDistribution(knex, 'email_oauth_grants');
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('email_oauth_grants');
};

exports.config = { transaction: false };
