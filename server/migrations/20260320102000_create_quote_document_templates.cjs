const TABLE_NAME = 'quote_document_templates';

exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable(TABLE_NAME);

  if (exists) {
    return;
  }

  await knex.schema.createTable(TABLE_NAME, (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('template_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.text('name').notNullable();
    table.integer('version').notNullable();
    table.jsonb('templateAst').notNullable();
    table.boolean('is_default').notNullable().defaultTo(false);
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'template_id']);

    table
      .foreign('tenant')
      .references('tenant')
      .inTable('tenants')
      .onDelete('CASCADE');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE_NAME);
};
