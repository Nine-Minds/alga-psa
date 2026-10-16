const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'tenant_license_state';
exports.up = async knex => {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    table.uuid('tenant').notNullable().primary();
    table.text('license_token').notNullable();
    table.text('license_id').notNullable();
    table.integer('seats').nullable();
    table.timestamp('valid_until', { useTz: true }).notNullable();
    table.timestamp('verified_at', { useTz: true }).notNullable();
    table.timestamp('updated_at', { useTz: true }).notNullable();
    table.check('seats IS NULL OR seats >= 0');
  });
  await ensureTenantDistribution(knex, TABLE);
  if (!await knex('pg_constraint').where('conname', 'tenant_license_state_owner_fk').whereRaw('conrelid = ?::regclass', [TABLE]).first())
    await knex.schema.alterTable(TABLE, table => table.foreign(['tenant'], 'tenant_license_state_owner_fk').references(['tenant']).inTable('tenants'));
};
exports.down = async knex => {
  if (await knex.schema.hasTable(TABLE) && await knex(TABLE).first()) throw new Error('Cannot remove tenant-bound license state');
  await knex.schema.dropTableIfExists(TABLE);
};
exports.config = { transaction: false };
