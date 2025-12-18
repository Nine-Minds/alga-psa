/**
 * Creates the custom_reports_audit table for tracking all platform report access and actions.
 * Provides security audit trail and usage analytics for the reporting extension.
 */

exports.up = async function up(knex) {
  await knex.schema.createTable('custom_reports_audit', (table) => {
    table.uuid('tenant').notNullable();  // MASTER_BILLING_TENANT_ID for platform reports
    table.uuid('log_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));

    // Event type: report.list, report.view, report.create, report.update, report.delete, report.execute, schema.view, extension.access
    table.string('event_type', 50).notNullable();

    // User who performed the action
    table.uuid('user_id').nullable();
    table.string('user_email', 255).nullable();

    // Report context (if applicable)
    table.uuid('report_id').nullable();
    table.string('report_name', 255).nullable();

    // Additional event details (parameters, filters, execution time, etc.)
    table.jsonb('details').nullable();

    // Client information
    table.string('ip_address', 45).nullable();  // IPv6 max length
    table.text('user_agent').nullable();

    // Timestamp
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    // Composite primary key
    table.primary(['tenant', 'log_id'], {
      constraintName: 'custom_reports_audit_pk',
    });
  });

  // Citus distribution
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') as enabled
  `);

  if (citusEnabled.rows?.[0]?.enabled) {
    const isDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = 'custom_reports_audit'::regclass
      ) as distributed
    `);

    if (!isDistributed.rows?.[0]?.distributed) {
      await knex.raw(`
        SELECT create_distributed_table('custom_reports_audit', 'tenant', colocate_with => 'tenants')
      `);
    }
  }

  // Indexes for common queries
  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS custom_reports_audit_tenant_created_idx
      ON custom_reports_audit (tenant, created_at DESC);
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS custom_reports_audit_tenant_event_type_idx
      ON custom_reports_audit (tenant, event_type);
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS custom_reports_audit_tenant_user_idx
      ON custom_reports_audit (tenant, user_id) WHERE user_id IS NOT NULL;
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS custom_reports_audit_tenant_report_idx
      ON custom_reports_audit (tenant, report_id) WHERE report_id IS NOT NULL;
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('custom_reports_audit');
};

exports.config = { transaction: false };  // Required for Citus DDL
