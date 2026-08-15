/**
 * Weighted burn rates for bucket hours — template-side pool snapshots.
 *
 * Contract templates snapshot a live contract line into the
 * `contract_template_*` tables. Under the weighted-burn model a line's buckets
 * are line-owned POOLS (scope, membership, per-service multipliers, after-hours
 * rule); the legacy per-service `contract_template_line_service_bucket_config`
 * rows keyed by config_id cannot represent catch-all or multi-member pools —
 * and keying them with pool ids violates the FK to
 * `contract_template_line_service_configuration`.
 *
 * This migration adds template-side pool tables mirroring the live pool tables
 * so contract → template mapping and template cloning round-trip the FULL pool
 * configuration:
 *
 *   contract_template_line_buckets         — the pool snapshot
 *   contract_template_line_bucket_services — membership + burn multiplier
 *
 * The template bucket_id is a first-class identifier inside the template (the
 * live pool's bucket_id is reused so identity survives mapping); clones mint
 * fresh bucket ids on the target line.
 *
 * Down-migration drops the template pool tables.
 */

exports.config = { transaction: false };

// Distribute a tenant-scoped table on Citus, colocated with `contract_lines`.
// No-op on plain Postgres and on already-distributed tables.
async function distributeColocatedWithContractLines(knex, tableName) {
  let citusAvailable = false;
  try {
    const citusFn = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'create_distributed_table'
      ) AS exists;
    `);
    citusAvailable = Boolean(citusFn.rows?.[0]?.exists);
  } catch {
    citusAvailable = false;
  }
  if (!citusAvailable) return;

  try {
    const alreadyDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = '${tableName}'::regclass
      ) AS is_distributed;
    `);
    if (alreadyDistributed.rows?.[0]?.is_distributed) return;
  } catch {
    return; // pg_dist_partition unavailable on plain Postgres
  }

  await knex.raw(
    `SELECT create_distributed_table('${tableName}', 'tenant', colocate_with => 'contract_lines')`
  );
}

exports.up = async function up(knex) {
  // -------------------------------------------------------------------------
  // 1. contract_template_line_buckets — the pool snapshot
  // -------------------------------------------------------------------------
  if (!(await knex.schema.hasTable('contract_template_line_buckets'))) {
    await knex.schema.createTable('contract_template_line_buckets', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('bucket_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('template_line_id').notNullable();
      table.text('bucket_name').nullable();
      table.integer('total_minutes').notNullable();
      table.decimal('overage_rate', 10, 2).notNullable().defaultTo(0);
      table.boolean('allow_rollover').notNullable().defaultTo(false);
      table.text('billing_period').notNullable().defaultTo('monthly');
      table.decimal('after_hours_multiplier', 6, 3).nullable();
      table.uuid('business_hours_schedule_id').nullable();
      table.boolean('covers_all_services').notNullable().defaultTo(false);
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now()).notNullable();
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now()).notNullable();

      table.primary(['tenant', 'bucket_id']);
      table.foreign('tenant').references('tenants.tenant');
      table.foreign(['tenant', 'template_line_id'])
        .references(['tenant', 'template_line_id'])
        .inTable('contract_template_lines')
        .onDelete('CASCADE');
    });

    await knex.raw(`
      ALTER TABLE contract_template_line_buckets
      ADD CONSTRAINT contract_tpl_buckets_after_hours_rule_check
      CHECK (after_hours_multiplier IS NULL OR business_hours_schedule_id IS NOT NULL)
    `);
    await knex.raw(`
      ALTER TABLE contract_template_line_buckets
      ADD CONSTRAINT contract_tpl_buckets_after_hours_multiplier_check
      CHECK (after_hours_multiplier IS NULL OR after_hours_multiplier > 0)
    `);
    // At most one catch-all pool per template line.
    await knex.raw(`
      CREATE UNIQUE INDEX contract_template_line_buckets_one_catch_all_uidx
      ON contract_template_line_buckets (tenant, template_line_id)
      WHERE covers_all_services
    `);
  }

  // -------------------------------------------------------------------------
  // 2. contract_template_line_bucket_services — membership + multiplier
  // -------------------------------------------------------------------------
  if (!(await knex.schema.hasTable('contract_template_line_bucket_services'))) {
    await knex.schema.createTable('contract_template_line_bucket_services', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('bucket_id').notNullable();
      table.uuid('service_id').notNullable();
      table.uuid('template_line_id').notNullable();
      table.decimal('burn_multiplier', 6, 3).notNullable().defaultTo(1);
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now()).notNullable();
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now()).notNullable();

      table.primary(['tenant', 'bucket_id', 'service_id']);
      table.foreign('tenant').references('tenants.tenant');
      table.foreign(['tenant', 'bucket_id'])
        .references(['tenant', 'bucket_id'])
        .inTable('contract_template_line_buckets')
        .onDelete('CASCADE');
      table.foreign(['tenant', 'service_id'])
        .references(['tenant', 'service_id'])
        .inTable('service_catalog')
        .onDelete('CASCADE');
      table.foreign(['tenant', 'template_line_id'])
        .references(['tenant', 'template_line_id'])
        .inTable('contract_template_lines')
        .onDelete('CASCADE');
      // One pool per (line, service), mirroring the live invariant. The
      // explicit short name stays under the 63-byte identifier limit.
      table.unique(['tenant', 'template_line_id', 'service_id'], 'contract_tpl_line_bucket_services_line_service_uidx');
    });

    await knex.raw(`
      ALTER TABLE contract_template_line_bucket_services
      ADD CONSTRAINT contract_tpl_bucket_services_burn_multiplier_check
      CHECK (burn_multiplier > 0)
    `);
  }

  // Distribute after creation (Citus FK requires distributed parents first).
  await distributeColocatedWithContractLines(knex, 'contract_template_line_buckets');
  await distributeColocatedWithContractLines(knex, 'contract_template_line_bucket_services');
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('contract_template_line_bucket_services');
  await knex.schema.dropTableIfExists('contract_template_line_buckets');
};
