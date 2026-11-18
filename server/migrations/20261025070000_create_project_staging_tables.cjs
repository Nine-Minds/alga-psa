/**
 * Project staging, boxes and manifests (alga-2026-0002683 C6).
 * Design of record: ee/docs/plans/2026-10-20-physical-work-tags/design-C6-project-staging.md (D2, D3, D9, D10).
 *
 *   project_staging_lines      - what a project has reserved, staged, installed or released. Stock lines
 *                                claim stock through the shared stock_levels counters (non-serialized) or
 *                                stock_units.allocated_staging_line_id (serialized). Client lines
 *                                (client_asset, client_item) never touch stock. Billing never reads this
 *                                table: install creates the project_materials row.
 *   stock_units.allocated_staging_line_id
 *                              - the serialized project claim; mutually exclusive with allocated_so_line_id.
 *   staging_containers         - a box / tote on a project (optionally a task), numbered per project.
 *   staging_container_members  - which staging line (and how much of it) is in which box.
 *
 * Citus: tenant-distributed, colocated with tenants, composite (tenant, ...) keys. FKs are added after
 * distribution through ensureCompositeFk so a coordinator-local parent cannot fail the migration.
 * ON DELETE on the composite FKs is CASCADE or NO ACTION only (SET NULL would null the tenant column).
 */
const { ensureTenantDistribution, ensureCompositeFk } = require('./utils/citusDistribution.cjs');

exports.config = { transaction: false };

const LINE_KINDS = ['stock', 'client_asset', 'client_item'];
const LINE_STATUSES = ['received', 'reserved', 'staged', 'installed', 'released'];
const CONTAINER_STATUSES = ['open', 'sealed'];

const inList = (values) => values.map((v) => `'${v}'`).join(', ');

async function addCheck(knex, table, name, expression) {
  const r = await knex.raw('SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass', [name, table]);
  if (r.rows.length === 0) {
    // migration-lint: allow 2 - retroactive: CHECK added under a pg_constraint absence probe on stock_units; merged before the lint existed
    await knex.raw(`ALTER TABLE ?? ADD CONSTRAINT ?? CHECK (${expression})`, [table, name]);
  }
}

