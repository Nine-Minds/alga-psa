const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

const TABLE = 'imap_oauth_states';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.text('nonce').notNullable();
      table.jsonb('state').notNullable();
      table.timestamp('expires_at', { useTz: true }).notNullable();
      table.primary(['tenant', 'nonce']);
      table.index(['tenant', 'expires_at'], 'imap_oauth_states_expiry_idx');
    });
  }
  await ensureTenantDistribution(knex, TABLE);
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  if (await knex(TABLE).first()) throw new Error('Cannot remove active IMAP OAuth states');
  await knex.schema.dropTable(TABLE);
};

exports.config = { transaction: false };
