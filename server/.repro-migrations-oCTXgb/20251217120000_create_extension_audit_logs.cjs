/**
 * Creates the extension_audit_logs table for tracking ALL extension activity.
 * Provides security audit trail and usage analytics for the Nine Minds reporting extension.
 *
 * Supports:
 * - Platform reports (report.list, report.create, report.execute, etc.)
 * - Tenant management (tenant.create, tenant.resend_email, tenant.cancel_subscription, etc.)
 * - Any future extension features
 */

exports.up = async function up(knex) {
  await knex.schema.createTable('extension_audit_logs', (table) => {
    table.uuid('tenant').notNullable();  // MASTER_BILLING_TENANT_ID
    table.uuid('log_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));

    // Event type examples:
    // Reports: report.list, report.view, report.create, report.update, report.delete, report.execute, schema.view
    // Tenant management: tenant.list, tenant.create, tenant.resend_email, tenant.cancel_subscription
    // General: extension.access
    table.string('event_type', 100).notNullable();

    // User who performed the action
    table.uuid('user_id').nullable();
    table.string('user_email', 255).nullable();

    // Resource context (generic - can be report, tenant, user, subscription, etc.)
    table.string('resource_type', 50).nullable();  // 'report', 'tenant', 'user', 'subscription'
    table.string('resource_id', 255).nullable();   // UUID or external ID
    table.string('resource_name', 255).nullable(); // Human-readable name

    // Workflow tracking (for Temporal workflows)
    table.string('workflow_id', 255).nullable();
    table.string('status', 50).nullable();  // 'pending', 'completed', 'failed', 'running'
    table.text('error_message').nullable();

    // Additional event details (parameters, filters, execution time, etc.)
    table.jsonb('details').nullable();

    // Client information
    table.string('ip_address', 45).nullable();  // IPv6 max length
    table.text('user_agent').nullable();

    // Timestamp
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    // Composite primary key
    table.primary(['tenant', 'log_id'], {
      constraintName: 'extension_audit_logs_pk',
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
        WHERE logicalrelid = 'extension_audit_logs'::regclass
      ) as distributed
    `);

    if (!isDistributed.rows?.[0]?.distributed) {
      await knex.raw(`
        SELECT create_distributed_table('extension_audit_logs', 'tenant', colocate_with => 'tenants')
      `);
    }
  }

  // Indexes for common queries
  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS extension_audit_logs_tenant_created_idx
      ON extension_audit_logs (tenant, created_at DESC);
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS extension_audit_logs_tenant_event_type_idx
      ON extension_audit_logs (tenant, event_type);
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS extension_audit_logs_tenant_user_idx
      ON extension_audit_logs (tenant, user_id) WHERE user_id IS NOT NULL;
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS extension_audit_logs_tenant_resource_idx
      ON extension_audit_logs (tenant, resource_type, resource_id) WHERE resource_id IS NOT NULL;
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS extension_audit_logs_tenant_status_idx
      ON extension_audit_logs (tenant, status) WHERE status IS NOT NULL;
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('extension_audit_logs');
};

exports.config = { transaction: false };  // Required for Citus DDL
