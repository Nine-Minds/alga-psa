/**
 * Creates the custom_reports table for storing platform-wide and tenant-specific report definitions.
 * Reports use the existing ReportDefinition shape from server/src/lib/reports/core/types.ts.
 *
 * Platform reports (cross-tenant) use MASTER_BILLING_TENANT_ID as the tenant value.
 * Future tenant-specific reports will use the tenant's own ID.
 */

exports.up = async function up(knex) {
  await knex.schema.createTable('custom_reports', (table) => {
    table.uuid('tenant').notNullable();  // MASTER_BILLING_TENANT_ID for platform reports
    table.uuid('report_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('name', 255).notNullable();
    table.text('description').nullable();
    table.string('category', 100).nullable();  // 'tenants', 'users', 'billing', 'activity'

    // Uses existing ReportDefinition shape from server/src/lib/reports/core/types.ts
    table.jsonb('report_definition').notNullable();

    // Access control - less transparent naming for security
    table.boolean('platform_access').notNullable().defaultTo(false);

    // Display configuration (column widths, sorting, etc.)
    table.jsonb('display_config').nullable();

    // Metadata
    table.uuid('created_by').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.boolean('is_active').notNullable().defaultTo(true);

    // Single composite primary key including tenant for Citus distribution
    table.primary(['tenant', 'report_id'], {
      constraintName: 'custom_reports_pk',
    });
  });

  // Citus distribution with colocation (matches existing table pattern)
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') as enabled
  `);

  if (citusEnabled.rows?.[0]?.enabled) {
    // Check if already distributed (idempotent)
    const isDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = 'custom_reports'::regclass
      ) as distributed
    `);

    if (!isDistributed.rows?.[0]?.distributed) {
      // Colocate with tenants table for efficient cross-table queries
      await knex.raw(`
        SELECT create_distributed_table('custom_reports', 'tenant', colocate_with => 'tenants')
      `);
    }
  }

  // Indexes for common queries
  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS custom_reports_tenant_category_idx
      ON custom_reports (tenant, category) WHERE is_active = true;
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS custom_reports_tenant_name_idx
      ON custom_reports (tenant, name);
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('custom_reports');
};

exports.config = { transaction: false };  // Required for Citus DDL
