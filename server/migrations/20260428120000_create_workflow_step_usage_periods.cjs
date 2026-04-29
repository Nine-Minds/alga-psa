/**
 * Create tenant-scoped workflow step quota usage counters by billing period.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('workflow_step_usage_periods', (table) => {
    table.uuid('tenant').notNullable();
    table.timestamp('period_start', { useTz: true }).notNullable();
    table.timestamp('period_end', { useTz: true }).notNullable();
    table.text('period_source').notNullable();
    table.uuid('stripe_subscription_id');
    table.integer('effective_limit');
    table.integer('used_count').notNullable().defaultTo(0);
    table.text('limit_source').notNullable();
    table.text('tier').notNullable();
    table.jsonb('metadata_json');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'period_start', 'period_end']);
    table.foreign('tenant').references('tenants.tenant').onDelete('CASCADE');
    table.index(['tenant', 'period_end'], 'idx_workflow_step_usage_periods_tenant_period_end');
    table.index(['period_end'], 'idx_workflow_step_usage_periods_period_end');
  });

  await knex.schema.raw(`
    ALTER TABLE workflow_step_usage_periods
    ADD CONSTRAINT workflow_step_usage_periods_period_bounds_check
    CHECK (period_start < period_end)
  `);

  const dbUserServer = process.env.DB_USER_SERVER;
  if (dbUserServer) {
    const escapedUser = dbUserServer.replace(/"/g, '""');
    await knex.schema.raw(`
      GRANT ALL PRIVILEGES ON TABLE workflow_step_usage_periods TO "${escapedUser}";
    `);
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('workflow_step_usage_periods');
};