const fk = (table, constraint, columns, referencedTable, referencedColumns, onDelete) => ({
  table,
  constraint,
  columns,
  referencedTable,
  referencedColumns,
  onDelete,
});

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('project_staging_lines'))) {
    await knex.schema.createTable('project_staging_lines', (table) => {
      table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
      table.uuid('staging_line_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('project_id').notNullable();
      table.uuid('task_id').nullable();
      table.text('kind').notNullable();
      table.text('status').notNullable();
      // Stock lines: the product, the claimed unit (serialized) and the claim's location (non-serialized).
      table.uuid('service_id').nullable();
      table.uuid('unit_id').nullable();
      table.uuid('reserved_location_id').nullable();
      // Client lines: the client's asset, or a free-text item.
      table.uuid('asset_id').nullable();
      table.text('description').nullable();
      table.integer('quantity').notNullable();
      // Planned billing, copied onto the project_materials row at install. Never billed from here.
      table.bigInteger('rate').notNullable().defaultTo(0);
      table.text('currency_code').nullable();
      table.text('billing_destination').nullable();
      table.uuid('billing_schedule_entry_id').nullable();
      // Set at install (stock lines).
      table.uuid('project_material_id').nullable();
      table.timestamp('reserved_at', { useTz: true }).nullable();
      table.uuid('reserved_by').nullable();
      table.timestamp('staged_at', { useTz: true }).nullable();
      table.uuid('staged_by').nullable();
      table.timestamp('installed_at', { useTz: true }).nullable();
      table.uuid('installed_by').nullable();
      table.timestamp('released_at', { useTz: true }).nullable();
      table.uuid('released_by').nullable();
      table.uuid('created_by').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'staging_line_id']);
      table.index(['tenant', 'project_id', 'status'], 'idx_project_staging_lines_project_status');
      table.index(['tenant', 'service_id', 'status'], 'idx_project_staging_lines_service_status');
      table.index(['tenant', 'unit_id'], 'idx_project_staging_lines_unit');
      table.index(['tenant', 'project_material_id'], 'idx_project_staging_lines_material');
    });
  }

  const L = 'project_staging_lines';
  await addCheck(knex, L, 'project_staging_lines_kind_ck', `kind IN (${inList(LINE_KINDS)})`);
  await addCheck(knex, L, 'project_staging_lines_status_ck', `status IN (${inList(LINE_STATUSES)})`);
  await addCheck(knex, L, 'project_staging_lines_quantity_ck', 'quantity > 0');
  await addCheck(knex, L, 'project_staging_lines_rate_ck', 'rate >= 0');
  // Stock lines name a product and never use the client "received" state.
  await addCheck(knex, L, 'project_staging_lines_stock_ck', "kind <> 'stock' OR (service_id IS NOT NULL AND asset_id IS NULL AND status <> 'received')");
  // Client lines have no stock path at all: no product, unit, location or reservation state.
  await addCheck(
    knex,
    L,
    'project_staging_lines_client_ck',
    "kind = 'stock' OR (service_id IS NULL AND unit_id IS NULL AND reserved_location_id IS NULL AND project_material_id IS NULL AND status <> 'reserved')",
  );
  await addCheck(knex, L, 'project_staging_lines_client_asset_ck', "kind <> 'client_asset' OR (asset_id IS NOT NULL AND quantity = 1)");
  await addCheck(knex, L, 'project_staging_lines_client_item_ck', "kind <> 'client_item' OR (description IS NOT NULL AND length(btrim(description)) > 0)");
  // A serialized stock line is exactly one unit.
  await addCheck(knex, L, 'project_staging_lines_unit_quantity_ck', 'unit_id IS NULL OR quantity = 1');
  // An installed stock line points at the material that consumed it.
  await addCheck(knex, L, 'project_staging_lines_installed_ck', "kind <> 'stock' OR status <> 'installed' OR project_material_id IS NOT NULL");

  if (!(await knex.schema.hasColumn('stock_units', 'allocated_staging_line_id'))) {
    await knex.schema.alterTable('stock_units', (table) => {
      table.uuid('allocated_staging_line_id').nullable();
      // migration-lint: allow 1 - retroactive: knex builder index on stock_units inside the transaction, on a column added in the same step; merged before the lint existed
      table.index(['tenant', 'allocated_staging_line_id'], 'idx_stock_units_allocated_staging_line');
    });
  }
  await addCheck(
    knex,
    'stock_units',
    'stock_units_single_claimant_ck',
    'allocated_so_line_id IS NULL OR allocated_staging_line_id IS NULL',
  );

  if (!(await knex.schema.hasTable('staging_containers'))) {
    await knex.schema.createTable('staging_containers', (table) => {
      table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
      table.uuid('container_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('project_id').notNullable();
      table.uuid('task_id').nullable();
      // Per project, max+1 and never reused: deleted boxes keep their number (deleted_at).
      table.integer('sequence').notNullable();
      table.text('name').nullable();
      table.text('status').notNullable().defaultTo('open');
      // Where the box physically is. Informational: staging writes no stock movement.
      table.uuid('stock_location_id').nullable();
      table.text('location_note').nullable();
      table.text('notes').nullable();
      table.timestamp('sealed_at', { useTz: true }).nullable();
      table.uuid('sealed_by').nullable();
      table.uuid('created_by').nullable();
      table.timestamp('deleted_at', { useTz: true }).nullable();
      table.uuid('deleted_by').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'container_id']);
      table.unique(['tenant', 'project_id', 'sequence'], { indexName: 'staging_containers_project_sequence_uk' });
    });
  }
  await addCheck(knex, 'staging_containers', 'staging_containers_status_ck', `status IN (${inList(CONTAINER_STATUSES)})`);
  await addCheck(knex, 'staging_containers', 'staging_containers_sequence_ck', 'sequence > 0');

  if (!(await knex.schema.hasTable('staging_container_members'))) {
    await knex.schema.createTable('staging_container_members', (table) => {
      table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
      table.uuid('member_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('container_id').notNullable();
      table.uuid('staging_line_id').notNullable();
      table.integer('quantity').notNullable();
      table.uuid('added_by').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'member_id']);
      table.unique(['tenant', 'container_id', 'staging_line_id'], { indexName: 'staging_container_members_line_uk' });
      table.index(['tenant', 'staging_line_id'], 'idx_staging_container_members_line');
    });
  }
  await addCheck(knex, 'staging_container_members', 'staging_container_members_quantity_ck', 'quantity > 0');

  await ensureTenantDistribution(knex, 'project_staging_lines');
  await ensureTenantDistribution(knex, 'staging_containers');
  await ensureTenantDistribution(knex, 'staging_container_members');

  const fks = [
    fk(L, 'project_staging_lines_project_fk', ['tenant', 'project_id'], 'projects', ['tenant', 'project_id'], 'CASCADE'),
    fk(L, 'project_staging_lines_task_fk', ['tenant', 'task_id'], 'project_tasks', ['tenant', 'task_id'], 'CASCADE'),
    fk(L, 'project_staging_lines_service_fk', ['tenant', 'service_id'], 'service_catalog', ['tenant', 'service_id'], 'RESTRICT'),
    fk(L, 'project_staging_lines_unit_fk', ['tenant', 'unit_id'], 'stock_units', ['tenant', 'unit_id'], 'NO ACTION'),
    fk(L, 'project_staging_lines_location_fk', ['tenant', 'reserved_location_id'], 'stock_locations', ['tenant', 'location_id'], 'NO ACTION'),
    fk(L, 'project_staging_lines_asset_fk', ['tenant', 'asset_id'], 'assets', ['tenant', 'asset_id'], 'NO ACTION'),
    fk(L, 'project_staging_lines_material_fk', ['tenant', 'project_material_id'], 'project_materials', ['tenant', 'project_material_id'], 'NO ACTION'),
    fk(
      L,
      'project_staging_lines_schedule_entry_fk',
      ['tenant', 'billing_schedule_entry_id'],
      'project_billing_schedule_entries',
      ['tenant', 'schedule_entry_id'],
      'NO ACTION',
    ),
    fk('stock_units', 'fk_stock_units_allocated_staging_line', ['tenant', 'allocated_staging_line_id'], L, ['tenant', 'staging_line_id'], 'NO ACTION'),
    fk('staging_containers', 'staging_containers_project_fk', ['tenant', 'project_id'], 'projects', ['tenant', 'project_id'], 'CASCADE'),
    fk('staging_containers', 'staging_containers_task_fk', ['tenant', 'task_id'], 'project_tasks', ['tenant', 'task_id'], 'NO ACTION'),
    fk('staging_containers', 'staging_containers_location_fk', ['tenant', 'stock_location_id'], 'stock_locations', ['tenant', 'location_id'], 'NO ACTION'),
    fk('staging_container_members', 'staging_container_members_container_fk', ['tenant', 'container_id'], 'staging_containers', ['tenant', 'container_id'], 'CASCADE'),
    fk('staging_container_members', 'staging_container_members_line_fk', ['tenant', 'staging_line_id'], L, ['tenant', 'staging_line_id'], 'CASCADE'),
  ];
  for (const spec of fks) {
    await ensureCompositeFk(knex, spec);
  }
};

exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE stock_units DROP CONSTRAINT IF EXISTS fk_stock_units_allocated_staging_line');
  await knex.raw('ALTER TABLE stock_units DROP CONSTRAINT IF EXISTS stock_units_single_claimant_ck');
  if (await knex.schema.hasColumn('stock_units', 'allocated_staging_line_id')) {
    await knex.schema.alterTable('stock_units', (table) => {
      table.dropIndex(['tenant', 'allocated_staging_line_id'], 'idx_stock_units_allocated_staging_line');
      table.dropColumn('allocated_staging_line_id');
    });
  }
  await knex.schema.dropTableIfExists('staging_container_members');
  await knex.schema.dropTableIfExists('staging_containers');
  await knex.schema.dropTableIfExists('project_staging_lines');
};
