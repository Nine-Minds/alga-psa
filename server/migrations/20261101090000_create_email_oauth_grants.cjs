const { ensureTenantDistribution, hasConstraint } = require('./utils/citusDistribution.cjs');

const TABLE = 'email_oauth_grants';
const TENANT_FOREIGN_KEY = `${TABLE}_tenant_foreign`;
const PROVIDER_EXPIRY_INDEX = `${TABLE}_tenant_provider_id_expires_at_index`;

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable(TABLE);
  if (!hasTable) {
    await knex.schema.createTable(TABLE, (table) => {
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
    });
  }

  // These DDL steps are deliberately retryable because create_distributed_table
  // cannot run in a transaction and a failed migration can leave the new table
  // behind before distribution completes.
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS ${PROVIDER_EXPIRY_INDEX} ON ${TABLE} (tenant, provider_id, expires_at)`
  );

  await ensureTenantDistribution(knex, TABLE);

  // Citus requires both sides of a foreign key to be distributed compatibly.
  // Add it only after this table has been colocated with tenant-distributed
  // `tenants`; on plain PostgreSQL ensureTenantDistribution is a no-op.
  if (!(await hasConstraint(knex, TABLE, TENANT_FOREIGN_KEY))) {
    await knex.raw(
      `ALTER TABLE ${TABLE} ADD CONSTRAINT ${TENANT_FOREIGN_KEY} ` +
        'FOREIGN KEY (tenant) REFERENCES tenants (tenant) ON DELETE CASCADE'
    );
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('email_oauth_grants');
};

exports.config = { transaction: false };
