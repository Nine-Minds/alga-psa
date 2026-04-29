/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.createTable('asset_facts', (table) => {
    table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
    table.uuid('asset_fact_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('asset_id').notNullable();
    table.text('source_type').notNullable();
    table.text('provider').nullable();
    table.uuid('integration_id').nullable();
    table.text('namespace').notNullable();
    table.text('fact_key').notNullable();
    table.text('label').notNullable();
    table.text('value_text').nullable();
    table.decimal('value_number', 12, 4).nullable();
    table.boolean('value_bool').nullable();
    table.jsonb('value_json').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
    table.text('source').notNullable();
    table.timestamp('source_updated_at', { useTz: true }).nullable();
    table.timestamp('last_synced_at', { useTz: true }).nullable();
    table.boolean('is_available').notNullable().defaultTo(true);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'asset_fact_id']);
    table.foreign(['tenant', 'asset_id']).references(['tenant', 'asset_id']).inTable('assets').onDelete('CASCADE');
    table.index(['tenant', 'asset_id'], 'asset_facts_tenant_asset_idx');
    table.unique(['tenant', 'asset_id', 'source_type', 'namespace', 'fact_key'], 'asset_facts_tenant_asset_fact_current_uk');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('asset_facts');
};
