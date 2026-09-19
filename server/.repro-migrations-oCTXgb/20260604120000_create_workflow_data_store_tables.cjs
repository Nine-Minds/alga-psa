/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.createTable('workflow_data_store', (table) => {
    table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
    table.uuid('store_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.text('namespace').notNullable();
    table.text('key').notNullable();
    table.jsonb('value').notNullable();
    table.text('value_type').notNullable().defaultTo('json');
    table.bigInteger('revision').notNullable().defaultTo(1);
    table.timestamp('expires_at', { useTz: true }).nullable();
    table.uuid('created_by_run_id').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'store_id']);
    table.unique(['tenant', 'namespace', 'key'], 'workflow_data_store_tenant_namespace_key_uk');
    table.index(['tenant', 'namespace'], 'idx_workflow_data_store_tenant_namespace');
  });

  await knex.raw(`
    CREATE INDEX idx_workflow_data_store_tenant_expires_at
      ON workflow_data_store (tenant, expires_at)
      WHERE expires_at IS NOT NULL
  `);

  await knex.schema.createTable('workflow_entity_links', (table) => {
    table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
    table.uuid('link_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.text('namespace').notNullable();
    table.text('left_type').notNullable();
    table.text('left_id').notNullable();
    table.text('right_type').notNullable();
    table.text('right_id').notNullable();
    table.text('relation').notNullable().defaultTo('related');
    table.jsonb('attributes').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
    table.uuid('created_by_run_id').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'link_id']);
    table.unique(
      ['tenant', 'namespace', 'left_type', 'left_id', 'right_type', 'right_id', 'relation'],
      'workflow_entity_links_tenant_typed_edge_uk'
    );
    table.index(
      ['tenant', 'namespace', 'left_type', 'left_id'],
      'idx_workflow_entity_links_tenant_left'
    );
    table.index(
      ['tenant', 'namespace', 'right_type', 'right_id'],
      'idx_workflow_entity_links_tenant_right'
    );
  });

  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_extension
      WHERE extname = 'citus'
    ) AS enabled;
  `);

  if (citusEnabled.rows?.[0]?.enabled) {
    for (const table of ['workflow_data_store', 'workflow_entity_links']) {
      const alreadyDistributed = await knex.raw(
        `
          SELECT EXISTS (
            SELECT 1
            FROM pg_dist_partition
            WHERE logicalrelid = ?::regclass
          ) AS is_distributed;
        `,
        [table]
      );

      if (!alreadyDistributed.rows?.[0]?.is_distributed) {
        await knex.raw(`SELECT create_distributed_table(?, 'tenant', colocate_with => 'workflow_runs')`, [
          table,
        ]);
      }
    }
  } else {
    console.warn(
      '[create_workflow_data_store_tables] Skipping create_distributed_table (Citus extension unavailable)'
    );
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('workflow_entity_links');
  await knex.schema.dropTableIfExists('workflow_data_store');
};

// create_distributed_table cannot run inside a transaction block.
exports.config = { transaction: false };
