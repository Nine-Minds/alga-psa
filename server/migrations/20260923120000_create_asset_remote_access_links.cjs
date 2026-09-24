// Tenant-configurable remote-access URL templates for MSP asset connections.
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('asset_remote_access_links'))) {
    await knex.schema.createTable('asset_remote_access_links', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('link_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('label').notNullable();
      table.text('url_template').notNullable();
      table.specificType('asset_type_slugs', 'text[]').nullable();
      table.text('requires_field_key').nullable();
      table.boolean('is_enabled').notNullable().defaultTo(true);
      table.integer('display_order').notNullable().defaultTo(0);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'link_id']);
      table.foreign('tenant').references('tenant').inTable('tenants');
    });
  }
  await ensureTenantDistribution(knex, 'asset_remote_access_links');
};
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('asset_remote_access_links');
};
exports.config = { transaction: false };
