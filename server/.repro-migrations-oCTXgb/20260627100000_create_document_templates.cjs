/**
 * Generic per-tenant custom document templates (Approach C), keyed by document_type so one table
 * backs every designable document type (sales-order first; invoice/quote may migrate later).
 * Built-in STANDARD templates live in code (the document-type registry), not here — this table
 * holds only tenant-authored customizations.
 */
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

const TABLE_NAME = 'document_templates';

exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable(TABLE_NAME);
  if (exists) {
    return;
  }

  await knex.schema.createTable(TABLE_NAME, (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('template_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.string('document_type', 64).notNullable();
    table.text('name').notNullable();
    table.integer('version').notNullable().defaultTo(1);
    table.jsonb('templateAst').notNullable();
    table.boolean('is_default').notNullable().defaultTo(false);
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'template_id']);
    table.foreign('tenant').references('tenant').inTable('tenants').onDelete('CASCADE');
    table.index(['tenant', 'document_type'], 'document_templates_tenant_type_idx');
  });

  // Distribute on Citus (colocated with tenants).
  await ensureTenantDistribution(knex, TABLE_NAME);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE_NAME);
};

exports.config = { transaction: false };
