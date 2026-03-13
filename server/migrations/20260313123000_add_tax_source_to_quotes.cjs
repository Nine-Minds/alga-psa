exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('quotes', 'tax_source');
  if (hasColumn) {
    return;
  }

  await knex.schema.alterTable('quotes', (table) => {
    table.string('tax_source', 20).notNullable().defaultTo('internal');
  });

  await knex.raw(`
    ALTER TABLE quotes
    ADD CONSTRAINT quotes_tax_source_check
    CHECK (tax_source IN ('internal', 'external', 'pending_external'))
  `);
};

exports.down = async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('quotes', 'tax_source');
  if (!hasColumn) {
    return;
  }

  await knex.raw('ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_tax_source_check');
  await knex.schema.alterTable('quotes', (table) => {
    table.dropColumn('tax_source');
  });
};

